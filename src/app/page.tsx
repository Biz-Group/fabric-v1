import type { Metadata, Viewport } from "next";
import { instrumentSans, newsreader } from "@/features/marketing/marketing-fonts";

import { MarketingLandingPage } from "@/features/marketing/marketing-landing-page";
import { SITE_URL, siteUrl } from "@/lib/site-url";

const description =
  "Fabric turns the conversations behind your operations into living process knowledge, clear maps, and evidence-backed opportunities to improve.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Fabric — See how your business really works",
  description,
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
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

// Organization and WebSite only. A SoftwareApplication entry would need
// public pricing or ratings to be valid for Google's rich results, and we
// publish neither (decision M6).
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Fabric",
      url: SITE_URL,
      logo: siteUrl("/pwa/fabric-icon-512.png"),
      description,
      parentOrganization: { "@type": "Organization", name: "Biz Group" },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "Fabric",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default function Home() {
  return (
    <div
      data-public-page
      className={`${instrumentSans.variable} ${newsreader.variable}`}
    >
      <script
        type="application/ld+json"
        // Static data, but escape "<" anyway as the Next.js JSON-LD guide advises.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <MarketingLandingPage />
    </div>
  );
}
