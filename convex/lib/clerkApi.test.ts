import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  assertClerkId,
  ClerkApiError,
  clerkFetch,
  isClerkApiErrorCode,
  isClerkId,
} from "./clerkApi";

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

describe("clerkFetch failures", () => {
  beforeEach(() => {
    process.env.CLERK_SECRET_KEY = "sk_test_abc";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respondWith(status: number, body: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status })),
    );
  }

  async function failure(): Promise<ClerkApiError> {
    try {
      await clerkFetch("/organizations/org_a/invitations", { method: "POST" });
    } catch (error) {
      if (error instanceof ClerkApiError) return error;
      throw error;
    }
    throw new Error("Expected clerkFetch to fail");
  }

  test("keeps the status, codes and trace id but not the body", async () => {
    respondWith(
      422,
      JSON.stringify({
        errors: [
          {
            code: "duplicate_record",
            message: "duplicate",
            long_message: "jane.doe@client.test is already invited",
            meta: { email_address: "jane.doe@client.test" },
          },
        ],
        clerk_trace_id: "trace_123",
      }),
    );

    const error = await failure();

    expect(error.status).toBe(422);
    expect(error.codes).toEqual(["duplicate_record"]);
    expect(isClerkApiErrorCode(error, "duplicate_record")).toBe(true);
    expect(error.message).toBe(
      "Clerk API POST /organizations/org_a/invitations failed with 422 (duplicate_record) [trace trace_123]",
    );
    expect(error.message).not.toContain("jane.doe");
  });

  test("survives a body that isn't JSON", async () => {
    respondWith(502, "<html>upstream error for jane.doe@client.test</html>");

    const error = await failure();

    expect(error.status).toBe(502);
    expect(error.codes).toEqual([]);
    expect(error.message).not.toContain("jane.doe");
  });

  test("only a Clerk API failure counts as having a code", () => {
    expect(
      isClerkApiErrorCode(new Error("duplicate_record"), "duplicate_record"),
    ).toBe(false);
  });
});
