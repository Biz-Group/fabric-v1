import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { csvCell } from "../../../convex/lib/csv";

type Page = FunctionReturnType<typeof api.conversations.listAllForOrg>["page"];
type Row = Page[number];

const CSV_COLUMNS = [
  "id",
  "created_at",
  "contributor",
  // Populated only when an admin filed the recording on someone else's behalf;
  // blank means the contributor submitted it themselves.
  "submitted_by",
  "consent_attested_at",
  "function",
  "department",
  "process",
  "status",
  "duration_seconds",
  "message_count",
  "summary",
] as const;

// Quotes, and neutralises formula injection: contributor, process and summary
// text is member-controlled and this file is opened by admins in Excel.
const escape = csvCell;

function rowToCsv(r: Row): string {
  return [
    escape(r._id),
    escape(new Date(r._creationTime).toISOString()),
    escape(r.contributorName),
    escape(r.submittedByName ?? ""),
    escape(
      r.consentAttestedAt
        ? new Date(r.consentAttestedAt).toISOString()
        : "",
    ),
    escape(r.functionName),
    escape(r.departmentName),
    escape(r.processName),
    escape(r.status),
    escape(r.durationSeconds ?? ""),
    escape(r.transcript?.length ?? 0),
    escape(r.summary ?? ""),
  ].join(",");
}

export function buildConversationsCsv(rows: Row[]): string {
  const header = CSV_COLUMNS.join(",");
  const body = rows.map(rowToCsv).join("\n");
  return `${header}\n${body}\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
