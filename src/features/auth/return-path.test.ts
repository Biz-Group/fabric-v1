import { describe, expect, test } from "vitest";
import { signInUrlFor, toSafeReturnPath } from "./return-path";

const HOST = "acme.bizfabric.ai";

describe("toSafeReturnPath", () => {
  test.each([
    ["https://acme.bizfabric.ai/?process=p1&tab=map#step-3", "/?process=p1&tab=map#step-3"],
    ["https://acme.bizfabric.ai/admin/users", "/admin/users"],
    ["/admin/users?page=2", "/admin/users?page=2"],
    ["https://ACME.bizfabric.ai/release-notes", "/release-notes"],
    // The scheme doesn't matter, only that the host is this workspace.
    ["http://acme.bizfabric.ai/admin", "/admin"],
    ["https://acme.bizfabric.ai/", "/"],
  ])("keeps %s as %s", (raw, expected) => {
    expect(toSafeReturnPath(raw, HOST)).toBe(expected);
  });

  test.each([
    [null],
    [""],
    ["https://evil.example/admin"],
    ["https://beta.bizfabric.ai/admin"],
    ["https://bizfabric.ai/"],
    ["https://acme.bizfabric.ai.evil.example/"],
    ["//evil.example/admin"],
    ["/\\evil.example/admin"],
    ["https://acme.bizfabric.ai//evil.example"],
    ["javascript:alert(1)"],
    ["data:text/html,hi"],
    ["https://acme.bizfabric.ai/sign-in?redirect_url=/admin"],
    ["/sign-up/verify-email-address"],
    ["/join-organization"],
    ["/api/join-subdomain-organization"],
  ])("rejects %s", (raw) => {
    expect(toSafeReturnPath(raw, HOST)).toBeNull();
  });

  test("keeps paths that only start like an auth path", () => {
    expect(toSafeReturnPath("/sign-in-help", HOST)).toBe("/sign-in-help");
  });

  test("compares the port as part of the host in local dev", () => {
    expect(
      toSafeReturnPath("http://acme.lvh.me:3000/admin", "acme.lvh.me:3000"),
    ).toBe("/admin");
    expect(
      toSafeReturnPath("http://acme.lvh.me:4000/admin", "acme.lvh.me:3000"),
    ).toBeNull();
  });
});

describe("signInUrlFor", () => {
  test("omits redirect_url for the home page", () => {
    expect(signInUrlFor("/")).toBe("/sign-in");
  });

  test("round-trips a deep link through redirect_url", () => {
    const url = signInUrlFor("/?process=p1&tab=map");
    const raw = new URL(url, `https://${HOST}`).searchParams.get("redirect_url");
    expect(toSafeReturnPath(raw, HOST)).toBe("/?process=p1&tab=map");
  });
});
