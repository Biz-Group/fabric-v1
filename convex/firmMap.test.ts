/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ORG = "org_firm";
const OTHER_ORG = "org_firm_other";
const ISSUER = "https://test.clerk";

function harness() {
  return convexTest(schema, modules);
}
type Harness = ReturnType<typeof harness>;

function identity(role: "admin" | "viewer", orgId = ORG) {
  return {
    tokenIdentifier: `${ISSUER}|${role}|${orgId}`,
    subject: `${role}-${orgId}`,
    issuer: ISSUER,
    name: role,
    email: `${role}@test.dev`,
    orgId,
    orgSlug: orgId,
  };
}

type Seed = {
  adminMembershipId: Id<"memberships">;
  functionId: Id<"functions">;
  supportId: Id<"departments">;
  financeId: Id<"departments">;
  ticketsId: Id<"processes">;
  billingId: Id<"processes">;
};

async function seedMember(
  ctx: MutationCtx,
  role: "admin" | "viewer",
  orgId: string,
): Promise<Id<"memberships">> {
  const { tokenIdentifier, name, email } = identity(role, orgId);
  const userId = await ctx.db.insert("users", {
    tokenIdentifier,
    name,
    email,
    profileComplete: true,
  });
  return await ctx.db.insert("memberships", {
    tokenIdentifier,
    userId,
    clerkOrgId: orgId,
    role,
    name: role === "admin" ? "Ada Admin" : "Vic Viewer",
    createdAt: Date.now(),
  });
}

async function seedOrg(ctx: MutationCtx, orgId = ORG): Promise<Seed> {
  const adminMembershipId = await seedMember(ctx, "admin", orgId);
  await seedMember(ctx, "viewer", orgId);
  const functionId = await ctx.db.insert("functions", {
    name: "Operations",
    sortOrder: 0,
    clerkOrgId: orgId,
  });
  const supportId = await ctx.db.insert("departments", {
    functionId,
    name: "Support",
    sortOrder: 0,
    clerkOrgId: orgId,
  });
  const financeId = await ctx.db.insert("departments", {
    functionId,
    name: "Finance",
    sortOrder: 1,
    clerkOrgId: orgId,
  });
  const ticketsId = await ctx.db.insert("processes", {
    departmentId: supportId,
    name: "Ticketing",
    sortOrder: 0,
    clerkOrgId: orgId,
  });
  const billingId = await ctx.db.insert("processes", {
    departmentId: financeId,
    name: "Billing",
    sortOrder: 0,
    clerkOrgId: orgId,
  });
  return {
    adminMembershipId,
    functionId,
    supportId,
    financeId,
    ticketsId,
    billingId,
  };
}

type LinkArg = FunctionArgs<
  typeof internal.firmMap.saveProcessLinks
>["links"][number];

function link(
  overrides: Pick<LinkArg, "counterparty" | "counterpartyKey"> &
    Partial<LinkArg>,
): LinkArg {
  return {
    direction: "outbound",
    kind: "handoff",
    label: "Escalated invoice query",
    nodeIds: ["n1"],
    evidence: ["We send billing questions to Finance"],
    contributors: ["Aisha"],
    confidence: "medium",
    ...overrides,
  };
}

/** Enqueues without running the scheduled resolver, returning its token. */
async function enqueue(
  t: Harness,
  processId: Id<"processes">,
  orgId = ORG,
): Promise<string> {
  return await t.run(async (ctx) => {
    const { enqueueFirmResolution } = await import("./firmMap");
    return await enqueueFirmResolution(ctx, { clerkOrgId: orgId, processId });
  });
}

