import type { Viewport } from "next";
import { instrumentSans, newsreader } from "@/features/marketing/marketing-fonts";

/**
 * The public site's subpages: /contact and /features/*. A route group, so it
 * adds nothing to the URL. Each page also needs its path in the proxy's apex
 * allowlist (src/proxy.ts), the sitemap, and a reserved tenant slug for its
 * first segment (convex/lib/slugs.ts).
 */

// Same single light design as the landing and legal pages (`data-public-page`).
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#F7F5F0",
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-public-page
      className={`${instrumentSans.variable} ${newsreader.variable}`}
    >
      {children}
    </div>
  );
}
