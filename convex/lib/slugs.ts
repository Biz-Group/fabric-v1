// Single source of truth for tenant slug rules, shared by the middleware
// host parsing (src/lib/subdomain.ts) and the tenant provisioning action
// (convex/tenants.ts). A slug becomes a subdomain of the root domain, so the
// pattern mirrors DNS label rules.

// Subdomain of the platform tenant-management console (Biz Group staff only).
export const TENANTS_CONSOLE_SUBDOMAIN = "tenants";

export const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Never allow these as tenant slugs — they are (or may become) platform
// surfaces or infrastructure hostnames.
export const RESERVED_TENANT_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "app",
  TENANTS_CONSOLE_SUBDOMAIN,
  "accounts",
  "clerk",
  "api",
  "mail",
  "admin",
  "status",
  // Paths under /mcp/ that OAuth clients guess (convex/mcp/routes.ts), and
  // the MCP host itself: never workspace slugs.
  "mcp",
  "register",
  "authorize",
  "token",
  "oauth",
  "callback",
]);

export function isValidTenantSlug(slug: string): boolean {
  return TENANT_SLUG_PATTERN.test(slug) && !RESERVED_TENANT_SLUGS.has(slug);
}
