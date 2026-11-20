import { FeaturePage } from "@/features/marketing/feature-page";
import { assistantsContent } from "@/features/marketing/feature-pages-content";
import { sitePageMetadata } from "@/lib/site-page-metadata";

export const metadata = sitePageMetadata({
  path: "/features/claude-and-copilot",
  title: "Fabric in Claude and Copilot",
  description:
    "An add-on that lets Claude and Microsoft Copilot Studio answer how your organisation works from Fabric: read-only, and limited to what each person can see.",
});

export default function AssistantsFeature() {
  return <FeaturePage content={assistantsContent} />;
}
