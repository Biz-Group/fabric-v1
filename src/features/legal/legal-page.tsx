import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { LegalContact, type LegalDocument } from "./legal-documents";
import styles from "./legal-page.module.css";

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <div className={styles.site} id="top">
      <a className={styles.skipLink} href="#document">Skip to document</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.wordmark} aria-label="Fabric home">
            <Image src="/pwa/fabric-icon-512.png" alt="" width={32} height={32} />
            Fabric.
          </Link>
          <Link href="/" className={styles.backLink}>
            <ArrowLeft aria-hidden="true" size={16} /> Back to Fabric
          </Link>
        </div>
      </header>

      <main className={styles.main} id="document" tabIndex={-1}>
        <div className={styles.hero}>
          <span className={styles.eyebrow}>Fabric / Legal</span>
          <h1>{document.title}</h1>
          <p className={styles.introduction}>{document.introduction}</p>
          <div className={styles.metadata}>
            <span>Prepared <time dateTime="2026-10-14">14 October 2026</time></span>
            <span>Biz Group · Dubai, UAE</span>
          </div>
        </div>

        <aside className={styles.draftNotice} aria-label="Document status">
          <strong>Draft for legal review · Not yet effective</strong>
          <p>This document is proposed wording for review by Biz Group’s legal team. It will take effect only after approval and publication with an effective date.</p>
          <details>
            <summary>Items to confirm before approval</summary>
            <ul>{document.reviewNotes.map((note) => <li key={note}>{note}</li>)}</ul>
          </details>
        </aside>

        <div className={styles.documentGrid}>
          <aside className={styles.sidebar}>
            <nav aria-label="On this page">
              <span className={styles.contentsLabel}>On this page</span>
              <ol>
                {document.sections.map((section) => (
                  <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
                ))}
              </ol>
            </nav>
            <div className={styles.questions}>
              <span>Questions about this document?</span>
              <LegalContact />
            </div>
          </aside>

          <article className={styles.article} aria-label={document.title}>
            <div className={styles.summary}>
              <span className={styles.eyebrow}>At a glance</span>
              <ul>{document.summary.map((item) => <li key={item}>{item}</li>)}</ul>
              <p>This overview is a reading aid. The full draft follows below.</p>
            </div>
            {document.sections.map((section, index) => (
              <section key={section.id} id={section.id} className={styles.section}>
                <h2><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{section.title}</h2>
                {section.content}
              </section>
            ))}
            <a href="#top" className={styles.topLink}>Back to top ↑</a>
          </article>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <Link href="/" className={styles.wordmark}>Fabric.</Link>
            <p>Built by Biz Group. Dubai, United Arab Emirates.</p>
          </div>
          <nav aria-label="Legal">
            <Link href="/privacy" aria-current={document.path === "/privacy" ? "page" : undefined}>Privacy Policy</Link>
            <Link href="/terms" aria-current={document.path === "/terms" ? "page" : undefined}>Terms of Use</Link>
            <a href="mailto:info@bizgroup.ae">Contact <ArrowUpRight aria-hidden="true" size={14} /></a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
