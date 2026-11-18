import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { siteUrl } from "@/lib/site-url";
import { isPublicSiteHost } from "@/lib/subdomain";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";

/**
 * One robots.txt for every host (the proxy passes `/robots.txt` through
 * unrewritten). Only the public site (the root domain and `www.`) is
 * crawlable and lists its sitemap. Workspace subdomains, the tenants console
 * and preview hosts disallow everything, so their public sign-in pages stay
 * out of search results. With no root domain configured (single-host dev) the
 * one host is treated as the public site.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host");
  const isPublicSite = !ROOT_DOMAIN || isPublicSiteHost(host, ROOT_DOMAIN);

  if (!isPublicSite) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: siteUrl("/sitemap.xml"),
  };
}
