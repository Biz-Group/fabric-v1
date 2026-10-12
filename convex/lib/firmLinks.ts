import type { AIJsonSchema } from "./aiProvider";
import {
  serializeUntrustedEvidence,
  withUntrustedEvidenceBoundary,
} from "./aiPromptSafety";

/**
 * Prompt, schema, and normalizer for Firm view link resolution.
 *
 * Every process flow already names who it hands work to — but as free text
 * ("Handoff to Axonify Canada", "Finance approves the PO"). This stage resolves
 * those mentions against the org's own hierarchy so the Firm view can draw one
 * map of every process, owner, and handoff. See docs/firm-view-plan.md.
 *
 * The model never sees or writes a Convex id. The catalog is handed over under
 * short keys (F1, D3, P12), and the normalizer maps them back — an invented key
 * resolves to nothing and the link is dropped, so a hallucination costs a link,
 * never a wrong edge on someone's org chart.
 */

/**
 * Sized by time like every other synthesis call: `minTimeoutMsForMaxTokens`
 * (3072) is ~98.5 s at the worst measured throughput, and (1 + 2) x 105 s still
 * fits the 10-minute action ceiling. The link cap below keeps a full response
 * well inside the token budget (~130 tokens per link).
 */
export const FIRM_LINKS_MAX_TOKENS = 3072;
export const FIRM_LINKS_TIMEOUT_MS = 105_000;
export const FIRM_LINKS_MAX_RETRIES = 2;

export const FIRM_LINK_CAPS = {
  linksPerProcess: 16,
  labelChars: 120,
  evidencePerLink: 3,
  evidenceChars: 220,
  contributorsPerLink: 8,
  externalNameChars: 80,
  roles: 8,
  /** Catalog processes beyond this are left out of the prompt (see plan §7 Phase 4). */
  catalogProcesses: 400,
  catalogDescriptionChars: 140,
  dependencyMentions: 60,
  dependencyMentionChars: 300,
} as const;

const FIRM_LINKS_TOOL_NAME = "return_firm_links";

export type FirmLinkDirection = "outbound" | "inbound";
export type FirmLinkKind = "handoff" | "dependency";
export type FirmLinkConfidence = "high" | "medium" | "low";

export type FirmCounterparty<FunctionId, DepartmentId, ProcessId> =
  | { kind: "function"; functionId: FunctionId }
  | { kind: "department"; departmentId: DepartmentId }
  | { kind: "process"; processId: ProcessId }
  | { kind: "external"; name: string };

export type NormalizedFirmLink<FunctionId, DepartmentId, ProcessId> = {
  direction: FirmLinkDirection;
  counterparty: FirmCounterparty<FunctionId, DepartmentId, ProcessId>;
  counterpartyKey: string;
  kind: FirmLinkKind;
  label: string;
  nodeIds: string[];
  evidence: string[];
  contributors: string[];
  confidence: FirmLinkConfidence;
};

/** One entry of the org catalog, already carrying its short prompt key. */
export type FirmCatalog<FunctionId, DepartmentId, ProcessId> = {
  functions: Array<{ key: string; id: FunctionId; name: string }>;
  departments: Array<{
    key: string;
    id: DepartmentId;
    name: string;
    functionKey: string;
    description?: string;
  }>;
  processes: Array<{
    key: string;
    id: ProcessId;
    name: string;
    departmentKey: string;
    description?: string;
  }>;
  /** True when processes were left out to respect the prompt cap. */
  truncated: boolean;
};

export type FirmResolutionStep = {
  id: string;
  label: string;
  category: string;
  description?: string;
  actors: string[];
  sources: string[];
};

export type FirmDependencyMention = {
  contributor: string;
  text: string;
};

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Canonical form of an outside party's name, so "Customers" and "customer " meet. */
export function normalizeExternalName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s&]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Naive singular: "Customers" → "customer", but leave "Business" alone.
    .replace(/(?<=\p{L}{2}[^s\s])s$/u, "");
}

export function firmCounterpartyKey(
  counterparty: FirmCounterparty<string, string, string>,
): string {
  switch (counterparty.kind) {
    case "function":
      return `function:${counterparty.functionId}`;
    case "department":
      return `department:${counterparty.departmentId}`;
    case "process":
      return `process:${counterparty.processId}`;
    case "external":
      return `external:${normalizeExternalName(counterparty.name)}`;
  }
}

