import { ContactPage } from "@/features/marketing/contact-page";
import { sitePageMetadata } from "@/lib/site-page-metadata";

export const metadata = sitePageMetadata({
  path: "/contact",
  title: "Contact",
  description:
    "Book a demo of Fabric, email the team, or watch the two-minute tour.",
});

export default function Contact() {
  return <ContactPage />;
}
