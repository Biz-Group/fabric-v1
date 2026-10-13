import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { assertClerkId, clerkFetch, isClerkId } from "./clerkApi";

describe("clerkFetch path guard", () => {
  const fetchMock = vi.fn(
    async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );

  beforeEach(() => {
    process.env.CLERK_SECRET_KEY = "sk_test_abc";
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  test.each([
    "/organizations/org_a/invitations/../../../users/user_x/ban",
    "/organizations/org_a/invitations/x/revoke?x=",
    "/organizations/org_a/invitations/%2e%2e/revoke",
    "/organizations/org_a/invitations/x#frag",
    "/organizations//memberships",
    "organizations/org_a",
    "",
  ])("refuses %j without sending a request", async (path) => {
    await expect(clerkFetch(path)).rejects.toThrow(/unsafe path/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("allows ordinary Clerk paths", async () => {
    await clerkFetch("/organizations/org_a/invitations/orginv_1/revoke", {
      method: "POST",
      body: {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Clerk id validation", () => {
  test("accepts well-formed ids for the expected prefix", () => {
    expect(isClerkId("orginv_2abcXYZ", "orginv")).toBe(true);
    expect(isClerkId("org_2abc", "org")).toBe(true);
    expect(isClerkId("user_2abc", "user")).toBe(true);
  });

  test("rejects other prefixes and path syntax", () => {
    expect(isClerkId("org_2abc", "orginv")).toBe(false);
    expect(isClerkId("orginv_1/../x", "orginv")).toBe(false);
    expect(isClerkId("orginv_", "orginv")).toBe(false);
    expect(() => assertClerkId("../org_b", "org")).toThrow(/Invalid Clerk org id/);
  });
});
