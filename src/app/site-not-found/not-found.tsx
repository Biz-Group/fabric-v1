import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import legal from "@/features/legal/legal-page.module.css";
import styles from "./site-not-found.module.css";

export default function SiteNotFound() {
  return (
    <div className={legal.site}>
      <header className={legal.header}>
        <div className={legal.headerInner}>
          <Link href="/" className={legal.wordmark} aria-label="Fabric home">
            <Image src="/pwa/fabric-icon-512.png" alt="" width={32} height={32} />
            Fabric.
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <span className={legal.eyebrow}>404</span>
        <h1>This page isn’t here.</h1>
        <p>The link may be out of date, or the address may have a typo.</p>
        <p>
          Looking for your workspace? Use <strong>Sign in</strong> on the home
          page and enter your workspace name. It’s the first part of the address
          in your invitation email.
        </p>
        <Link href="/" className={styles.homeLink}>
          Go to the home page
          <ArrowRight aria-hidden="true" />
        </Link>
      </main>
    </div>
  );
}
