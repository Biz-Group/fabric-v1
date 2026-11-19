import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  Lightbulb,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

import {
  HeroConversationDemo,
  MobileNavigation,
  ProductJourneyDemo,
  TourVideoDialog,
} from "@/features/marketing/marketing-landing-demos";
import styles from "@/features/marketing/marketing-landing-page.module.css";
import { SignInMenu } from "@/features/marketing/workspace-sign-in";

const BOOK_DEMO_URL = "https://forms.cloud.microsoft/r/s4Jc3zvXjK";

const productLinks = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Platform", href: "#platform" },
  { label: "Use cases", href: "#use-cases" },
  { label: "FAQ", href: "#faq" },
];

/**
 * External company links (Biz Group's site, LinkedIn, a contact address).
 * Empty until confirmed addresses are supplied; the Company column then shows
 * them under "Book a demo". Add Security, What's new and Contact pages here
 * when Phase 3 builds them (docs/marketing-site-upgrade-plan.md).
 */
const companyLinks: ReadonlyArray<{ label: string; href: string }> = [];

const useCases = [
  {
    number: "01",
    title: "Operations and process excellence",
    description:
      "Build an honest view of the current state—complete with the exceptions, workarounds, and handoffs traditional process maps miss.",
    outcome: "From scattered knowledge to an operating picture everyone can use.",
  },
  {
    number: "02",
    title: "Digital and AI transformation",
    description:
      "Understand the work before choosing the technology. Ground transformation roadmaps in real operational evidence instead of assumptions.",
    outcome: "From an automation wish list to evidence-backed priorities.",
  },
  {
    number: "03",
    title: "Leadership and business resilience",
    description:
      "Expose where critical knowledge lives with one person, where teams disagree, and where the business is carrying invisible operational risk.",
    outcome: "From intuition to a clearer view of organizational risk.",
  },
  {
    number: "04",
    title: "People, learning, and enablement",
    description:
      "Preserve practical know-how, accelerate onboarding, and give new joiners more than a folder of documents that no longer match reality.",
    outcome: "From knowledge transfer events to living organizational memory.",
  },
];

const differentiators = [
  {
    icon: AudioLines,
    title: "Voice-first",
    description:
      "People explain their work more naturally than they document it. Fabric starts there.",
  },
  {
    icon: ShieldCheck,
    title: "Evidence-backed",
    description:
      "Summaries, process steps, and insights stay connected to the people and conversations behind them.",
  },
  {
    icon: LockKeyhole,
    title: "Permission-aware",
    description:
      "Everyone sees what their role allows. AskFabric and connected assistants answer only from what the person asking can see.",
  },
  {
    icon: Lightbulb,
    title: "Built for improvement",
    description:
      "Fabric goes beyond capture to surface the bottlenecks, risks, and opportunities hidden inside the work.",
  },
];

/**
 * The scope ladder behind "One conversation can clarify an entire organization".
 * Each rung's detail is the count of the rung above it, so the column reads as one
 * conversation aggregating all the way up to the organization. `scale` widens the
 * cards down the stack so the silhouette tells the same story as the labels.
 */
const organizationLayers = [
  { tier: "Conversation", name: "Invoice exceptions", detail: "3 contributors" },
  { tier: "Process", name: "Accounts payable", detail: "7 conversations" },
  { tier: "Department", name: "Finance operations", detail: "8 processes" },
  { tier: "Function", name: "Finance", detail: "4 departments" },
  // The product's top level is the Process Tree of functions; there is no
  // separate company-wide map (the firm view was rolled back in October).
  { tier: "Organization", name: "Process Tree", detail: "6 functions" },
];

