import type { Metadata, Viewport } from "next";
import { instrumentSans, newsreader } from "@/features/marketing/marketing-fonts";

// The public site's 404. The proxy rewrites unknown paths on the apex and www
// hosts here (src/proxy.ts), and the page throws `notFound()`, so the response
// is a real 404 that Next.js also marks `noindex`.
export const metadata: Metadata = {
  title: "Page not found",
};

// Same single light design as the landing and legal pages (`data-public-page`).
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#F7F5F0",
};

export default function SiteNotFoundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      data-public-page
      className={`${instrumentSans.variable} ${newsreader.variable}`}
    >
      {children}
    </div>
  );
}
