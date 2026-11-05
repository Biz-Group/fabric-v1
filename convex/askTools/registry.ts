import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import type {
  GenericValidator,
  ObjectType,
  PropertyValidators,
} from "convex/values";
import type { OrgViewer } from "../lib/orgAuth";
import { ASK_TOOL_NAMES, type AskDisplayKind, type AskToolName } from "../lib/askSchema";
import type { AskDisplayResult } from "./display";
import {
  MAX_BUDGET_TOKENS,
  type AskToolResult,
  type FabricSourceType,
} from "./results";

/**
 * The AskFabric tool registry contract (FR-1.1, FR-1.2, FR-1.11).
 *
 * Plain data plus functions, with no Convex `internal` import: an entry names
 * its executor by function path, so the registry can later be served over MCP
 * and never creates a type cycle through the generated API.
 */

/** Identity always comes from the turn, never from the model (FR-1.2). */
export const FORBIDDEN_INPUT_FIELDS = [
  "orgId",
  "clerkOrgId",
  "userId",
  "role",
  "tokenIdentifier",
] as const;

export type AskToolAccess = "member" | "admin";

export type JsonSchema = { [key: string]: unknown };

export type AskToolExecutorRef = FunctionReference<
  "query",
  "internal",
  { viewer: OrgViewer } & Record<string, unknown>,
  AskToolResult
>;

/** A display tool's executor also takes the turn's grounding set (`askDisplayQuery`). */
export type AskDisplayExecutorRef = FunctionReference<
  "query",
  "internal",
  { viewer: OrgViewer; allowed: string[] } & Record<string, unknown>,
  AskDisplayResult
>;

export type AskToolDefinition<Input extends PropertyValidators> = {
  name: AskToolName;
  /** Model-facing: when to use the tool and what it returns. */
  description: string;
  /** The executor's model-facing validators; the JSON schema is derived. */
  input: Input;
  /** Model-facing description per input field. */
  inputDescriptions: { [K in keyof Input]: string };
  /** Mirrors the UI query's rule: any member, or admins only (FR-1.3). */
  access: AskToolAccess;
  /** The registered executor, checked to be an internal query. */
  executor: unknown;
  /** Its Convex function path, e.g. `askTools/hierarchy:searchHierarchy`. */
  executorPath: string;
  /** One line on what a found result holds, for the model and for reviewers. */
  output: string;
  /** The FR-1.8 source formats this tool may emit. */
  citationSources: readonly FabricSourceType[];
  /** Output budget in tokens: default 2K, at most 4K (FR-1.9). */
  budgetTokens: number;
  /** The tool name recorded in telemetry (FR-8.2). */
  telemetryName: AskToolName;
  /** The status-line and trace label for a call (FR-2.15). Never generic. */
  label: (input: ObjectType<Input>) => string;
  /**
   * Set on the display tool (D56). Its executor is an `askDisplayQuery`, it
   * returns no data and no citations, and the loop runs it after the step's
   * data tools. `telemetry` names each component in tool telemetry.
   */
  display?: { telemetry: Partial<Record<AskDisplayKind, AskToolName>> };
};

export type RegisteredAskTool = AskToolDefinition<PropertyValidators> & {
  inputSchema: JsonSchema;
  executorRef: AskToolExecutorRef;
};

const REQUIRED_FIELDS = [
  "name",
  "description",
  "input",
  "inputDescriptions",
  "access",
  "executor",
  "executorPath",
  "output",
  "citationSources",
  "budgetTokens",
  "telemetryName",
  "label",
] as const;

export class ToolRegistrationError extends Error {
  constructor(tool: string, problem: string) {
    super(`AskFabric tool "${tool}": ${problem}`);
    this.name = "ToolRegistrationError";
  }
}

/** Every field name a validator tree declares, at any depth. */
function fieldNames(validator: GenericValidator): string[] {
  switch (validator.kind) {
    case "object":
      return Object.entries(validator.fields).flatMap(([key, field]) => [
        key,
        ...fieldNames(field),
      ]);
    case "array":
      return fieldNames(validator.element);
    case "union":
      return validator.members.flatMap(fieldNames);
    default:
      return [];
  }
}

/**
 * Converts a Convex validator to the JSON schema Claude's strict tool use
 * accepts: every property required, `additionalProperties: false`, and
 * nullable values as `anyOf` with null (verified on Foundry in S2).
 */
export function toStrictJsonSchema(
  validator: GenericValidator,
  description?: string,
): JsonSchema {
  const withDescription = (schema: JsonSchema): JsonSchema =>
    description ? { ...schema, description } : schema;
  if (validator.isOptional === "optional") {
    throw new Error(
      "Strict tool inputs cannot be optional; use a union with v.null()",
    );
  }
  switch (validator.kind) {
    case "string":
    case "id":
      return withDescription({ type: "string" });
    case "float64":
      return withDescription({ type: "number" });
    case "boolean":
      return withDescription({ type: "boolean" });
    case "null":
      return withDescription({ type: "null" });
    case "literal":
      return withDescription({ type: typeof validator.value, enum: [validator.value] });
    case "array":
      return withDescription({
        type: "array",
        items: toStrictJsonSchema(validator.element),
      });
    case "object":
      return withDescription({
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          Object.entries(validator.fields).map(([key, field]) => [
            key,
            toStrictJsonSchema(field),
          ]),
        ),
        required: Object.keys(validator.fields),
      });
    case "union": {
      const members = validator.members;
      const isStringLiteral = (m: GenericValidator) =>
        m.kind === "literal" && typeof m.value === "string";
      const literals = members.filter(isStringLiteral);
      const rest = members.filter((m) => !isStringLiteral(m));
      // String literals read best as one enum, nullable or not.
      const enumSchema =
        literals.length > 0
          ? {
              type: "string",
              enum: literals.map((m) => (m as { value: string }).value),
            }
          : null;
      if (enumSchema && rest.length === 0) return withDescription(enumSchema);
      return withDescription({
        anyOf: [
          ...(enumSchema ? [enumSchema] : []),
          ...rest.map((member) => toStrictJsonSchema(member)),
        ],
      });
    }
    default:
      throw new Error(`Unsupported validator kind in a tool input: ${validator.kind}`);
  }
}

