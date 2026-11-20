import { FeaturePage } from "@/features/marketing/feature-page";
import { askFabricContent } from "@/features/marketing/feature-pages-content";
import { sitePageMetadata } from "@/lib/site-page-metadata";

export const metadata = sitePageMetadata({
  path: "/features/askfabric",
  title: "AskFabric",
  description:
    "Ask how your organisation really works. AskFabric (beta) answers in plain language from your workspace's evidence, with every claim linked to its source.",
});

export default function AskFabricFeature() {
  return <FeaturePage content={askFabricContent} />;
}
