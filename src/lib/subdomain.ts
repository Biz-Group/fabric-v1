import {
  isValidTenantSlug,
  TENANTS_CONSOLE_SUBDOMAIN,
} from "../../convex/lib/slugs";

export { TENANTS_CONSOLE_SUBDOMAIN };

function getHostname(host: string | null | undefined): string | null {
  if (!host) return null;

  const value = host.trim().toLowerCase();
  if (!value || /[\s,/]/.test(value)) return null;

  const colonIndex = value.indexOf(":");
  if (colonIndex === -1) return value.replace(/\.$/, "");

  const hostname = value.slice(0, colonIndex);
  const port = value.slice(colonIndex + 1);
  if (!hostname || !/^\d+$/.test(port)) return null;

  return hostname.replace(/\.$/, "");
}

export function isValidTenantSubdomain(subdomain: string): boolean {
  return isValidTenantSlug(subdomain);
}

/** True when the request host is the platform tenant-management console
 * (`tenants.<root>`). Reserved subdomains resolve to null in
 * `getTenantSubdomain`, so the console needs its own host check. */
export function isTenantsConsoleHost(
  host: string | null | undefined,
  rootDomain: string | null | undefined,
): boolean {
  const hostname = getHostname(host);
  const rootHostname = getHostname(rootDomain);
  if (!hostname || !rootHostname) return false;
  return hostname === `${TENANTS_CONSOLE_SUBDOMAIN}.${rootHostname}`;
}

export function getTenantSubdomain(
  host: string | null | undefined,
  rootDomain: string | null | undefined,
): string | null {
  const hostname = getHostname(host);
  const rootHostname = getHostname(rootDomain);

  if (!hostname || !rootHostname) return null;
  if (hostname === rootHostname || hostname === `www.${rootHostname}`) {
    return null;
  }
  if (!hostname.endsWith(`.${rootHostname}`)) return null;

  const subdomain = hostname.slice(0, -rootHostname.length - 1);
  if (!isValidTenantSubdomain(subdomain)) return null;

  return subdomain;
}
