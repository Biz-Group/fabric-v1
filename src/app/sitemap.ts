import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

/**
 * The public site's indexable pages. Add each new marketing page here, to the
 * apex allowlist in src/proxy.ts, and to RESERVED_TENANT_SLUGS
 * (docs/marketing-site-upgrade-plan.md, D3 and D3b).
 *
 * /privacy and /terms are left out on purpose: they are drafts awaiting legal
 * approval and `noindex` until then (src/app/(legal)/layout.tsx). Add them
 * when that flag comes off.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: siteUrl("/"), changeFrequency: "monthly", priority: 1 }];
}