async function save(
  t: Harness,
  seed: Seed,
  resolutionId: string,
  links: LinkArg[],
  orgId = ORG,
) {
  return await t.mutation(internal.firmMap.saveProcessLinks, {
    clerkOrgId: orgId,
    processId: seed.ticketsId,
    resolutionId,
    flowGenerationId: "gen-1",
    roles: [{ name: "Support agent", stepCount: 3 }],
    links,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("saveProcessLinks", () => {
  test("writes links and a ready profile for the current resolution", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    const resolutionId = await enqueue(t, seed.ticketsId);

    expect(
      await save(t, seed, resolutionId, [
        link({
          counterparty: { kind: "process", processId: seed.billingId },
          counterpartyKey: `process:${seed.billingId}`,
        }),
      ]),
    ).toBe(true);

    const map = await t
      .withIdentity(identity("viewer"))
      .query(api.firmMap.getFirmMap, {});
    expect(map.links).toHaveLength(1);
    expect(map.links[0]).toMatchObject({
      sourceProcessId: seed.ticketsId,
      review: "proposed",
      origin: "ai",
    });
    const tickets = map.processes.find((p) => p._id === seed.ticketsId);
    expect(tickets).toMatchObject({
      mapped: true,
      roles: [{ name: "Support agent", stepCount: 3 }],
    });
    expect(map.resolution.ready).toBe(1);
    expect(map.canManage).toBe(false);
  });

  test("drops a superseded resolution's save", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    const stale = await enqueue(t, seed.ticketsId);
    await enqueue(t, seed.ticketsId);

    expect(
      await save(t, seed, stale, [
        link({
          counterparty: { kind: "process", processId: seed.billingId },
          counterpartyKey: `process:${seed.billingId}`,
        }),
      ]),
    ).toBe(false);
    const rows = await t.run((ctx) => ctx.db.query("firmLinks").collect());
    expect(rows).toHaveLength(0);
  });

  test("replaces proposed links but never reviewed or admin ones", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    const first = await enqueue(t, seed.ticketsId);
    await save(t, seed, first, [
      link({
        counterparty: { kind: "process", processId: seed.billingId },
        counterpartyKey: `process:${seed.billingId}`,
      }),
      link({
        counterparty: { kind: "external", name: "Customer" },
        counterpartyKey: "external:customer",
        direction: "inbound",
      }),
      link({
        counterparty: { kind: "department", departmentId: seed.financeId },
        counterpartyKey: `department:${seed.financeId}`,
      }),
    ]);

    // An admin rejects the department link and confirms the customer one.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("firmLinks").collect()) {
        if (row.counterpartyKey === `department:${seed.financeId}`) {
          await ctx.db.patch(row._id, { review: "rejected" });
        }
        if (row.counterpartyKey === "external:customer") {
          await ctx.db.patch(row._id, { review: "confirmed" });
        }
      }
    });

    // The next resolution proposes all three again plus a new one.
    const second = await enqueue(t, seed.ticketsId);
    await save(t, seed, second, [
      link({
        counterparty: { kind: "process", processId: seed.billingId },
        counterpartyKey: `process:${seed.billingId}`,
        label: "Credit note request",
      }),
      link({
        counterparty: { kind: "external", name: "Customer" },
        counterpartyKey: "external:customer",
        direction: "inbound",
      }),
      link({
        counterparty: { kind: "department", departmentId: seed.financeId },
        counterpartyKey: `department:${seed.financeId}`,
      }),
      link({
        counterparty: { kind: "external", name: "Axonify Canada" },
        counterpartyKey: "external:axonify canada",
      }),
    ]);

    const rows = await t.run((ctx) => ctx.db.query("firmLinks").collect());
    const byKey = (key: string) => rows.filter((r) => r.counterpartyKey === key);
    expect(byKey(`process:${seed.billingId}`)).toMatchObject([
      { label: "Credit note request", review: "proposed" },
    ]);
    expect(byKey("external:customer")).toMatchObject([{ review: "confirmed" }]);
    expect(byKey(`department:${seed.financeId}`)).toMatchObject([
      { review: "rejected" },
    ]);
    expect(byKey("external:axonify canada")).toHaveLength(1);

    const map = await t
      .withIdentity(identity("viewer"))
      .query(api.firmMap.getFirmMap, {});
    // The rejected link stays stored but never reaches the map.
    expect(map.links.map((l) => l.counterpartyKey).sort()).toEqual(
      ["external:axonify canada", "external:customer", `process:${seed.billingId}`].sort(),
    );
    const profile = await t.run((ctx) =>
      ctx.db.query("firmProcessProfiles").first(),
    );
    expect(profile?.linkCount).toBe(3);
  });
});

