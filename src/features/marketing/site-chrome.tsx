import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { MobileNavigation } from "@/features/marketing/marketing-landing-demos";
import styles from "@/features/marketing/marketing-landing-page.module.css";
import {
  BIZ_GROUP_URL,
  BOOK_DEMO_URL,
  CONTACT_EMAIL,
  LINKEDIN_URL,
  featurePageLinks,
  landingSectionLinks,
} from "@/features/marketing/site-links";
import { SignInMenu } from "@/features/marketing/workspace-sign-in";

/**
 * The public site's shared header, footer, closing band and demo button, used
 * by the landing page and every marketing subpage.
 */

const productLinks = [
  ...landingSectionLinks,
  ...featurePageLinks,
  { label: "FAQ", href: "/#faq" },
];

/** Web links open in a new tab; the mailto opens the visitor's mail app. */
const companyLinks: ReadonlyArray<{ label: string; href: string; external?: boolean }> = [
  { label: "Contact", href: "/contact" },
  { label: "Biz Group", href: BIZ_GROUP_URL, external: true },
  { label: "LinkedIn", href: LINKEDIN_URL, external: true },
  { label: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
];

export function BookDemoButton({ inverted = false }: { inverted?: boolean }) {
  return (
    <a
      href={BOOK_DEMO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={inverted ? styles.demoButtonInverted : styles.demoButton}
      data-book-demo
    >
      Book a demo
      <span className={styles.srOnly}> (opens in a new tab)</span>
      <ArrowRight aria-hidden="true" />
    </a>
  );
}

/**
 * @param homeHref Where the wordmark goes: `#top` on the landing page (a jump,
 *   not a reload), `/` everywhere else.
 */
export function SiteHeader({ homeHref = "/" }: { homeHref?: string }) {
  return (
    <header className={styles.navigation}>
      <div className={styles.navigationInner}>
        <Link href={homeHref} className={styles.wordmark} aria-label="Fabric home">
          {/* Decorative: the anchor's aria-label already names the link. */}
          <Image
            src="/pwa/fabric-icon-512.png"
            alt=""
            width={64}
            height={64}
            priority
            className={styles.wordmarkBadge}
          />
          Fabric.
        </Link>

        <nav className={styles.desktopNavigation} aria-label="Main navigation">
          {landingSectionLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className={styles.navigationActions}>
          <SignInMenu />
          <BookDemoButton />
          <MobileNavigation />
        </div>
      </div>
    </header>
  );
}

/** The dark closing band above the footer. */
export function FinalCta({ heading, line }: { heading: string; line: string }) {
  return (
    <section className={styles.finalCta}>
      <div className={styles.finalCtaRings} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className={styles.finalCtaContent}>
        <h2>{heading}</h2>
        <p>{line}</p>
        <BookDemoButton inverted />
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerBrand}>
        <a href="#top" className={styles.wordmark} aria-label="Back to top">
          Fabric.
        </a>
        <p>
          The fabric of the organisation, woven from the voices of the people
          who make it run.
        </p>
      </div>

      <nav className={styles.footerNav} aria-label="Footer">
        <div>
          <h2>Product</h2>
          <ul>
            {productLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Company</h2>
          <ul>
            <li>
              <a href={BOOK_DEMO_URL} target="_blank" rel="noopener noreferrer">
                Book a demo
                <span className={styles.srOnly}> (opens in a new tab)</span>
              </a>
            </li>
            {companyLinks.map((link) => (
              <li key={link.href}>
                {link.external ? (
                  <a href={link.href} target="_blank" rel="noopener noreferrer">
                    {link.label}
                    <span className={styles.srOnly}> (opens in a new tab)</span>
                  </a>
                ) : link.href.startsWith("/") ? (
                  <Link href={link.href}>{link.label}</Link>
                ) : (
                  <a href={link.href}>{link.label}</a>
                )}
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className={styles.footerBase}>
        <span>&copy; {new Date().getFullYear()} Fabric. Built by Biz Group.</span>
        <nav className={styles.legalLinks} aria-label="Legal">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Use</Link>
        </nav>
      </div>
    </footer>
  );
}
