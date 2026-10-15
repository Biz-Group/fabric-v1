import type { Metadata } from "next";
import { LegalPage } from "@/features/legal/legal-page";
import { termsOfUse } from "@/features/legal/legal-documents";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Terms for using Fabric’s website and business knowledge platform.",
  alternates: { canonical: "https://bizfabric.ai/terms" },
};

export default function TermsPage() {
  return <LegalPage document={termsOfUse} />;
}