describe("getFirmMap", () => {
  test("is tenant-isolated", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    const other = await t.run((ctx) => seedOrg(ctx, OTHER_ORG));
    const resolutionId = await enqueue(t, other.ticketsId, OTHER_ORG);
    await t.mutation(internal.firmMap.saveProcessLinks, {
      clerkOrgId: OTHER_ORG,
      processId: other.ticketsId,
      resolutionId,
      flowGenerationId: "gen-1",
      roles: [],
      links: [
        link({
          counterparty: { kind: "process", processId: other.billingId },
          counterpartyKey: `process:${other.billingId}`,
        }),
      ],
    });

    const map = await t
      .withIdentity(identity("viewer"))
      .query(api.firmMap.getFirmMap, {});
    expect(map.links).toEqual([]);
    expect(map.processes.map((p) => p._id).sort()).toEqual(
      [seed.ticketsId, seed.billingId].sort(),
    );
  });

  test("hides links whose endpoint is already gone", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    const resolutionId = await enqueue(t, seed.ticketsId);
    await save(t, seed, resolutionId, [
      link({
        counterparty: { kind: "process", processId: seed.billingId },
        counterpartyKey: `process:${seed.billingId}`,
      }),
    ]);
    // Deleted directly, so the cascade has not run yet.
    await t.run((ctx) => ctx.db.delete(seed.billingId));

    const map = await t
      .withIdentity(identity("viewer"))
      .query(api.firmMap.getFirmMap, {});
    expect(map.links).toEqual([]);
  });
});

describe("deleteForEntity", () => {
  test("removes a deleted process's own links, inbound links, and profile", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    const resolutionId = await enqueue(t, seed.ticketsId);
    await save(t, seed, resolutionId, [
      link({
        counterparty: { kind: "process", processId: seed.billingId },
        counterpartyKey: `process:${seed.billingId}`,
      }),
      link({
        counterparty: { kind: "external", name: "Customer" },
        counterpartyKey: "external:customer",
      }),
    ]);

    // Billing is pointed at; deleting it removes only the link to it.
    await t.mutation(internal.firmMap.deleteForEntity, {
      clerkOrgId: ORG,
      entity: { kind: "process", processId: seed.billingId },
    });
    let rows = await t.run((ctx) => ctx.db.query("firmLinks").collect());
    expect(rows.map((r) => r.counterpartyKey)).toEqual(["external:customer"]);

    // Ticketing is the source; deleting it removes the rest and its profile.
    await t.mutation(internal.firmMap.deleteForEntity, {
      clerkOrgId: ORG,
      entity: { kind: "process", processId: seed.ticketsId },
    });
    rows = await t.run((ctx) => ctx.db.query("firmLinks").collect());
    expect(rows).toEqual([]);
    const profiles = await t.run((ctx) =>
      ctx.db.query("firmProcessProfiles").collect(),
    );
    expect(profiles).toEqual([]);
  });

  test("department delete cascades from the public mutation", async () => {
    const t = harness();
    const seed = await t.run(async (ctx) => {
      const s = await seedOrg(ctx);
      // An empty department others hand work to.
      const legalId = await ctx.db.insert("departments", {
        functionId: s.functionId,
        name: "Legal",
        sortOrder: 2,
        clerkOrgId: ORG,
      });
      return { ...s, legalId };
    });
    const resolutionId = await enqueue(t, seed.ticketsId);
    await save(t, seed, resolutionId, [
      link({
        counterparty: { kind: "department", departmentId: seed.legalId },
        counterpartyKey: `department:${seed.legalId}`,
      }),
    ]);

    vi.useFakeTimers();
    await t
      .withIdentity(identity("admin"))
      .mutation(api.departments.remove, { departmentId: seed.legalId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await t.run((ctx) => ctx.db.query("firmLinks").collect());
    expect(rows).toEqual([]);
  });
});

describe("process owners", () => {
  test("admins set an owner that the map shows", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    await t
      .withIdentity(identity("admin"))
      .mutation(api.firmMap.setProcessOwner, {
        processId: seed.ticketsId,
        ownerMembershipId: seed.adminMembershipId,
      });

    const map = await t
      .withIdentity(identity("viewer"))
      .query(api.firmMap.getFirmMap, {});
    expect(map.processes.find((p) => p._id === seed.ticketsId)?.owner).toEqual({
      membershipId: seed.adminMembershipId,
      name: "Ada Admin",
      jobTitle: null,
    });
  });

  test("a removed owner reads as unowned", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    await t
      .withIdentity(identity("admin"))
      .mutation(api.firmMap.setProcessOwner, {
        processId: seed.ticketsId,
        ownerMembershipId: seed.adminMembershipId,
      });
    await t.run((ctx) =>
      ctx.db.patch(seed.adminMembershipId, { status: "removed" }),
    );
    const map = await t
      .withIdentity(identity("viewer"))
      .query(api.firmMap.getFirmMap, {});
    expect(map.processes.find((p) => p._id === seed.ticketsId)?.owner).toBeNull();
  });

  test("non-admins cannot set owners", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    await expect(
      t.withIdentity(identity("viewer")).mutation(api.firmMap.setProcessOwner, {
        processId: seed.ticketsId,
        ownerMembershipId: null,
      }),
    ).rejects.toThrow("Insufficient permissions");
  });

  test("an owner from another org is rejected", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    const other = await t.run((ctx) => seedOrg(ctx, OTHER_ORG));
    await expect(
      t.withIdentity(identity("admin")).mutation(api.firmMap.setProcessOwner, {
        processId: seed.ticketsId,
        ownerMembershipId: other.adminMembershipId,
      }),
    ).rejects.toThrow("Not found");
  });
});