/**
 * Assigns short keys in hierarchy order. Processes past the cap are dropped
 * from the prompt — but never the source process itself, which the model must
 * be able to recognise in order to avoid linking it to itself.
 */
export function buildFirmCatalog<
  FunctionId extends string,
  DepartmentId extends string,
  ProcessId extends string,
>(input: {
  functions: Array<{ id: FunctionId; name: string }>;
  departments: Array<{
    id: DepartmentId;
    name: string;
    functionId: FunctionId;
    description?: string;
  }>;
  processes: Array<{
    id: ProcessId;
    name: string;
    departmentId: DepartmentId;
    description?: string;
  }>;
  sourceProcessId: ProcessId;
}): FirmCatalog<FunctionId, DepartmentId, ProcessId> {
  const functionKey = new Map<string, string>();
  const functions = input.functions.map((fn, index) => {
    const key = `F${index + 1}`;
    functionKey.set(fn.id, key);
    return { key, id: fn.id, name: fn.name };
  });

  const departmentKey = new Map<string, string>();
  const departments = input.departments
    .filter((department) => functionKey.has(department.functionId))
    .map((department, index) => {
      const key = `D${index + 1}`;
      departmentKey.set(department.id, key);
      return {
        key,
        id: department.id,
        name: department.name,
        functionKey: functionKey.get(department.functionId)!,
        description: clip(
          department.description,
          FIRM_LINK_CAPS.catalogDescriptionChars,
        ),
      };
    });

  const eligible = input.processes.filter((process) =>
    departmentKey.has(process.departmentId),
  );
  const source = eligible.find((process) => process.id === input.sourceProcessId);
  const others = eligible.filter(
    (process) => process.id !== input.sourceProcessId,
  );
  const kept = others.slice(0, FIRM_LINK_CAPS.catalogProcesses - (source ? 1 : 0));
  const included = new Set<string>(kept.map((process) => process.id));
  if (source) included.add(source.id);

  const processes = eligible
    .filter((process) => included.has(process.id))
    .map((process, index) => ({
      key: `P${index + 1}`,
      id: process.id,
      name: process.name,
      departmentKey: departmentKey.get(process.departmentId)!,
      description: clip(
        process.description,
        FIRM_LINK_CAPS.catalogDescriptionChars,
      ),
    }));

  return {
    functions,
    departments,
    processes,
    truncated: included.size < eligible.length,
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const FIRM_LINKS_SYSTEM_PROMPT = withUntrustedEvidenceBoundary(`You are an organisational analyst. You are given ONE business process (the "source process"), the steps of its mapped flow, what its contributors said about handoffs and dependencies, and a catalog of the organisation's functions (F keys), departments (D keys), and processes (P keys).

Your job: identify where work, information, or decisions cross the boundary of the source process — to or from another process, a department, a function, or a party outside the organisation — and resolve each one against the catalog.

For each link provide:
- direction: "outbound" if the source process sends work, output, or a request to the counterparty; "inbound" if it receives work, input, a trigger, or an approval from the counterparty.
- counterparty: the catalog key of the most specific match. Prefer a P key when the evidence names or clearly describes a catalog process; otherwise the D key of the department; a F key only when the evidence names a whole function and no single department fits. Use "EXTERNAL" for customers, vendors, partners, regulators, other group companies, or anyone outside the catalog.
- externalName: required when counterparty is "EXTERNAL" — a short canonical name for the party ("Customer", "Axonify Canada", "External auditor"). Omit otherwise.
- kind: "handoff" when responsibility for the work moves to or from the counterparty; "dependency" when the source process needs something from it (data, an approval, a system, a decision) but the work stays put.
- label: what crosses the boundary, as a short noun phrase ("Signed contract", "Approved purchase order", "Escalated ticket"). 2-8 words.
- nodeIds: the ids of the source-process steps where this happens. Every id must come from the steps you were given. Empty if no step fits.
- evidence: up to 3 short quotes or close paraphrases from the supplied evidence that show this link. Never invent evidence.
- contributors: the names of contributors whose evidence supports it, exactly as given.
- confidence: "high" if several contributors or a handoff step plus a contributor describe it, "medium" if one source describes it clearly, "low" if you are inferring the counterparty.

Rules:
- Only links that cross the source process's boundary. Steps performed by different roles INSIDE the source process are not links. Never use the source process's own P key as a counterparty.
- One link per counterparty and direction. Merge repeated mentions.
- If a mention could match a catalog entry but you are unsure which, choose the best match and mark it "low" — do not invent a new external party for something that is plausibly internal.
- If nothing crosses the boundary, return an empty list.
- At most ${FIRM_LINK_CAPS.linksPerProcess} links; keep the best-supported.

Use the provided tool to return the links.`);

const FIRM_LINKS_RESPONSE_SCHEMA: AIJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    links: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          direction: { type: "string", enum: ["outbound", "inbound"] },
          counterparty: { type: "string" },
          externalName: { type: "string" },
          kind: { type: "string", enum: ["handoff", "dependency"] },
          label: { type: "string" },
          nodeIds: { type: "array", items: { type: "string" } },
          evidence: { type: "array", items: { type: "string" } },
          contributors: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: [
          "direction",
          "counterparty",
          "kind",
          "label",
          "nodeIds",
          "evidence",
          "contributors",
          "confidence",
        ],
      },
    },
  },
  required: ["links"],
};

