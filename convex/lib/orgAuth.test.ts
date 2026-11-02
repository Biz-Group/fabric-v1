/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { authErrorCode } from "./authErrors";
import { requireOrgViewer, resolveOrgViewer } from "./orgAuth";

const modules = import.meta.glob("../**/*.ts");
const ISSUER = "https://org-viewer.test";
const ORG_A = "org_viewer_a";
const ORG_B = "org_viewer_b";

function tokenFor(name: string) {
  return `${ISSUER}|${name}`;
}

async function seedMember(
  ctx: MutationCtx,
  name: string,
  orgId: string,
  options: { removed?: "removedAt" | "status"; userDeleted?: boolean } = {},
) {
  const userId = await ctx.db.insert("users", {
    tokenIdentifier: tokenFor(name),
    name,
    email: `${name}@example.test`,
    profileComplete: true,
    ...(options.userDeleted ? { deletedAt: Date.now() } : {}),
  });
  await ctx.db.insert("memberships", {
    tokenIdentifier: tokenFor(name),
    userId,
    clerkOrgId: orgId,
    role: "contributor",
    createdAt: Date.now(),
    ...(options.removed === "removedAt" ? { removedAt: Date.now() } : {}),
    ...(options.removed === "status" ? { status: "removed" as const } : {}),
  });
  return userId;
}

// `t.run` serializes ConvexError data one level deeper than a function call
// does, so unwrap it to the shape `authErrorCode` reads from the client.
async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    let data = (error as { data?: unknown }).data;
    while (typeof data === "string") data = JSON.parse(data);
    return authErrorCode({ data });
  }
  throw new Error("Expected the call to fail");
}

describe("shared viewer resolver", () => {
  test("resolves an active member to their user, membership and role", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => seedMember(ctx, "ada", ORG_A));

    const resolved = await t.run((ctx) =>
      resolveOrgViewer(ctx, { tokenIdentifier: tokenFor("ada"), orgId: ORG_A }),
    );

    expect(resolved?.user._id).toBe(userId);
    expect(resolved?.membership.clerkOrgId).toBe(ORG_A);
    expect(resolved?.role).toBe("contributor");
    expect(resolved?.orgId).toBe(ORG_A);
  });

  test("returns null for a member of a different org", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedMember(ctx, "ada", ORG_A));

    const resolved = await t.run((ctx) =>
      resolveOrgViewer(ctx, { tokenIdentifier: tokenFor("ada"), orgId: ORG_B }),
    );
    const code = await codeOf(
      t.run((ctx) =>
        requireOrgViewer(ctx, { tokenIdentifier: tokenFor("ada"), orgId: ORG_B }),
      ),
    );

    expect(resolved).toBeNull();
    expect(code).toBe("NOT_MEMBER");
  });

  test.each(["removedAt", "status"] as const)(
    "treats a membership removed by %s as removed",
    async (removed) => {
      const t = convexTest(schema, modules);
      await t.run((ctx) => seedMember(ctx, "ada", ORG_A, { removed }));
      const viewer = { tokenIdentifier: tokenFor("ada"), orgId: ORG_A };

      const resolved = await t.run((ctx) => resolveOrgViewer(ctx, viewer));
      const code = await codeOf(t.run((ctx) => requireOrgViewer(ctx, viewer)));

      expect(resolved).toBeNull();
      expect(code).toBe("REMOVED");
    },
  );

  test("treats a deleted user as removed and a missing user as not a member", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedMember(ctx, "ada", ORG_A, { userDeleted: true }));

    const deleted = await codeOf(
      t.run((ctx) =>
        requireOrgViewer(ctx, { tokenIdentifier: tokenFor("ada"), orgId: ORG_A }),
      ),
    );
    const missing = await codeOf(
      t.run((ctx) =>
        requireOrgViewer(ctx, { tokenIdentifier: tokenFor("nobody"), orgId: ORG_A }),
      ),
    );
    const missingResolved = await t.run((ctx) =>
      resolveOrgViewer(ctx, { tokenIdentifier: tokenFor("nobody"), orgId: ORG_A }),
    );

    expect(deleted).toBe("REMOVED");
    expect(missing).toBe("NOT_MEMBER");
    expect(missingResolved).toBeNull();
  });

  test("a member removed after resolving loses access on the next call", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedMember(ctx, "ada", ORG_A));
    const viewer = { tokenIdentifier: tokenFor("ada"), orgId: ORG_A };

    const before = await t.run((ctx) => requireOrgViewer(ctx, viewer));
    await t.run((ctx) =>
      ctx.db.patch("memberships", before.membership._id, { removedAt: Date.now() }),
    );
    const after = await codeOf(t.run((ctx) => requireOrgViewer(ctx, viewer)));

    expect(before.role).toBe("contributor");
    expect(after).toBe("REMOVED");
  });
});
