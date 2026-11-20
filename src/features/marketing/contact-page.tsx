import { CalendarDays, Mail, PlayCircle } from "lucide-react";

import { TourVideoDialog } from "@/features/marketing/marketing-landing-demos";
import landing from "@/features/marketing/marketing-landing-page.module.css";
import styles from "@/features/marketing/marketing-subpages.module.css";
import { BookDemoButton, SiteFooter, SiteHeader } from "@/features/marketing/site-chrome";
import { BIZ_GROUP_URL, CONTACT_EMAIL } from "@/features/marketing/site-links";
import { WorkspaceSignInForm } from "@/features/marketing/workspace-sign-in";

/**
 * Three ways in, from most to least committed: book a demo, email, or watch the
 * tour. No office address or phone until Saish supplies them (Phase 3 decision).
 */
export function ContactPage() {
  return (
    <main className={landing.site}>
      <SiteHeader />

      <section id="top" className={styles.contactHero}>
        <p className={styles.eyebrow}>Contact</p>
        <h1>
          Talk to us about <em>Fabric.</em>
        </h1>
        <p>
          Book a demo, send us a question, or take the two-minute tour first.
          Fabric is built by{" "}
          <a href={BIZ_GROUP_URL} target="_blank" rel="noopener noreferrer">
            Biz Group
            <span className={landing.srOnly}> (opens in a new tab)</span>
          </a>
          .
        </p>
      </section>

      <section className={styles.contactGrid} aria-label="Ways to get in touch">
        <article>
          <CalendarDays aria-hidden="true" />
          <h2>Book a demo</h2>
          <p>
            Tell us about your organization and the work you want to
            understand, and we’ll arrange a time to show you Fabric.
          </p>
          <BookDemoButton />
        </article>
        <article>
          <Mail aria-hidden="true" />
          <h2>Email us</h2>
          <p>Any question about Fabric, before or after a demo.</p>
          <p className={styles.contactEmail}>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </article>
        <article>
          <PlayCircle aria-hidden="true" />
          <h2>Not ready to talk yet?</h2>
          <p>
            See Fabric at work, from a first conversation to a recommendation,
            in two minutes.
          </p>
          <TourVideoDialog />
        </article>
      </section>

      <section className={styles.contactSignIn}>
        <div>
          <h2>Already use Fabric?</h2>
          <p>
            Sign in to your workspace. For help with your account or access,
            ask your Fabric admin.
          </p>
        </div>
        <WorkspaceSignInForm />
      </section>

      <SiteFooter />
    </main>
  );
}
