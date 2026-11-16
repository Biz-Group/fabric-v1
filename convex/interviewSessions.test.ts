/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { INTERVIEW_RATE_LIMITS } from "./lib/interviewLimits";
import { NEW_SESSION_GRACE_MS } from "./interviewSessions";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://interviews.test";
const ORG = "org_interviews";
const OTHER_ORG = "org_other";
const AGENT = "agent_test";

type Role = "viewer" | "contributor" | "admin";

function identity(user: string, orgId = ORG) {
  return {
    tokenIdentifier: `${ISSUER}|${user}`,
    subject: user,
    issuer: ISSUER,
    name: user,
    email: `${user}@example.test`,
    orgId,
    orgSlug: orgId,
  };
}

async function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const users: Record<string, Id<"users">> = {};
    const add = async (name: string, role: Role, orgId = ORG) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|${name}`,
        name,
        email: `${name}@example.test`,
        profileComplete: true,
      });
      await ctx.db.insert("memberships", { tokenIdentifier: `${ISSUER}|${name}`, userId, clerkOrgId: orgId, role, createdAt: 0 });
      users[name] = userId;
    };
    await add("cara", "contributor");
    await add("carl", "contributor");
    await add("vic", "viewer");
    await add("ada", "admin");
    await add("otto", "contributor", OTHER_ORG);
    const process = async (orgId: string) => {
      const fn = await ctx.db.insert("functions", { name: "Ops", sortOrder: 0, clerkOrgId: orgId });
      const dept = await ctx.db.insert("departments", { functionId: fn, name: "Payroll", sortOrder: 0, clerkOrgId: orgId });
      return await ctx.db.insert("processes", { departmentId: dept, name: "Payroll run", sortOrder: 0, clerkOrgId: orgId });
    };
    return { users, processId: await process(ORG), otherProcessId: await process(OTHER_ORG) };
  });
  const as = (user: string, orgId = ORG) => t.withIdentity(identity(user, orgId));
  const sessions = () => t.run((ctx) => ctx.db.query("interviewSessions").collect());
  return { t, ...ids, as, sessions };
}

/** ElevenLabs: token endpoint and per-conversation status. */
function stubElevenLabs(opts: { token?: Record<string, unknown> | number; statuses?: Record<string, string | number> } = {}) {
  let issued = 0;
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/v1/convai/conversation/token") {
      if (typeof opts.token === "number") return json({ detail: "no" }, opts.token);
      issued += 1;
      return json(opts.token ?? { token: `tok_${issued}`, conversation_id: `conv_${issued}` });
    }
    const id = url.pathname.split("/").pop()!;
    const status = opts.statuses?.[id] ?? 404;
    return typeof status === "number" ? json({ detail: "not found" }, status) : json({ conversation_id: id, status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("ELEVENLABS_API_KEY", "el_test_key");
  vi.stubEnv("ELEVENLABS_AGENT_ID", AGENT);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("issuing an interview", () => {
  test("a contributor gets a token for their own process, recorded with its conversation id", async () => {
    const s = await setup();
    const fetchMock = stubElevenLabs();
    expect(await s.as("cara").action(api.interviewSessions.startInterview, { processId: s.processId })).toEqual({
      conversationToken: "tok_1",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${AGENT}`);
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("el_test_key");
    expect(await s.sessions()).toMatchObject([
      { clerkOrgId: ORG, userId: s.users.cara, processId: s.processId, status: "issued", elevenlabsConversationId: "conv_1" },
    ]);
  });

  test("viewers, other workspaces' processes and the signed-out are refused before ElevenLabs is called", async () => {
    const s = await setup();
    const fetchMock = stubElevenLabs();
    await expect(s.as("vic").action(api.interviewSessions.startInterview, { processId: s.processId })).rejects.toThrow();
    await expect(s.as("cara").action(api.interviewSessions.startInterview, { processId: s.otherProcessId })).rejects.toThrow(
      /no longer exists/,
    );
    await expect(s.t.action(api.interviewSessions.startInterview, { processId: s.processId })).rejects.toThrow();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/conversation/token"))).toHaveLength(0);
    expect(await s.sessions()).toEqual([]);
  });

  test("a failed token request frees the slot", async () => {
    const s = await setup();
    stubElevenLabs({ token: 500 });
    await expect(s.as("cara").action(api.interviewSessions.startInterview, { processId: s.processId })).rejects.toThrow(
      /Couldn't start the interview/,
    );
    expect((await s.sessions()).map((x) => x.status)).toEqual(["expired"]);
    stubElevenLabs();
    await s.as("cara").action(api.interviewSessions.startInterview, { processId: s.processId });
  });
});

