import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

import landing from "@/features/marketing/marketing-landing-page.module.css";
import styles from "@/features/marketing/marketing-subpages.module.css";
import {
  BookDemoButton,
  FinalCta,
  SiteFooter,
  SiteHeader,
} from "@/features/marketing/site-chrome";
import { featurePageLinks } from "@/features/marketing/site-links";

export type FeaturePageContent = {
  /** This page's path, from `featurePageLinks`; the others become "More of Fabric". */
  path: (typeof featurePageLinks)[number]["href"];
  eyebrow: string;
  /** "Beta" for AskFabric and "Add-on" for MCP (decision M4). */
  badge?: string;
  title: ReactNode;
  lede: string;
  visual: ReactNode;
  pointsHeading: string;
  points: ReadonlyArray<{ icon: LucideIcon; title: string; description: string }>;
  stepsHeading: string;
  steps: ReadonlyArray<{ title: string; description: string }>;
  /** An optional band between the steps and the related pages. */
  extra?: ReactNode;
  closing: { heading: string; line: string };
};

/**
 * One feature of Fabric on its own page: a hero with a still of the product
 * demo, what it does, how it works, then links to the other feature pages.
 */
export function FeaturePage({ content }: { content: FeaturePageContent }) {
  const related = featurePageLinks.filter((link) => link.href !== content.path);

  return (
    <main className={landing.site}>
      <SiteHeader />

      <section id="top" className={styles.featureHero}>
        <div className={styles.featureHeroCopy}>
          <p className={styles.eyebrow}>
            {content.eyebrow}
            {content.badge && <span>{content.badge}</span>}
          </p>
          <h1>{content.title}</h1>
          <p>{content.lede}</p>
          <div className={styles.featureActions}>
            <BookDemoButton />
            <Link href="/#how-it-works" className={landing.textLink}>
              See how Fabric works <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className={styles.featureVisual}>{content.visual}</div>
      </section>

      <section className={landing.differenceSection}>
        <div className={landing.differenceIntro}>
          <h2>{content.pointsHeading}</h2>
        </div>
        <div className={landing.differenceGrid}>
          {content.points.map((point) => {
            const Icon = point.icon;
            return (
              <article key={point.title}>
                <Icon aria-hidden="true" />
                <h3>{point.title}</h3>
                <p>{point.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.stepsSection}>
        <h2>{content.stepsHeading}</h2>
        <ol className={styles.stepList}>
          {content.steps.map((step, index) => (
            <li key={step.title}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {content.extra}

      <nav className={styles.relatedSection} aria-labelledby="related-heading">
        <h2 id="related-heading">More of Fabric</h2>
        <ul>
          {related.map((link) => (
            <li key={link.href}>
              <Link href={link.href}>
                {link.label}
                <ArrowRight aria-hidden="true" />
              </Link>
            </li>
          ))}
          <li>
            <Link href="/#how-it-works">
              From a conversation to a recommendation
              <ArrowRight aria-hidden="true" />
            </Link>
          </li>
        </ul>
      </nav>

      <FinalCta heading={content.closing.heading} line={content.closing.line} />

      <SiteFooter />
    </main>
  );
}
