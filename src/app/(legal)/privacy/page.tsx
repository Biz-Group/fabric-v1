import type { Metadata } from "next";
import { LegalPage } from "@/features/legal/legal-page";
import { privacyPolicy } from "@/features/legal/legal-documents";
import { siteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Biz Group handles personal information when you use Fabric.",
  alternates: { canonical: siteUrl("/privacy") },
};

export default function PrivacyPage() {
  return <LegalPage document={privacyPolicy} />;
}
