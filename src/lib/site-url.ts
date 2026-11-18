/**
 * The public site's canonical origin. `www` is primary (decision M1,
 * docs/marketing-site-upgrade-plan.md): the bare apex redirects here at the
 * hosting layer, so canonical links, Open Graph URLs, the sitemap and
 * structured data all name this host to match.
 */
export const SITE_URL = "https://www.bizfabric.ai";

/** An absolute URL on the public site, e.g. `siteUrl("/privacy")`. */
export function siteUrl(path = "/"): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}