const faqs = [
  {
    question: "What does Fabric capture?",
    answer:
      "Fabric captures how work actually happens: the steps people take, the decisions they make, the tools they use, the handoffs between teams, and the exceptions that rarely make it into formal documentation.",
  },
  {
    question: "Is Fabric a transcription tool?",
    answer:
      "Transcription is only the starting point. Fabric turns conversations into structured process summaries, interactive process maps, and operational insights that teams can review and improve together.",
  },
  {
    question: "Who contributes to Fabric?",
    answer:
      "The people closest to the work. Contributors can speak with an AI interviewer, record a conversation directly, or upload existing audio so the organization can learn from their practical experience.",
  },
  {
    question: "What do contributors need to do?",
    answer:
      "Open a process and talk. Fabric works in a current browser on a computer or a phone, with a microphone. The interviewer asks the follow-up questions, so nobody has to prepare a document. Someone can also record a conversation on a colleague’s behalf.",
  },
  {
    question: "What does Fabric recommend?",
    answer:
      "Up to five changes for each process, from removing a step, simplifying, or training to a workflow, an integration, or an agent. They’re ranked by value and effort, and Fabric prefers the lighter change when two would work equally well. Each one comes with a change plan or a build brief you can copy.",
  },
  {
    question: "How does Fabric support transformation work?",
    answer:
      "It gives transformation teams an evidence-backed current-state view before solutions are selected—making it easier to identify high-value automation opportunities, fragile handoffs, duplicated work, and knowledge risk.",
  },
  {
    question: "Can we ask Fabric questions directly?",
    answer:
      "Yes. AskFabric, now in beta, answers in plain language from your workspace’s evidence, never from general knowledge. Every claim links to the contribution, flow step, or finding it came from.",
  },
  {
    question: "Does Fabric work with Claude or Copilot?",
    answer:
      "Yes, as an add-on. Fabric connects to Claude and Microsoft Copilot Studio through the Model Context Protocol (MCP), so people can ask how the organization works from inside those assistants. The connection is read-only, a workspace admin switches it on, and it shows each person only what they can already see in Fabric.",
  },
  {
    question: "Who can see what?",
    answer:
      "Every member of a workspace has a role (viewer, contributor, or admin) that sets what they can see and do. AskFabric and connected assistants see only what the person asking can see. AskFabric conversations are private to the person who started them; admins can’t read them.",
  },
];

