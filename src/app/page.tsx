import type { Metadata, Viewport } from "next";
import { instrumentSans, newsreader } from "@/features/marketing/marketing-fonts";

import { MarketingLandingPage } from "@/features/marketing/marketing-landing-page";

export const metadata: Metadata = {
  metadataBase: new URL("https://bizfabric.ai"),
  title: "Fabric — See how your business really works",
  description:
    "Fabric turns the conversations behind your operations into living process knowledge, clear maps, and evidence-backed opportunities to improve.",
  alternates: {
    canonical: "https://bizfabric.ai",
  },
  openGraph: {
    type: "website",
    url: "https://bizfabric.ai",
    siteName: "Fabric",
    title: "Fabric — See how your business really works",
    description:
      "Turn the way work really happens into a living map of your business.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fabric — See how your business really works",
    description:
      "Turn the way work really happens into a living map of your business.",
  },
};

// The landing has one light design and no theme toggle, so the browser chrome
// stays cream under an OS dark preference too. globals.css pins the rest
// (`data-public-page`).
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#F7F5F0",
};

export default function Home() {
  return (
    <div
      data-public-page
      className={`${instrumentSans.variable} ${newsreader.variable}`}
    >
      <MarketingLandingPage />
    </div>
  );
}