export function buildFirmLinksUserContent(input: {
  catalog: FirmCatalog<string, string, string>;
  sourceProcessId: string;
  steps: FirmResolutionStep[];
  dependencyMentions: FirmDependencyMention[];
}): string {
  const { catalog } = input;
  const source = catalog.processes.find(
    (process) => process.id === input.sourceProcessId,
  );
  return serializeUntrustedEvidence({
    sourceProcess: source
      ? {
          key: source.key,
          name: source.name,
          department: source.departmentKey,
          description: source.description,
        }
      : null,
    catalog: {
      functions: catalog.functions.map(({ key, name }) => ({ key, name })),
      departments: catalog.departments.map(
        ({ key, name, functionKey, description }) => ({
          key,
          name,
          function: functionKey,
          description,
        }),
      ),
      processes: catalog.processes.map(
        ({ key, name, departmentKey, description }) => ({
          key,
          name,
          department: departmentKey,
          description,
        }),
      ),
      ...(catalog.truncated
        ? { note: "Some processes were omitted; link to their department." }
        : {}),
    },
    steps: input.steps,
    contributorEvidence: input.dependencyMentions,
  });
}

export function buildFirmLinksAIRequest(userContent: string) {
  return {
    capability: "synthesis" as const,
    operation: "firm-link-resolution",
    system: FIRM_LINKS_SYSTEM_PROMPT,
    user: userContent,
    temperature: 0,
    maxTokens: FIRM_LINKS_MAX_TOKENS,
    timeoutMs: FIRM_LINKS_TIMEOUT_MS,
    maxRetries: FIRM_LINKS_MAX_RETRIES,
    tool: {
      name: FIRM_LINKS_TOOL_NAME,
      description:
        "Return the links where work crosses the boundary of the source process.",
      inputSchema: FIRM_LINKS_RESPONSE_SCHEMA,
    },
  };
}

// ---------------------------------------------------------------------------
// Normalizer — a provider that drifts from the schema degrades a link, never
// the whole resolution.
// ---------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<FirmLinkConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function normalizeFirmLinks<
  FunctionId extends string,
  DepartmentId extends string,
  ProcessId extends string,
