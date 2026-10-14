import type { Metadata } from "next";
import { instrumentSans, newsreader } from "@/features/marketing/marketing-fonts";

// Keep the review drafts out of search results until counsel approves them.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${instrumentSans.variable} ${newsreader.variable}`}>
      {children}
    </div>
  );
}
