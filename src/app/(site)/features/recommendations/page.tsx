import { FeaturePage } from "@/features/marketing/feature-page";
import { recommendationsContent } from "@/features/marketing/feature-pages-content";
import { sitePageMetadata } from "@/lib/site-page-metadata";

export const metadata = sitePageMetadata({
  path: "/features/recommendations",
  title: "Recommendations",
  description:
    "Up to five changes for every process, technical or not, ranked by value and effort and tied to what your people described.",
});

export default function RecommendationsFeature() {
  return <FeaturePage content={recommendationsContent} />;
}
