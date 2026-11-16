/**
 * CSV cells, shared by the workspace export (server) and the admin and
 * tenants-console exports (browser). Pure, so it is safe in both bundles.
 */

/**
 * Quotes a cell when it needs it, and neutralises formula injection: a leading
 * =, +, -, @, tab or carriage return makes Excel, Sheets and Numbers run the
 * cell as a formula, so a member who names themselves `=HYPERLINK(...)` would
 * run it on the admin who opens the export. The leading apostrophe makes it
 * text. Negative numbers get it too, which spreadsheets still show as text.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
