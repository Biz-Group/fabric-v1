import type { Metadata } from "next";
import { LegalPage } from "@/features/legal/legal-page";
import { privacyPolicy } from "@/features/legal/legal-documents";

export const metadata: Metadata = {
  title: "Privacy Policy | Fabric",
  description: "How Biz Group handles personal information when you use Fabric.",
  alternates: { canonical: "https://bizfabric.ai/privacy" },
};

export default function PrivacyPage() {
  return <LegalPage document={privacyPolicy} />;
}
