import type { Metadata, Viewport } from "next";
import { instrumentSans, newsreader } from "@/features/marketing/marketing-fonts";

// Keep the review drafts out of search results until counsel approves them.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

// The legal pages have one light design and no theme toggle, so the browser
// chrome stays cream under an OS dark preference too. globals.css pins the
// rest (`data-public-page`).
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#F7F5F0",
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-public-page
      className={`${instrumentSans.variable} ${newsreader.variable}`}
    >
      {children}
    </div>
  );
}
