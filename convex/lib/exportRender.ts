import type { SummaryArtifactV2 } from "../summaryV2";
import { renderSummaryV2AsLegacyMarkdown } from "../summaryV2";

/**
 * Pure rendering for the workspace export (docs/client-offboarding-plan.md,
 * Phase 2, D3): readable Markdown and CSV beside the raw JSON. No database
 * access, so the build action and the tests share it.
 */

// ---- Paths -------------------------------------------------------------------

const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** One path segment, safe on Windows, macOS and Linux zip extractors. */
export function safeSegment(value: string, fallback = "untitled"): string {
  const cleaned = value
    .replace(UNSAFE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export type HierarchyInput = {
  functions: { id: string; name: string }[];
  departments: { id: string; name: string; functionId: string }[];
  processes: { id: string; name: string; departmentId: string }[];
};

export type ProcessPlace = {
  /** Path segments under `interviews/`, `processes/` and `audio/`. */
  segments: [string, string, string];
  /** "Function › Department › Process", as the workspace shows it. */
  label: string;
};

const UNFILED = "Unfiled";

/**
 * Where each process lives in the export. Two processes that would land on
 * the same path (same names in the same department) get their id appended,
 * so nothing is overwritten in the zip.
 */
export function placeProcesses(input: HierarchyInput): Map<string, ProcessPlace> {
  const functions = new Map(input.functions.map((f) => [f.id, f]));
  const departments = new Map(input.departments.map((d) => [d.id, d]));
  const draft = input.processes.map((process) => {
    const department = departments.get(process.departmentId);
    const fn = department ? functions.get(department.functionId) : undefined;
    const names = [fn?.name ?? UNFILED, department?.name ?? UNFILED, process.name];
    return {
      id: process.id,
      names,
      segments: names.map((name) => safeSegment(name)) as [string, string, string],
    };
  });
  const taken = new Map<string, number>();
  for (const row of draft) {
    const key = row.segments.join("/").toLowerCase();
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  const places = new Map<string, ProcessPlace>();
  for (const row of draft) {
    const key = row.segments.join("/").toLowerCase();
    const segments: [string, string, string] =
      (taken.get(key) ?? 0) > 1
        ? [row.segments[0], row.segments[1], `${row.segments[2]} (${row.id.slice(-6)})`]
        : row.segments;
    places.set(row.id, { segments, label: row.names.join(" › ") });
  }
  return places;
}

export const UNKNOWN_PROCESS: ProcessPlace = {
  segments: [UNFILED, UNFILED, "Deleted process"],
  label: "A deleted process",
};

export function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function isoDateTime(ts: number): string {
  return new Date(ts).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `2026-11-11-Ada Lovelace-<id>`: sorts by date, readable, unique. */
export function interviewStem(args: {
  createdAt: number;
  contributorName: string;
  conversationId: string;
}): string {
  return `${isoDate(args.createdAt)}-${safeSegment(args.contributorName, "contributor")}-${args.conversationId}`;
}

const EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

export function audioExtension(mimeType: string | undefined): string {
  const base = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  return EXTENSIONS[base] ?? "audio";
}

// ---- CSV -----------------------------------------------------------------------

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A leading =, +, - or @ makes spreadsheets run the cell as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---- Interviews ------------------------------------------------------------------

export type InterviewInput = {
  conversationId: string;
  processId: string;
  createdAt: number;
  title: string | null;
  contributorName: string;
  submittedByName: string | null;
  inputMode: "agent" | "voiceRecord" | "audioUpload";
  status: string;
  durationSeconds: number | null;
  summary: string | null;
  transcript: {
    role: string;
    content: string;
    time_in_call_secs: number;
    speakerId?: string;
    speakerName?: string;
  }[];
  speakerLabels: { speakerId: string; displayName: string }[];
};

export type AudioPlacement =
  | { status: "included"; path: string; partName: string }
  | { status: "missing"; reason: string };

const MODE_LABEL: Record<InterviewInput["inputMode"], string> = {
  agent: "AI interview",
  voiceRecord: "Voice recording",
  audioUpload: "Audio upload",
};

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function speakerOf(
  message: InterviewInput["transcript"][number],
  interview: InterviewInput,
  labels: Map<string, string>,
): string {
  if (message.speakerName) return message.speakerName;
  if (message.speakerId && labels.has(message.speakerId)) {
    return labels.get(message.speakerId)!;
  }
  if (message.role === "agent") return "Fabric interviewer";
  if (message.role === "user") return interview.contributorName;
  return message.speakerId ?? message.role;
}

export function renderInterview(
  interview: InterviewInput,
  place: ProcessPlace,
  audio: AudioPlacement | null,
): string {
  const labels = new Map(interview.speakerLabels.map((l) => [l.speakerId, l.displayName]));
  const lines: string[] = [`# ${interview.title ?? `Interview with ${interview.contributorName}`}`, ""];
  lines.push(
    `- **Contributor:** ${interview.contributorName}${
      interview.submittedByName ? ` (submitted by ${interview.submittedByName})` : ""
    }`,
    `- **Process:** ${place.label}`,
    `- **Recorded:** ${isoDateTime(interview.createdAt)}`,
    `- **Type:** ${MODE_LABEL[interview.inputMode]}`,
  );
  if (interview.durationSeconds !== null) {
    lines.push(`- **Length:** ${formatClock(interview.durationSeconds)}`);
  }
  if (interview.status !== "done") lines.push(`- **Status:** ${interview.status}`);
  if (audio?.status === "included") {
    lines.push(`- **Recording:** \`${audio.path}\` in \`${audio.partName}\``);
  } else if (audio?.status === "missing") {
    lines.push(`- **Recording:** not included (${audio.reason})`);
  }
  lines.push(`- **Fabric id:** ${interview.conversationId}`, "");

  if (interview.summary) lines.push("## Summary", "", interview.summary.trim(), "");

  lines.push("## Transcript", "");
  if (interview.transcript.length === 0) {
    lines.push("_No transcript was kept._", "");
  } else {
    for (const message of interview.transcript) {
      const text = message.content.trim();
      if (!text) continue;
      lines.push(
        `**${speakerOf(message, interview, labels)}** [${formatClock(message.time_in_call_secs)}]: ${text}`,
        "",
      );
    }
  }
  return lines.join("\n");
}

// ---- Overviews and processes -------------------------------------------------------

export type OverviewInput = {
  name: string;
  summaryV2: SummaryArtifactV2 | null;
  legacySummary: string | null;
  updatedAt: number | null;
};

function renderOverviewBody(overview: OverviewInput): string {
  if (overview.summaryV2) return renderSummaryV2AsLegacyMarkdown(overview.summaryV2);
  if (overview.legacySummary) return overview.legacySummary.trim();
  return "_No overview has been generated._";
}

export function renderOverview(kind: "Function" | "Department", label: string, overview: OverviewInput): string {
  return [
    `# ${kind}: ${label}`,
    "",
    ...(overview.updatedAt ? [`_Overview last generated ${isoDateTime(overview.updatedAt)}._`, ""] : []),
    renderOverviewBody(overview),
    "",
  ].join("\n");
}

export type FlowNodeInput = {
  id: string;
  label: string;
  category: string;
  description: string | null;
  actors: string[];
  tools: string[];
  painPoints: string[];
};

export type ProcessDocInput = {
  processId: string;
  description: string | null;
  overview: OverviewInput;
  interviewCount: number;
  flow: {
    generatedAt: number;
    stale: boolean;
    nodes: FlowNodeInput[];
    edges: { source: string; target: string; label: string | null; type: string }[];
    bottlenecks: string[];
  } | null;
  recommendations: {
    title: string;
    decisionStatus: string;
    problem: string | null;
    proposedChange: string | null;
    pilot: string | null;
  }[];
};

export function renderProcess(doc: ProcessDocInput, place: ProcessPlace): string {
  const lines: string[] = [`# ${place.segments[2]}`, "", `_${place.label}_`, ""];
  if (doc.description) lines.push(doc.description.trim(), "");
  lines.push(`Interviews: ${doc.interviewCount}`, "");

  lines.push("## Overview", "");
  if (doc.overview.updatedAt) {
    lines.push(`_Last generated ${isoDateTime(doc.overview.updatedAt)}._`, "");
  }
  lines.push(renderOverviewBody(doc.overview), "");

  lines.push("## Process map", "");
  if (!doc.flow) {
    lines.push("_No process map has been generated._", "");
  } else {
    lines.push(
      `_Generated ${isoDateTime(doc.flow.generatedAt)}${doc.flow.stale ? "; newer interviews have arrived since" : ""}._`,
      "",
    );
    const labels = new Map(doc.flow.nodes.map((n) => [n.id, n.label]));
    doc.flow.nodes.forEach((node, index) => {
      lines.push(`${index + 1}. **${node.label}** (${node.category})`);
      if (node.description) lines.push(`   ${node.description}`);
      if (node.actors.length) lines.push(`   - Who: ${node.actors.join(", ")}`);
      if (node.tools.length) lines.push(`   - Tools: ${node.tools.join(", ")}`);
      if (node.painPoints.length) lines.push(`   - Pain points: ${node.painPoints.join("; ")}`);
    });
    lines.push("");
    if (doc.flow.edges.length) {
      lines.push("### Connections", "");
      for (const edge of doc.flow.edges) {
        const from = labels.get(edge.source) ?? edge.source;
        const to = labels.get(edge.target) ?? edge.target;
        lines.push(`- ${from} → ${to}${edge.label ? ` (${edge.label})` : ""}`);
      }
      lines.push("");
    }
    if (doc.flow.bottlenecks.length) {
      lines.push("### Bottlenecks", "", ...doc.flow.bottlenecks.map((b) => `- ${b}`), "");
    }
  }

  lines.push("## Recommendations", "");
  if (doc.recommendations.length === 0) {
    lines.push("_None._", "");
  } else {
    for (const rec of doc.recommendations) {
      lines.push(`### ${rec.title}`, "", `Status: ${rec.decisionStatus.replace(/_/g, " ")}`, "");
      if (rec.problem) lines.push(`**Problem.** ${rec.problem}`, "");
      if (rec.proposedChange) lines.push(`**Proposed change.** ${rec.proposedChange}`, "");
      if (rec.pilot) lines.push(`**Pilot.** ${rec.pilot}`, "");
    }
  }
  return lines.join("\n");
}

// ---- README ---------------------------------------------------------------------------

export type ReadmeInput = {
  workspaceName: string;
  exportedAt: number;
  interviewCount: number;
  processCount: number;
  memberCount: number;
  audioIncluded: number;
  audioMissing: number;
  audioParts: string[];
  tables: { name: string; rows: number }[];
  excluded: { name: string; why: string }[];
};

export function renderReadme(input: ReadmeInput): string {
  const lines = [
    `# ${input.workspaceName}: Fabric workspace export`,
    "",
    `Exported ${isoDateTime(input.exportedAt)} (UTC) by Biz Group.`,
    "",
    "## What's here",
    "",
    `- \`interviews/\`: one Markdown file per interview (${input.interviewCount}), with its summary and full transcript, filed by function, department and process.`,
    `- \`processes/\`: one Markdown file per process (${input.processCount}), with its overview, process map and recommendations.`,
    "- `overviews/`: the function and department overviews.",
    `- \`members.csv\`: the workspace's members (${input.memberCount}) and pending invitations.`,
    "- `audio-index.csv`: every interview's recording, the zip part that holds it, or why it isn't included.",
    "- `data/`: the complete records as JSON, one file per kind of record, for import into other systems.",
    "- `manifest.json`: the counts below, machine-readable.",
    "",
    "## Recordings",
    "",
    input.audioParts.length > 0
      ? `${input.audioIncluded} recording(s) are in the separate audio zip file(s): ${input.audioParts.map((p) => `\`${p}\``).join(", ")}. Unzip them beside this folder and the paths in the interview files and audio-index.csv will match.`
      : "No recordings are included.",
    ...(input.audioMissing > 0
      ? ["", `${input.audioMissing} recording(s) could not be included; audio-index.csv says why for each.`]
      : []),
    "",
    "## Records in data/",
    "",
    "| File | Records |",
    "|---|---|",
    ...input.tables.map((t) => `| data/${t.name}.json | ${t.rows} |`),
    "",
    "## Not included",
    "",
    ...input.excluded.map((t) => `- **${t.name}**: ${t.why}`),
    "",
    "Times are UTC. Ids are Fabric's own and are kept so records can be cross-referenced.",
    "",
  ];
  return lines.join("\n");
}

/** Groups the excluded tables' reasons so the README reads as a short list. */
export function groupExclusions(policy: Record<string, true | string>): { name: string; why: string }[] {
  const byReason = new Map<string, string[]>();
  for (const [table, value] of Object.entries(policy)) {
    if (value === true) continue;
    byReason.set(value, [...(byReason.get(value) ?? []), table]);
  }
  return [...byReason.entries()].map(([why, tables]) => ({ name: tables.join(", "), why }));
}