>(
  payload: unknown,
  context: {
    catalog: FirmCatalog<FunctionId, DepartmentId, ProcessId>;
    sourceProcessId: ProcessId;
    knownNodeIds: readonly string[];
    knownContributors: readonly string[];
  },
): Array<NormalizedFirmLink<FunctionId, DepartmentId, ProcessId>> {
  const parsed = (payload ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(parsed.links) ? parsed.links : [];

  const functionsByKey = new Map(
    context.catalog.functions.map((entry) => [entry.key, entry.id]),
  );
  const departmentsByKey = new Map(
    context.catalog.departments.map((entry) => [entry.key, entry.id]),
  );
  const processesByKey = new Map(
    context.catalog.processes.map((entry) => [entry.key, entry.id]),
  );
  const knownNodeIds = new Set(context.knownNodeIds);
  const contributorByLower = new Map(
    context.knownContributors.map((name) => [name.trim().toLowerCase(), name]),
  );

  const merged = new Map<
    string,
    NormalizedFirmLink<FunctionId, DepartmentId, ProcessId>
  >();

  for (const raw of entries) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const direction = String(entry.direction);
    if (direction !== "outbound" && direction !== "inbound") continue;

    const ref = String(entry.counterparty ?? "").trim().toUpperCase();
    let counterparty: FirmCounterparty<FunctionId, DepartmentId, ProcessId>;
    if (ref === "EXTERNAL") {
      const name = clip(
        String(entry.externalName ?? ""),
        FIRM_LINK_CAPS.externalNameChars,
      );
      if (!name || !normalizeExternalName(name)) continue;
      counterparty = { kind: "external", name };
    } else if (processesByKey.has(ref)) {
      const processId = processesByKey.get(ref)!;
      if (processId === context.sourceProcessId) continue;
      counterparty = { kind: "process", processId };
    } else if (departmentsByKey.has(ref)) {
      counterparty = {
        kind: "department",
        departmentId: departmentsByKey.get(ref)!,
      };
    } else if (functionsByKey.has(ref)) {
      counterparty = { kind: "function", functionId: functionsByKey.get(ref)! };
    } else {
      continue;
    }

    const label = clip(String(entry.label ?? ""), FIRM_LINK_CAPS.labelChars);
    if (!label) continue;

    const kind: FirmLinkKind =
      entry.kind === "dependency" ? "dependency" : "handoff";
    const confidenceRaw = String(entry.confidence);
    const confidence: FirmLinkConfidence =
      confidenceRaw === "high" || confidenceRaw === "low"
        ? confidenceRaw
        : "medium";

    const link: NormalizedFirmLink<FunctionId, DepartmentId, ProcessId> = {
      direction,
      counterparty,
      counterpartyKey: firmCounterpartyKey(counterparty),
      kind,
      label,
      nodeIds: unique(
        asStringArray(entry.nodeIds).filter((id) => knownNodeIds.has(id)),
      ),
      evidence: unique(
        asStringArray(entry.evidence)
          .map((text) => clip(text, FIRM_LINK_CAPS.evidenceChars))
          .filter(Boolean),
      ).slice(0, FIRM_LINK_CAPS.evidencePerLink),
      contributors: unique(
        asStringArray(entry.contributors)
          .map((name) => contributorByLower.get(name.trim().toLowerCase()))
          .filter((name): name is string => name !== undefined),
      ).slice(0, FIRM_LINK_CAPS.contributorsPerLink),
      confidence,
    };

    const mergeKey = `${link.direction}|${link.counterpartyKey}`;
    const existing = merged.get(mergeKey);
    if (!existing) {
      merged.set(mergeKey, link);
      continue;
    }
    // Same counterparty and direction: one link, carrying everything both
    // mentions said. A "handoff" mention outranks a "dependency" one, since
    // work actually moving is the stronger claim.
    existing.kind =
      existing.kind === "handoff" || link.kind === "handoff"
        ? "handoff"
        : "dependency";
    existing.nodeIds = unique([...existing.nodeIds, ...link.nodeIds]);
    existing.evidence = unique([...existing.evidence, ...link.evidence]).slice(
      0,
      FIRM_LINK_CAPS.evidencePerLink,
    );
    existing.contributors = unique([
      ...existing.contributors,
      ...link.contributors,
    ]).slice(0, FIRM_LINK_CAPS.contributorsPerLink);
    if (CONFIDENCE_RANK[link.confidence] > CONFIDENCE_RANK[existing.confidence]) {
      existing.confidence = link.confidence;
    }
  }

  return Array.from(merged.values()).slice(0, FIRM_LINK_CAPS.linksPerProcess);
}

// ---------------------------------------------------------------------------
// Derived roles — "who actually does the work", from every step's actors.
// ---------------------------------------------------------------------------

export function deriveProcessRoles(
  steps: ReadonlyArray<{ actors: readonly string[] }>,
): Array<{ name: string; stepCount: number }> {
  const byKey = new Map<string, { name: string; stepCount: number }>();
  for (const step of steps) {
    const seen = new Set<string>();
    for (const actor of step.actors) {
      const name = actor.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const current = byKey.get(key);
      if (current) current.stepCount += 1;
      else byKey.set(key, { name, stepCount: 1 });
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.stepCount - a.stepCount || a.name.localeCompare(b.name))
    .slice(0, FIRM_LINK_CAPS.roles);
}

/** Whether a process has anything a resolution call could turn into a link. */
export function hasResolvableSignal(input: {
  steps: ReadonlyArray<{ category: string }>;
  dependencyMentions: readonly FirmDependencyMention[];
}): boolean {
  return (
    input.dependencyMentions.length > 0 ||
    input.steps.some((step) => step.category === "handoff")
  );
}

// ---------------------------------------------------------------------------

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function clip(value: string, max: number): string;
function clip(value: string | undefined, max: number): string | undefined;
function clip(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