describe("one open interview at a time", () => {
  /** Moves every session's issue time back, past the new-session grace. */
  const age = (s: Awaited<ReturnType<typeof setup>>) =>
    s.t.run(async (ctx) => {
      for (const row of await ctx.db.query("interviewSessions").collect()) {
        await ctx.db.patch("interviewSessions", row._id, { issuedAt: row.issuedAt - NEW_SESSION_GRACE_MS - 1 });
      }
    });
  const start = (s: Awaited<ReturnType<typeof setup>>, user = "cara") =>
    s.as(user).action(api.interviewSessions.startInterview, { processId: s.processId });

  test("refused while ElevenLabs says the first is live", async () => {
    const s = await setup();
    stubElevenLabs({ statuses: { conv_1: "in-progress" } });
    await start(s);
    await age(s);
    await expect(start(s)).rejects.toThrow(/already have an AI interview open/);
    // Someone else in the workspace is unaffected.
    await start(s, "carl");
  });

  test("a finished or never-connected interview doesn't block the next, after the first minute", async () => {
    const s = await setup();
    // conv_1 ended; conv_2 was never connected, so ElevenLabs has no record (404).
    stubElevenLabs({ statuses: { conv_1: "done" } });
    await start(s);
    await age(s);
    await start(s);
    await age(s);
    await start(s);
    expect((await s.sessions()).map((x) => x.status)).toEqual(["expired", "expired", "issued"]);
  });

  test("tokens can't be collected back to back: a new session holds the slot for a minute", async () => {
    const s = await setup();
    // What real ElevenLabs returns for a token that hasn't connected yet.
    const fetchMock = stubElevenLabs();
    await start(s);
    await expect(start(s)).rejects.toThrow(/already have an AI interview open/);
    // Refused without asking ElevenLabs.
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/conversations/"))).toHaveLength(0);
    await age(s);
    await start(s);
    expect((await s.sessions()).map((x) => x.status)).toEqual(["expired", "issued"]);
  });

  test("parallel issues can't both slip through", async () => {
    const s = await setup();
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => s.as("cara").mutation(internal.interviewSessions.issueSession, { processId: s.processId })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("daily caps", () => {
  /** Issues one interview and closes it again, as a finished interview would be. */
  const issueAndClose = async (s: Awaited<ReturnType<typeof setup>>, user: string) => {
    const sessionId = await s.as(user).mutation(internal.interviewSessions.issueSession, { processId: s.processId });
    await s.t.mutation(internal.interviewSessions.expireSession, { sessionId });
  };

  test(`a member gets ${INTERVIEW_RATE_LIMITS.interviewUser.rate} a day`, async () => {
    const s = await setup();
    for (let i = 0; i < INTERVIEW_RATE_LIMITS.interviewUser.rate; i++) await issueAndClose(s, "cara");
    await expect(
      s.as("cara").mutation(internal.interviewSessions.issueSession, { processId: s.processId }),
    ).rejects.toThrow(/reached today's limit for AI interviews/);
    // The cap is per member.
    await issueAndClose(s, "carl");
  });

  test("the workspace cap applies across members", async () => {
    const s = await setup();
    const perMember = INTERVIEW_RATE_LIMITS.interviewUser.rate;
    const members = Math.ceil(INTERVIEW_RATE_LIMITS.interviewOrg.rate / perMember);
    await s.t.run(async (ctx) => {
      for (let m = 0; m < members; m++) {
        const name = `m${m}`;
        const userId = await ctx.db.insert("users", { tokenIdentifier: `${ISSUER}|${name}`, name, email: `${name}@x.test`, profileComplete: true });
        await ctx.db.insert("memberships", { tokenIdentifier: `${ISSUER}|${name}`, userId, clerkOrgId: ORG, role: "contributor", createdAt: 0 });
      }
    });
    for (let m = 0; m < members; m++) for (let i = 0; i < perMember; i++) await issueAndClose(s, `m${m}`);
    await expect(
      s.as("cara").mutation(internal.interviewSessions.issueSession, { processId: s.processId }),
    ).rejects.toThrow(/Your workspace has reached today's limit/);
    // Another workspace has its own cap.
    await s.as("otto", OTHER_ORG).mutation(internal.interviewSessions.issueSession, { processId: s.otherProcessId });
  }, 60_000);
});

describe("import binding", () => {
  function stubDoneConversation(id: string, startSecs: number) {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          conversation_id: id,
          agent_id: AGENT,
          status: "done",
          transcript: [{ role: "user", message: "We run payroll monthly.", time_in_call_secs: 1 }],
          metadata: { call_duration_secs: 60, start_time_unix_secs: startSecs },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  }

  async function issued(s: Awaited<ReturnType<typeof setup>>, user: string) {
    stubElevenLabs();
    await s.as(user).action(api.interviewSessions.startInterview, { processId: s.processId });
    const rows = await s.sessions();
    return rows[rows.length - 1].elevenlabsConversationId!;
  }

  const now = () => Math.floor(Date.now() / 1000);

  test("enforced: only the member it was issued to, or an admin, can import it", async () => {
    const s = await setup();
    vi.stubEnv("INTERVIEW_SESSIONS_ENFORCED_FROM", "1");
    const conv = await issued(s, "cara");

    stubDoneConversation(conv, now());
    await expect(
      s.as("carl").action(api.postCall.fetchConversation, { elevenlabsConversationId: conv, processId: s.processId }),
    ).rejects.toThrow(/wasn't started from Fabric by you/);
    expect(await s.t.run((ctx) => ctx.db.query("conversations").collect())).toEqual([]);

    expect(
      await s.as("cara").action(api.postCall.fetchConversation, { elevenlabsConversationId: conv, processId: s.processId }),
    ).toEqual({ status: "done" });
    expect((await s.sessions()).map((x) => x.status)).toEqual(["imported"]);
  });

  test("enforced: an admin can import a member's interview", async () => {
    const s = await setup();
    vi.stubEnv("INTERVIEW_SESSIONS_ENFORCED_FROM", "1");
    const conv = await issued(s, "cara");
    stubDoneConversation(conv, now());
    expect(
      await s.as("ada").action(api.postCall.fetchConversation, { elevenlabsConversationId: conv, processId: s.processId }),
    ).toEqual({ status: "done" });
  });

  test("enforced: a conversation Fabric never issued is refused, unless it predates the switch-over", async () => {
    const s = await setup();
    const cutover = Date.now();
    vi.stubEnv("INTERVIEW_SESSIONS_ENFORCED_FROM", String(cutover));

    stubDoneConversation("conv_raw_agent", now() + 5);
    await expect(
      s.as("cara").action(api.postCall.fetchConversation, { elevenlabsConversationId: "conv_raw_agent", processId: s.processId }),
    ).rejects.toThrow(/wasn't started from Fabric by you/);

    stubDoneConversation("conv_legacy", Math.floor(cutover / 1000) - 3600);
    expect(
      await s.as("cara").action(api.postCall.fetchConversation, { elevenlabsConversationId: "conv_legacy", processId: s.processId }),
    ).toEqual({ status: "done" });
  });

  test("not enforced (the rollout default): unissued imports still work", async () => {
    const s = await setup();
    stubDoneConversation("conv_unissued", now());
    expect(
      await s.as("cara").action(api.postCall.fetchConversation, { elevenlabsConversationId: "conv_unissued", processId: s.processId }),
    ).toEqual({ status: "done" });
  });

  test("another workspace's member can't import it even if they learn the id", async () => {
    const s = await setup();
    vi.stubEnv("INTERVIEW_SESSIONS_ENFORCED_FROM", "1");
    const conv = await issued(s, "cara");
    stubDoneConversation(conv, now());
    await expect(
      s.as("otto", OTHER_ORG).action(api.postCall.fetchConversation, { elevenlabsConversationId: conv, processId: s.otherProcessId }),
    ).rejects.toThrow(/wasn't started from Fabric by you/);
  });
});