describe("resolveProcessLinksInternal", () => {
  test("a flow with nothing crossing its boundary saves roles without an AI call", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    await t.run(async (ctx) => {
      const detail = {
        description: "",
        tools: [],
        painPoints: [],
        automationPotential: "none" as const,
        confidence: "high" as const,
        isBottleneck: false,
        isTribalKnowledge: false,
        riskIndicators: [],
        sources: ["Aisha"],
      };
      await ctx.db.insert("processFlows", {
        processId: seed.ticketsId,
        clerkOrgId: ORG,
        status: "ready",
        stale: false,
        generatedAt: 1,
        conversationCount: 1,
        nodes: [
          {
            id: "n1",
            label: "Log ticket",
            category: "start",
            ...detail,
            actors: ["Support agent"],
          },
          {
            id: "n2",
            label: "Fix it",
            category: "end",
            ...detail,
            actors: ["Support agent", "Engineer"],
          },
        ],
        edges: [],
        insights: {
          criticalPath: [],
          handoffCount: 0,
          toolCount: 0,
          automationOpportunities: [],
          topBottlenecks: [],
        },
      });
    });

    vi.useFakeTimers();
    await enqueue(t, seed.ticketsId);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const profile = await t.run((ctx) =>
      ctx.db.query("firmProcessProfiles").first(),
    );
    expect(profile).toMatchObject({
      status: "ready",
      flowGenerationId: "legacy:1",
      linkCount: 0,
      roles: [
        { name: "Support agent", stepCount: 2 },
        { name: "Engineer", stepCount: 1 },
      ],
    });
  });

  test("a process with no flow clears its profile", async () => {
    const t = harness();
    const seed = await t.run((ctx) => seedOrg(ctx));
    vi.useFakeTimers();
    await enqueue(t, seed.ticketsId);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const profiles = await t.run((ctx) =>
      ctx.db.query("firmProcessProfiles").collect(),
    );
    expect(profiles).toEqual([]);
  });
});

describe("requestFirmMapBuild", () => {
  test("is admin-only", async () => {
    const t = harness();
    await t.run((ctx) => seedOrg(ctx));
    await expect(
      t.withIdentity(identity("viewer")).mutation(api.firmMap.requestFirmMapBuild, {}),
    ).rejects.toThrow("Insufficient permissions");
  });
});
