import type { Doc } from "../_generated/dataModel";

/**
 * Folding raw MCP calls into per-workspace daily counts (Phase 3, B2). Pure,
 * so the nightly fold, the console's live "today" and the tests share it.
 */

export type McpCallRow = Pick<Doc<"mcpCalls">, "clerkOrgId" | "userId" | "clientId" | "tool" | "outcome">;

export type McpDayCounts = {
  clerkOrgId: string;
  period: string;
  calls: number;
  failures: number;
  users: number;
  tools: Array<{ tool: string; calls: number; failures: number }>;
  clients: Array<{ clientId: string; calls: number }>;
};

/** A refusal or a failure, as opposed to an answer (found or not). */
export function isFailure(outcome: Doc<"mcpCalls">["outcome"]): boolean {
  return outcome === "error" || outcome === "badArguments" || outcome === "rateLimited";
}

export function foldMcpCalls(period: string, rows: readonly McpCallRow[]): McpDayCounts[] {
  type Acc = {
    calls: number;
    failures: number;
    users: Set<string>;
    tools: Map<string, { calls: number; failures: number }>;
    clients: Map<string, number>;
  };
  const byOrg = new Map<string, Acc>();
  for (const row of rows) {
    let acc = byOrg.get(row.clerkOrgId);
    if (!acc) {
      acc = { calls: 0, failures: 0, users: new Set(), tools: new Map(), clients: new Map() };
      byOrg.set(row.clerkOrgId, acc);
    }
    const failed = isFailure(row.outcome);
    acc.calls += 1;
    if (failed) acc.failures += 1;
    if (row.userId) acc.users.add(row.userId);
    const tool = acc.tools.get(row.tool) ?? { calls: 0, failures: 0 };
    tool.calls += 1;
    if (failed) tool.failures += 1;
    acc.tools.set(row.tool, tool);
    acc.clients.set(row.clientId, (acc.clients.get(row.clientId) ?? 0) + 1);
  }
  return [...byOrg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clerkOrgId, acc]) => ({
      clerkOrgId,
      period,
      calls: acc.calls,
      failures: acc.failures,
      users: acc.users.size,
      tools: [...acc.tools.entries()]
        .map(([tool, counts]) => ({ tool, ...counts }))
        .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool)),
      clients: [...acc.clients.entries()]
        .map(([clientId, calls]) => ({ clientId, calls }))
        .sort((a, b) => b.calls - a.calls || a.clientId.localeCompare(b.clientId)),
    }));
}

/** Sums daily counts across a range. Users can't be summed across days, so `peakDailyUsers` stands in. */
export function sumDays(days: readonly McpDayCounts[]) {
  const tools = new Map<string, { calls: number; failures: number }>();
  const clients = new Map<string, number>();
  let calls = 0;
  let failures = 0;
  let peakDailyUsers = 0;
  for (const day of days) {
    calls += day.calls;
    failures += day.failures;
    peakDailyUsers = Math.max(peakDailyUsers, day.users);
    for (const t of day.tools) {
      const acc = tools.get(t.tool) ?? { calls: 0, failures: 0 };
      acc.calls += t.calls;
      acc.failures += t.failures;
      tools.set(t.tool, acc);
    }
    for (const c of day.clients) clients.set(c.clientId, (clients.get(c.clientId) ?? 0) + c.calls);
  }
  return {
    calls,
    failures,
    peakDailyUsers,
    activeDays: days.filter((day) => day.calls > 0).length,
    tools: [...tools.entries()].map(([tool, counts]) => ({ tool, ...counts })).sort((a, b) => b.calls - a.calls),
    clients: [...clients.entries()].map(([clientId, n]) => ({ clientId, calls: n })).sort((a, b) => b.calls - a.calls),
  };
}

/**
 * A readable name for an OAuth client: a CIMD client id is a URL, shown by its
 * host; a Clerk client id is shown as is unless FABRIC_MCP_CLIENT_NAMES
 * ("id=Name,id2=Name 2") names it.
 */
export function clientLabel(clientId: string, names: string | undefined): string {
  for (const pair of (names ?? "").split(",")) {
    const [id, ...rest] = pair.split("=");
    if (id?.trim() === clientId && rest.length) return rest.join("=").trim();
  }
  try {
    const url = new URL(clientId);
    if (url.protocol === "https:") return url.host;
  } catch {
    // Not a URL.
  }
  return clientId;
}
