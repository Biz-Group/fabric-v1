const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";

/** Absolute URL of a tenant's workspace, preserving the current protocol and
 * port (dev runs on lvh.me:3000). Client-side only. */
export function tenantWorkspaceUrl(slug: string): string {
  if (typeof window === "undefined") return "";
  const { protocol, port } = window.location;
  const rootHostname = ROOT_DOMAIN.split(":")[0];
  const host = port ? `${rootHostname}:${port}` : rootHostname;
  return `${protocol}//${slug}.${host}/`;
}

/** Display form of a tenant's hostname, e.g. "biz-group.bizfabric.ai". */
export function tenantHostname(slug: string): string {
  return `${slug}.${ROOT_DOMAIN.split(":")[0]}`;
}
