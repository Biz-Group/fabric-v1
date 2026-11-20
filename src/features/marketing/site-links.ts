/**
 * The public site's links, shared by the header, the mobile menu (a client
 * component) and the footer. Section links point at the landing page (`/#…`):
 * a same-page jump on `/`, a normal link from any other page.
 */

export const BOOK_DEMO_URL = "https://forms.cloud.microsoft/r/s4Jc3zvXjK";
export const CONTACT_EMAIL = "info@bizgroup.ae";
export const BIZ_GROUP_URL = "https://learningwithbiz.com";
export const LINKEDIN_URL = "https://ae.linkedin.com/company/biz-group-fz-llc";

export const landingSectionLinks = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Platform", href: "/#platform" },
  { label: "Use cases", href: "/#use-cases" },
] as const;

/**
 * The feature pages (src/app/(site)/features). Each one also needs its path in
 * the proxy's apex allowlist (src/proxy.ts) and the sitemap.
 */
export const featurePageLinks = [
  { label: "AskFabric", href: "/features/askfabric" },
  { label: "Recommendations", href: "/features/recommendations" },
  { label: "Claude & Copilot", href: "/features/claude-and-copilot" },
] as const;