function BookDemoButton({ inverted = false }: { inverted?: boolean }) {
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

export function MarketingLandingPage() {
  return (
    <main className={styles.site}>
      <header className={styles.navigation}>
        <div className={styles.navigationInner}>
          <a href="#top" className={styles.wordmark} aria-label="Fabric home">
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
          </a>

          <nav className={styles.desktopNavigation} aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#platform">Platform</a>
            <a href="#use-cases">Use cases</a>
          </nav>

          <div className={styles.navigationActions}>
            <SignInMenu />
            <BookDemoButton />
            <MobileNavigation />
          </div>
        </div>
      </header>

      <section id="top" className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>
            Turn how work <em>really happens</em> into a living map of your
            business.
          </h1>
          <p>
            Fabric captures the conversations behind your operations, turns
            them into clear process knowledge, and reveals where to improve,
            automate, and de-risk.
          </p>
          <div className={styles.heroActions}>
            <BookDemoButton />
            <TourVideoDialog />
          </div>
        </div>

        <div className={styles.heroDemoWrap}>
          <HeroConversationDemo />
        </div>
      </section>

      <section className={styles.problemSection}>
        <div className={styles.problemInner}>
          <h2>
            Your business already has an operating system. Most of it lives in
            people’s heads.
          </h2>
          <div className={styles.problemCopy}>
            <p>
              The real process is rarely the one in the document. It lives in
              conversations, judgment calls, workarounds, and the quiet
              handoffs that keep work moving.
            </p>
            <p>
              Fabric makes that invisible system visible—without turning
              knowledge capture into another documentation project.
            </p>
          </div>
        </div>
        <div className={styles.problemThreads} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>

      <section id="how-it-works" className={styles.journeySection}>
        <div className={styles.sectionIntro}>
          <h2>From a conversation to a clearer way forward.</h2>
          <p>
            Fabric follows the knowledge all the way through—from the person
            doing the work to the insight that helps the organization improve
            it.
          </p>
        </div>
        <ProductJourneyDemo />
      </section>

      <section id="platform" className={styles.organizationSection}>
        <div className={styles.organizationCopy}>
          <h2>One conversation can clarify an entire organization.</h2>
          <p>
            Fabric gives every piece of knowledge a place. Individual voices
            become process understanding, and process understanding becomes a
            connected view across departments and functions.
          </p>
          <p>
            As new conversations arrive, the picture grows with the business
            instead of becoming another static archive.
          </p>
        </div>

        <div className={styles.organizationMap}>
          <ol
            className={styles.orgStack}
            aria-label="How the scope of one conversation widens, from a single conversation up to the whole organization"
          >
            {organizationLayers.map((layer, index) => (
              <li
                key={layer.tier}
                className={styles.orgLayer}
                style={
                  {
                    "--layer-scale": `${64 + index * 9}%`,
                    "--layer-index": index,
                  } as CSSProperties
                }
              >
                <span>{layer.tier}</span>
                <strong>{layer.name}</strong>
                <small>{layer.detail}</small>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="use-cases" className={styles.useCasesSection}>
        <div className={styles.useCasesIntro}>
          <h2>Built for everyone responsible for making the business better.</h2>
          <p>
            The same operational truth can answer different questions across
            the organization—without every team starting discovery again.
          </p>
        </div>

        <div className={styles.useCaseList}>
          {useCases.map((useCase) => (
            <article key={useCase.number} className={styles.useCaseCard}>
              <span aria-hidden="true">{useCase.number}</span>
              <div>
                <h3>{useCase.title}</h3>
                <p>{useCase.description}</p>
              </div>
              <strong>{useCase.outcome}</strong>
            </article>
          ))}
        </div>
      </section>

      {/* TODO(marketing-proof): Add only approved customer logos, metrics, or testimonials here. */}

      <section className={styles.differenceSection}>
        <div className={styles.differenceIntro}>
          <h2>Knowledge capture that understands what comes next.</h2>
        </div>
        <div className={styles.differenceGrid}>
          {differentiators.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title}>
                <Icon aria-hidden="true" />
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            );
          })}
        </div>
        <p className={styles.differenceNote}>
          <strong>Add-on</strong>
          Use Fabric inside Claude and Microsoft Copilot Studio, so people can
          ask how the organization works from the assistant they already use.
        </p>
      </section>

      <section id="faq" className={styles.faqSection}>
        <div className={styles.faqIntro}>
          <h2>A few useful answers.</h2>
          <p>
            Fabric is designed to make operational discovery feel natural for
            contributors and immediately useful for the teams acting on it.
          </p>
        </div>
        <div className={styles.faqList}>
          {faqs.map((faq) => (
            <details key={faq.question}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <div className={styles.finalCtaRings} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className={styles.finalCtaContent}>
          <h2>
            The people doing the work already know how your business runs.
          </h2>
          <p>Fabric helps the organization learn from them.</p>
          <BookDemoButton inverted />
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <a href="#top" className={styles.wordmark} aria-label="Back to top">
            Fabric.
          </a>
          <p>
            The fabric of the organization, woven from the voices of the people
            who make it run.
          </p>
        </div>

        <nav className={styles.footerNav} aria-label="Footer">
          <div>
            <h2>Product</h2>
            <ul>
              {productLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href}>{link.label}</a>
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
                  <a href={link.href} target="_blank" rel="noopener noreferrer">
                    {link.label}
                    <span className={styles.srOnly}> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className={styles.footerBase}>
          <span>
            &copy; {new Date().getFullYear()} Fabric. Built by Biz Group.
          </span>
          <nav className={styles.legalLinks} aria-label="Legal">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Use</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