function inputObjectSchema(
  input: PropertyValidators,
  descriptions: Record<string, string>,
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(input).map(([key, field]) => [
        key,
        toStrictJsonSchema(field, descriptions[key]),
      ]),
    ),
    required: Object.keys(input),
  };
}

/**
 * Registers a tool, failing loudly when the contract isn't met: a missing
 * field, an identity field in the input, an executor that isn't an internal
 * query, or a budget above the hard cap.
 */
export function defineTool<Input extends PropertyValidators>(
  definition: AskToolDefinition<Input>,
): RegisteredAskTool {
  const name = String(definition.name ?? "(unnamed)");
  for (const field of REQUIRED_FIELDS) {
    const value = (definition as Record<string, unknown>)[field];
    if (value === undefined || value === null || value === "") {
      throw new ToolRegistrationError(name, `missing ${field}`);
    }
  }
  if (!(ASK_TOOL_NAMES as readonly string[]).includes(definition.name)) {
    throw new ToolRegistrationError(name, "name is not in ASK_TOOL_NAMES");
  }

  const forbidden = new Set<string>(
    FORBIDDEN_INPUT_FIELDS.map((field) => field.toLowerCase()),
  );
  for (const [key, validator] of Object.entries(definition.input)) {
    for (const field of [key, ...fieldNames(validator)]) {
      if (forbidden.has(field.toLowerCase())) {
        throw new ToolRegistrationError(
          name,
          `input field "${field}" is an identity field; identity comes from the turn`,
        );
      }
    }
    if (!(key in definition.inputDescriptions)) {
      throw new ToolRegistrationError(name, `no description for input "${key}"`);
    }
  }

  const executor = definition.executor as {
    isQuery?: boolean;
    isInternal?: boolean;
  };
  if (executor.isQuery !== true || executor.isInternal !== true) {
    throw new ToolRegistrationError(
      name,
      "executor must be an internal query (read-only, not client-callable)",
    );
  }
  if (!/^askTools\/[A-Za-z]+:[A-Za-z]+$/.test(definition.executorPath)) {
    throw new ToolRegistrationError(name, "executorPath must be askTools/<module>:<export>");
  }
  if (
    !Number.isFinite(definition.budgetTokens) ||
    definition.budgetTokens <= 0 ||
    definition.budgetTokens > MAX_BUDGET_TOKENS
  ) {
    throw new ToolRegistrationError(
      name,
      `budgetTokens must be between 1 and ${MAX_BUDGET_TOKENS}`,
    );
  }
  if (definition.display !== undefined && definition.citationSources.length > 0) {
    throw new ToolRegistrationError(name, "a display tool returns nothing citable");
  }
  if (definition.display === undefined && definition.citationSources.length === 0) {
    throw new ToolRegistrationError(name, "citationSources is empty");
  }

  return {
    ...(definition as unknown as AskToolDefinition<PropertyValidators>),
    inputSchema: inputObjectSchema(
      definition.input,
      definition.inputDescriptions as Record<string, string>,
    ),
    executorRef: makeFunctionReference<"query">(
      definition.executorPath,
    ) as unknown as AskToolExecutorRef,
  };
}

/** The tool definitions as the Messages API takes them, in registry order. */
export function toApiTools(tools: readonly RegisteredAskTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
    strict: true as const,
  }));
}

/**
 * Strict tool use compiles every schema into a grammar, and Claude rejects a
 * request whose tools hold more than 16 union-typed parameters in total
 * (`anyOf` or a type array), counted across all tools. Found on dev
 * 2026-11-03, when the full catalog had 31: optional inputs now use sentinel
 * values ("", [], -1, "org") instead of null.
 */
export const MAX_UNION_PARAMETERS = 16;

export function unionParameterCount(schema: JsonSchema): number {
  let count = 0;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as JsonSchema;
    if (Array.isArray(record.anyOf) || Array.isArray(record.type)) count += 1;
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  };
  visit(schema);
  return count;
}

/**
 * Claude rejects a request with more strict tools than this (found on dev
 * 2026-11-05, at 21). Every tool stays strict: with one non-strict tool in the
 * mix, the model sometimes wrote tool calls as text until it hit max_tokens.
 */
export const MAX_STRICT_TOOLS = 20;

export function assertWithinStrictLimits(tools: readonly RegisteredAskTool[]): void {
  if (tools.length > MAX_STRICT_TOOLS) {
    throw new ToolRegistrationError(
      "(catalog)",
      `${tools.length} strict tools; strict tool use allows ${MAX_STRICT_TOOLS}`,
    );
  }
  const total = tools.reduce((sum, tool) => sum + unionParameterCount(tool.inputSchema), 0);
  if (total > MAX_UNION_PARAMETERS) {
    throw new ToolRegistrationError(
      "(catalog)",
      `${total} union-typed parameters across all tools; strict tool use allows ${MAX_UNION_PARAMETERS}`,
    );
  }
}
