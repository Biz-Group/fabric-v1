"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { Tabs } from "@base-ui/react/tabs";
import {
  AlertTriangle,
  ArrowRightLeft,
  ArrowUp,
  AtSign,
  BarChart3,
  Bot,
  ChevronDown,
  ClipboardCopy,
  Clock,
  Copy,
  FileText,
  GitBranch,
  Lightbulb,
  Menu,
  Mic,
  MoreHorizontal,
  Pause,
  Play,
  PlayCircle,
  Share2,
  Sparkles,
  Square,
  Upload,
  User,
  Wrench,
  X,
  Zap,
} from "lucide-react";

import styles from "@/features/marketing/marketing-landing-page.module.css";
import { landingSectionLinks } from "@/features/marketing/site-links";
import { WorkspaceSignInForm } from "@/features/marketing/workspace-sign-in";

const stages = [
  {
    id: "capture",
    title: "Capture",
    heading: "Start with a natural conversation.",
    description:
      "People share the practical details, judgment calls, and exceptions that a blank document never asks for.",
  },
  {
    id: "understand",
    title: "Understand",
    heading: "Turn many voices into shared knowledge.",
    description:
      "Fabric organizes the evidence into a readable brief while keeping contributor context close at hand.",
  },
  {
    id: "map",
    title: "Map",
    heading: "See how the work moves end to end.",
    description:
      "Actions, decisions, tools, waits, and handoffs become a process map the whole team can examine.",
  },
  {
    id: "improve",
    title: "Improve",
    heading: "Find the change that is worth making.",
    description:
      "Fabric recommends up to five changes per process, from removing a step to building an agent. They're ranked by value and effort, and each one is tied to the evidence behind it.",
  },
  {
    id: "ask",
    title: "Ask",
    heading: "Ask how the work really runs.",
    description:
      "AskFabric (beta) answers questions in plain language from your organization’s evidence and links every claim to its source.",
  },
] as const;

type StageId = (typeof stages)[number]["id"];

/**
 * The popover closes on Escape, an outside press or a link, and always hands
 * focus back to the trigger (the header is sticky, so that never scrolls). It
 * portals into its own wrapper so the page's CSS variables and fonts still apply.
 */
export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={rootRef} className={styles.mobileNavigation}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger aria-label={open ? "Close navigation" : "Open navigation"}>
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </Popover.Trigger>
        <Popover.Portal container={rootRef}>
          <Popover.Positioner
            side="bottom"
            align="end"
            sideOffset={12.8}
            collisionAvoidance={{ side: "none" }}
          >
            <Popover.Popup
              className={styles.mobileNavigationPopup}
              aria-label="Navigation"
            >
              <nav aria-label="Mobile navigation" className={styles.mobileNavigationPanel}>
                {landingSectionLinks.map((link) => (
                  <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
                    {link.label}
                  </Link>
                ))}
                <div className={styles.mobileSignIn}>
                  <WorkspaceSignInForm />
                </div>
              </nav>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/**
 * Fixed envelope for the decorative waveforms. The bar heights used to be derived
 * in CSS with `calc(... var(--bar-index) % 5 ...)`, but `%` is a unit in `calc()`
 * rather than a modulo operator, so the whole declaration was invalid and the bars
 * collapsed to zero height. Driving the height from here keeps the pattern
 * deterministic across server and client renders.
 */
const waveformEnvelope = [
  34, 52, 78, 96, 64, 40, 58, 88, 100, 72, 46, 30, 44, 68,
  92, 76, 50, 36, 62, 84, 98, 70, 42, 32, 56, 80, 60, 38,
];

function waveformBarStyle(index: number): CSSProperties {
  return {
    "--bar-index": index,
    "--bar-height": `${waveformEnvelope[index % waveformEnvelope.length]}%`,
  } as CSSProperties;
}

// The three ways knowledge gets into Fabric, and only those: Fabric captures
// audio, it doesn't import documents.
const heroSources = [
  {
    icon: Bot,
    title: "Invoice approvals",
    meta: "AI interview",
    visual: "conversation",
    delay: "0s",
  },
  {
    icon: Mic,
    title: "Customer onboarding",
    meta: "Voice note",
    visual: "voice",
    delay: "2s",
  },
  {
    icon: Upload,
    title: "Month-end close",
    meta: "Uploaded recording",
    visual: "upload",
    delay: "4s",
  },
] as const;

/**
 * Thread geometry is expressed as percentages of the `.heroConcept` box, which is
 * why the SVGs use a 0-100 viewBox with `preserveAspectRatio="none"`. The layout
 * keeps those percentages true:
 *
 * - desktop columns are `6fr 8fr 6fr` with no gap or padding, so the source cards
 *   end at x=30, the result cards start at x=70, and the core sits at (50, 50);
 * - mobile rows are `5fr 7fr 5fr`, so the source cards end at y=29.4 and the
 *   result cards start at y=70.6;
 * - each bank lays its cards on equal `1fr` tracks, putting their centres on the
 *   1/6, 1/2 and 5/6 lines of the cross axis (the mobile banks keep a small gap,
 *   which nudges the outer two by a fraction of a percent).
 *
 * Every thread runs a few units *underneath* the cards and into the core, both of
 * which paint opaquely above the SVG. The ends stay hidden, so sub-pixel drift
 * never leaves a line dangling in open space.
 */
const heroThreadViewBox = "0 0 100 100";

const desktopHeroThreads = [
  "M 26 16.667 C 34 16.667, 36 50, 50 50",
  "M 26 50 L 50 50",
  "M 26 83.333 C 34 83.333, 36 50, 50 50",
  "M 50 50 C 64 50, 66 16.667, 74 16.667",
  "M 50 50 L 74 50",
  "M 50 50 C 64 50, 66 83.333, 74 83.333",
] as const;

const mobileHeroThreads = [
  "M 16.3 26.4 C 16.3 36, 50 40, 50 50",
  "M 50 26.4 L 50 50",
  "M 83.7 26.4 C 83.7 36, 50 40, 50 50",
  "M 50 50 C 50 60, 16.3 64, 16.3 73.6",
  "M 50 50 L 50 73.6",
  "M 50 50 C 50 60, 83.7 64, 83.7 73.6",
] as const;

function HeroConceptThreads({
  paths,
  className,
}: {
  paths: readonly string[];
  className: string;
}) {
  return (
    <svg
      className={className}
      viewBox={heroThreadViewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {paths.map((path, index) => (
        <g key={path}>
          <path className={styles.heroThreadBase} d={path} />
          <path
            className={styles.heroThreadPulse}
            d={path}
            pathLength="100"
            style={{ "--thread-delay": `${index * 0.72}s` } as CSSProperties}
          />
        </g>
      ))}
    </svg>
  );
}

export function HeroConversationDemo() {
  return (
    <div className={styles.heroDemo}>
      <p className={styles.srOnly}>
        AI interviews, voice notes, and uploaded recordings flow into Fabric.
        Fabric connects them into a shared summary, a living process flow, and
        clear improvement insights.
      </p>
      <div className={styles.heroConcept} aria-hidden="true">
        <HeroConceptThreads
          paths={desktopHeroThreads}
          className={styles.heroDesktopThreads}
        />
        <HeroConceptThreads
          paths={mobileHeroThreads}
          className={styles.heroMobileThreads}
        />

        <div className={styles.heroSourceBank}>
          {heroSources.map((source) => {
            const Icon = source.icon;
            return (
              <article
                key={source.title}
                className={styles.heroSourceCard}
                style={{ "--item-delay": source.delay } as CSSProperties}
              >
                <div className={styles.heroSourceHeading}>
                  <span><Icon /></span>
                  <div>
                    <strong>{source.title}</strong>
                    <small>{source.meta}</small>
                  </div>
                </div>
                {source.visual === "conversation" && (
                  <div className={styles.heroConversationSignal}>
                    <i /><i /><i />
                  </div>
                )}
                {source.visual === "voice" && (
                  <div className={styles.heroVoiceSignal}>
                    {Array.from({ length: waveformEnvelope.length }, (_, index) => (
                      <i key={index} style={waveformBarStyle(index)} />
                    ))}
                  </div>
                )}
                {source.visual === "upload" && (
                  <div className={styles.heroUploadSignal}>
                    <i />
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <div className={styles.heroFabricEngine}>
          <div className={styles.heroFabricCore}>
            <i />
          </div>
          <div>
            <strong>Fabric</strong>
            <span>Connects what people know</span>
          </div>
        </div>

        <div className={styles.heroResultBank}>
          <article
            className={`${styles.heroResultCard} ${styles.heroSummaryResult}`}
          >
            <div className={styles.heroResultHeading}>
              <span><FileText /></span>
              <strong>Shared summary</strong>
            </div>
            <div className={styles.heroSummaryLines}>
              <i /><i /><i />
            </div>
            <small>One evidence-backed view</small>
          </article>

          <article
            className={`${styles.heroResultCard} ${styles.heroFlowResult}`}
          >
            <div className={styles.heroResultHeading}>
              <span><GitBranch /></span>
              <strong>Living process</strong>
            </div>
            <div className={styles.heroMiniFlow}>
              <i /><b /><i /><b /><i />
            </div>
            <small>Steps, decisions, and handoffs</small>
          </article>

          <article
            className={`${styles.heroResultCard} ${styles.heroInsightsResult}`}
          >
            <div className={styles.heroResultHeading}>
              <span><Lightbulb /></span>
              <strong>Clear insights</strong>
            </div>
            <div className={styles.heroInsightSignals}>
              <span><strong>1</strong> bottleneck</span>
              <span><strong>2</strong> opportunities</span>
            </div>
            <small>Where to improve next</small>
          </article>
        </div>
      </div>
    </div>
  );
}

const subscribeNever = () => () => {};

export function ProductJourneyDemo() {
  const [activeStage, setActiveStage] = useState<StageId>("capture");
  // Hover and focus hold the stage only while they last.
  const [held, setHeld] = useState(false);
  // The visitor's own choice; null until they press Pause/Play or pick a stage.
  const [playChoice, setPlayChoice] = useState<boolean | null>(null);
  const reduceMotion = useReducedMotion();
  // The reduced-motion preference is only known in the browser, so the server
  // render and hydration both assume it is off and the label can't mismatch.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const playing = playChoice ?? !(hydrated && reduceMotion);
  const activeIndex = stages.findIndex((stage) => stage.id === activeStage);
  const active = stages[activeIndex];

  // A timeout per stage rather than an interval, so every stage change, the
  // visitor's included, gets the full reading time before the next advance.
  useEffect(() => {
    if (!playing || held) return;

    const timeout = window.setTimeout(() => {
      setActiveStage((current) => {
        const index = stages.findIndex((stage) => stage.id === current);
        return stages[(index + 1) % stages.length].id;
      });
    }, 6500);

    return () => window.clearTimeout(timeout);
  }, [activeStage, playing, held]);

  // Arrow keys, Home and End move through the stages and select as they go. The
  // copy sits inside the one panel, so a chosen stage is read from its tab, and
  // the automatic rotation stays silent. Choosing a stage stops the rotation so
  // it stays on screen; Play resumes it.
  return (
    <Tabs.Root
      className={styles.productJourney}
      value={activeStage}
      onValueChange={(value: StageId) => {
        setActiveStage(value);
        setPlayChoice(false);
      }}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={(event) => {
        // Focus on the toggle itself shouldn't hold the stage it just resumed.
        if (!(event.target as HTMLElement).closest("[data-rotation-toggle]")) {
          setHeld(true);
        }
      }}
      onBlurCapture={() => setHeld(false)}
    >
      <Tabs.List
        className={styles.journeyControls}
        aria-label="How Fabric works"
        activateOnFocus
      >
        {stages.map((stage, index) => (
          <Tabs.Tab
            key={stage.id}
            value={stage.id}
            className={stage.id === activeStage ? styles.journeyTabActive : undefined}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {stage.title}
          </Tabs.Tab>
        ))}
      </Tabs.List>

      <Tabs.Panel value={activeStage} className={styles.journeyContent}>
        <div className={styles.journeyCopy}>
          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: "easeOut" }}
            >
              <h3>{active.heading}</h3>
              <p>{active.description}</p>
            </motion.div>
          </AnimatePresence>
          <div className={styles.journeyPlayback}>
            <div className={styles.journeyProgress} aria-hidden="true">
              <span style={{ width: `${((activeIndex + 1) / stages.length) * 100}%` }} />
            </div>
            <button
              type="button"
              className={styles.journeyPlayToggle}
              data-rotation-toggle
              onClick={() => {
                // The pointer is still over the demo; let Play take effect now
                // rather than after the next mouse leave.
                setHeld(false);
                setPlayChoice(!playing);
              }}
            >
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {playing ? "Pause demo" : "Play demo"}
            </button>
          </div>
        </div>

        <div className={styles.demoStage}>
          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              className={styles.demoStageInner}
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              transition={{ duration: reduceMotion ? 0 : 0.3, ease: "easeOut" }}
            >
              {/* Deterministic product simulations: no API or service calls. */}
              {active.id === "ask" ? (
                <AskStage />
              ) : (
                <FabricWorkbench stage={active.id}>
                  {active.id === "capture" && <CaptureStage />}
                  {active.id === "understand" && <UnderstandStage />}
                  {active.id === "map" && <MapStage />}
                  {active.id === "improve" && <ImproveStage />}
                </FabricWorkbench>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </Tabs.Panel>
    </Tabs.Root>
  );
}

const workbenchTabForStage = {
  capture: "Contributions",
  understand: "Overview",
  map: "Process Flow",
  improve: "Recommendations",
} as const satisfies Record<Exclude<StageId, "ask">, string>;

function FabricWorkbench({
  stage,
  children,
}: {
  stage: Exclude<StageId, "ask">;
  children: ReactNode;
}) {
  const activeTab = workbenchTabForStage[stage];

  // The product's five process tabs, in its order.
  const tabs = [
    { label: "Overview", icon: FileText },
    { label: "Contributions", icon: Mic, count: 4 },
    { label: "Process Flow", icon: GitBranch },
    { label: "Insights", icon: BarChart3 },
    { label: "Recommendations", icon: Lightbulb, count: 3 },
  ];

  return (
    <div className={styles.fabricWorkbench}>
      <div className={styles.workbenchHeader}>
        <div className={styles.workbenchHeaderCopy}>
          <div className={styles.workbenchBreadcrumb}>
            Operations <span>/</span> Procurement <span>/</span> Purchase order approvals
          </div>
          <div className={styles.workbenchTitleRow}>
            <h4>Purchase order approvals</h4>
            <span>Current</span>
          </div>
          <div className={styles.workbenchMetadata}>
            <span>AK</span>
            <p>Last contribution by Amira K.</p>
            <i />
            <p>Updated 2h ago</p>
          </div>
        </div>
        <div className={styles.workbenchActions}>
          <button type="button" tabIndex={-1}>
            <Bot /> Start AI interview <ChevronDown />
          </button>
          <span><Share2 /></span>
          <span><MoreHorizontal /></span>
        </div>
      </div>
      <div className={styles.workbenchTabs}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <span
              key={tab.label}
              className={tab.label === activeTab ? styles.workbenchTabActive : undefined}
            >
              {/* On a phone only the active tab keeps its label, so all five fit. */}
              <Icon /> <b>{tab.label}</b>
              {tab.count && <i>{tab.count}</i>}
            </span>
          );
        })}
      </div>
      <div className={styles.workbenchBody}>{children}</div>
    </div>
  );
}

function CaptureStage() {
  const waveform = Array.from({ length: 28 }, (_, index) => index);

  return (
    <div className={styles.conversationDemo}>
      <div className={styles.conversationListMock}>
        <div className={styles.mockFilters}>
          <span>All contributions <ChevronDown /></span>
          <span>Newest first <ChevronDown /></span>
        </div>
        <div className={`${styles.mockConversationRow} ${styles.mockConversationSelected}`}>
          <span className={styles.mockConversationIcon}><Bot /></span>
          <div>
            <div><strong>AI interview with Amira K.</strong><span>Completed</span></div>
            <p><User /> Amira K. <Clock /> Today, 10:24 AM <i>18:42</i></p>
          </div>
        </div>
        <div className={styles.mockConversationRow}>
          <span className={styles.mockConversationIcon}><Mic /></span>
          <div>
            <div><strong>Voice note with Kareem S.</strong><span>Completed</span></div>
            <p><User /> Kareem S. <Clock /> Yesterday <i>11:08</i></p>
          </div>
        </div>
      </div>

      <div className={styles.mockPlayback}>
        <div className={styles.mockAudioControls}>
          <button type="button" tabIndex={-1}><Play /></button>
          <div>
            {waveform.map((index) => (
              <i key={index} style={waveformBarStyle(index)} />
            ))}
          </div>
          <span>18:42</span>
        </div>
        <div className={styles.mockPlaybackSection}>
          <h5>Summary</h5>
          <p>
            Purchase requests are checked for complete project coding before
            routing to the appropriate approver.
          </p>
        </div>
        <div className={styles.mockPlaybackSection}>
          <h5>Transcript</h5>
          <div className={styles.mockTranscript}>
            <p><strong>Fabric</strong> What happens when the project code is missing?</p>
            <p><strong>Amira</strong> It comes back to Operations before Finance sees it.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function UnderstandStage() {
  return (
    <div className={styles.summaryDemo}>
      <div className={styles.summaryDemoToolbar}>
        <button type="button" tabIndex={-1} aria-label="Copy summary"><Copy /></button>
        <button type="button" tabIndex={-1}><Sparkles /> Rebuild</button>
      </div>
      <article>
        <h5>Overview</h5>
        <p>
          Purchase requests are validated by Operations before routing to the
          correct financial approver. Project coding is the most common source
          of delay. <strong>[Amira K., Kareem S.]</strong>
        </p>
        <h5>Key stages</h5>
        <ul>
          <li>Validate the request, supplier, and project code.</li>
          <li>Route by value and approval threshold.</li>
          <li>Return incomplete requests to the owner.</li>
        </ul>
        <h5>Tensions &amp; gaps</h5>
        <p>
          Operations describes project-code validation as mandatory, while one
          contributor reports urgent requests occasionally bypassing the check.
          <strong>[Operations review, Kareem S.]</strong>
        </p>
        <blockquote>
          “Missing codes come back to us before approval.”
          <cite>Amira K., Operations</cite>
        </blockquote>
      </article>
    </div>
  );
}

type FlowCategory = "start" | "action" | "decision" | "handoff" | "end";

const flowNodeConfig = {
  start: { icon: Play, label: "Start" },
  action: { icon: Zap, label: "Action" },
  decision: { icon: GitBranch, label: "Decision" },
  handoff: { icon: ArrowRightLeft, label: "Handoff" },
  end: { icon: Square, label: "End" },
} as const;

function DemoFlowNode({
  category,
  title,
  description,
  indicator,
  automation,
}: {
  category: FlowCategory;
  title: string;
  description: string;
  indicator?: string;
  automation?: "high" | "medium";
}) {
  const config = flowNodeConfig[category];
  const Icon = config.icon;

  return (
    <div className={`${styles.demoFlowNode} ${styles[`demoFlowNode${category}`]}`}>
      <div className={styles.demoFlowNodeHeader}>
        <span><Icon /></span>
        <strong>{title}</strong>
      </div>
      <div className={styles.demoFlowBadges}>
        <span>{config.label}</span>
        {automation && <span><Bot /> {automation}</span>}
      </div>
      <p>{description}</p>
      {indicator && (
        <div className={styles.demoFlowIndicator}>
          <AlertTriangle /> {indicator}
        </div>
      )}
    </div>
  );
}

function FlowConnector({ label }: { label?: string }) {
  return (
    <div className={styles.flowConnector}>
      {label && <span>{label}</span>}
      <i />
    </div>
  );
}

function MapStage() {
  return (
    <div className={styles.processFlowDemo}>
      <div className={styles.processFlowTrack}>
        <DemoFlowNode
          category="start"
          title="Request received"
          description="Operations receives the purchase request."
        />
        <FlowConnector />
        <DemoFlowNode
          category="action"
          title="Validate request"
          description="Check supplier, project code, and supporting evidence."
          automation="high"
        />
        <FlowConnector />
        <DemoFlowNode
          category="decision"
          title="Project code valid?"
          description="Incomplete requests cannot enter approval."
          indicator="bottleneck"
        />
        <div className={styles.flowBranches}>
          <div>
            <FlowConnector label="No" />
            <DemoFlowNode
              category="action"
              title="Return to owner"
              description="Operations requests the missing information."
            />
          </div>
          <div>
            <FlowConnector label="Yes" />
            <DemoFlowNode
              category="handoff"
              title="Route for approval"
              description="Finance receives the validated request."
            />
          </div>
        </div>
      </div>
      <div className={styles.processFlowSignals}>
        <span><BarChart3 /> 5 steps</span>
        <span><ArrowRightLeft /> 1 handoff</span>
        <span><Wrench /> 3 tools</span>
        <span><AlertTriangle /> 1 bottleneck</span>
        <span><Bot /> 1 automation opportunity</span>
      </div>
    </div>
  );
}

/**
 * Mirrors the product's Recommendations tab: up to five per process, each one
 * kind of change (src/features/recommendations/recommendation-meta.ts), ranked
 * by value and then effort, with the evidence count behind it.
 */
const demoRecommendations = [
  {
    title: "Check project codes on the request form",
    kind: "Technical · Workflow",
    value: "High",
    effort: "Low",
    evidence: "3 interviews",
  },
  {
    title: "Standardise how approval thresholds are kept",
    kind: "Standardise",
    value: "Medium",
    effort: "Low",
    evidence: "2 interviews",
  },
  {
    title: "Show requesters where to find the right code",
    kind: "Training",
    value: "Medium",
    effort: "Low",
    evidence: "2 interviews",
  },
] as const;

function ImproveStage() {
  const [top] = demoRecommendations;

  return (
    <div className={styles.insightsDemo}>
      <section className={styles.insightSectionCard}>
        <header>
          <h5><Lightbulb /> Ranked by value, then effort</h5>
          <span>{demoRecommendations.length}</span>
        </header>
        <ol className={styles.recommendationList}>
          {demoRecommendations.map((item, index) => (
            <li key={item.title} className={index === 0 ? styles.recommendationSelected : undefined}>
              <span aria-hidden="true">{index + 1}</span>
              <div>
                <strong>{item.title}</strong>
                <small>{item.kind}</small>
              </div>
              <p>
                <em>Value {item.value}</em>
                <em>Effort {item.effort}</em>
                <em>{item.evidence}</em>
              </p>
            </li>
          ))}
        </ol>
      </section>

      <div className={styles.insightCandidate}>
        <div>
          <strong>{top.title}</strong>
          <span>Shortlisted</span>
        </div>
        <p>
          Three contributors named missing or wrong project codes as the main
          reason requests come back to Operations before Finance sees them.
        </p>
        <div>
          <span><Lightbulb /> Pilot and measure</span>
          Check codes on one team’s requests for four weeks, and count how many
          still come back.
        </div>
      </div>

      <div className={styles.recommendationActions}>
        <span><ClipboardCopy /> Copy for Copilot Studio</span>
        <small>A build brief for technical changes; non-technical ones get a change plan.</small>
      </div>
    </div>
  );
}

const askSources = [
  { icon: GitBranch, kind: "Flow step", label: "Project code valid?" },
  { icon: AlertTriangle, kind: "Finding", label: "Bottleneck in code validation" },
  { icon: Mic, kind: "Contribution", label: "AI interview with Amira K." },
] as const;

/** AskFabric lives in its own page, not a process tab, so it gets its own frame. */
function AskStage() {
  return (
    <div className={`${styles.fabricWorkbench} ${styles.askWorkbench}`}>
      <div className={styles.askHeader}>
        <span><Sparkles /></span>
        <h4>AskFabric</h4>
        <i>Beta</i>
      </div>

      <div className={styles.askBody}>
        <p className={styles.askQuestion}>Where do purchase order approvals slow down?</p>

        <div className={styles.askAnswer}>
          <p>
            Most delays start before Finance sees the request. Requests with a
            missing or wrong project code go back to Operations<sup>1</sup>, and
            three contributors named this as the main reason requests are
            returned<sup>2</sup>. Routing also depends on a threshold table that
            one person keeps up to date<sup>3</sup>.
          </p>
          <p className={styles.askCoverage}>
            Based on 1 process in Procurement, from 4 contributions.
          </p>
          <div className={styles.askSources}>
            <h5>Sources</h5>
            <ol>
              {askSources.map((source, index) => {
                const Icon = source.icon;
                return (
                  <li key={source.label}>
                    <span>{index + 1}</span>
                    <Icon />
                    <b>{source.kind}</b> {source.label}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>

      <div className={styles.askComposer}>
        <span><AtSign /></span>
        <p>Ask about how work gets done…</p>
        <span><ArrowUp /></span>
      </div>
    </div>
  );
}

/**
 * A single demo stage, still, for the feature pages: the same frame and type
 * sizes as the landing page's journey demo, without the tabs or rotation.
 */
function StillDemo({ children }: { children: ReactNode }) {
  return (
    <div className={styles.demoStage}>
      <div className={styles.demoStageInner}>{children}</div>
    </div>
  );
}

export function AskPreview() {
  return (
    <StillDemo>
      <AskStage />
    </StillDemo>
  );
}

export function RecommendationsPreview() {
  return (
    <StillDemo>
      <FabricWorkbench stage="improve">
        <ImproveStage />
      </FabricWorkbench>
    </StillDemo>
  );
}

const TOUR_VIDEO_SRC = "/demo/fabric-tour.mp4";
const TOUR_POSTER_SRC = "/demo/fabric-tour-poster.jpg";
const TOUR_CAPTIONS_SRC = "/demo/fabric-tour.en.vtt";

/**
 * The captioned product tour onboarding also uses (tools/demo-video). The file
 * is faststart, and `preload="none"` means nothing downloads until the dialog
 * opens, so its size doesn't weigh on the landing page.
 */
export function TourVideoDialog() {
  const rootRef = useRef<HTMLDivElement>(null);
  // The modal must sit above the whole page, so it can't portal into the hero
  // (its own stacking context put the hero demo on top of it). The page's
  // `[data-public-page]` wrapper carries the marketing font variables; the
  // popup takes the `.site` class for the colour tokens.
  const portalRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    portalRef.current =
      rootRef.current?.closest<HTMLElement>("[data-public-page]") ?? document.body;
  }, []);

  return (
    <div ref={rootRef} className={styles.tourDialogRoot}>
      <Dialog.Root>
        <Dialog.Trigger className={styles.textLink}>
          <PlayCircle aria-hidden="true" />
          Watch the 2-minute tour
        </Dialog.Trigger>
        <Dialog.Portal container={portalRef}>
          <Dialog.Backdrop className={styles.tourBackdrop} />
          <Dialog.Popup className={`${styles.site} ${styles.tourPopup}`}>
            <div className={styles.tourPopupHeader}>
              <Dialog.Title>A two-minute tour of Fabric</Dialog.Title>
              <Dialog.Close aria-label="Close the tour">
                <X aria-hidden="true" />
              </Dialog.Close>
            </div>
            <video
              className={styles.tourVideo}
              src={TOUR_VIDEO_SRC}
              poster={TOUR_POSTER_SRC}
              controls
              autoPlay
              playsInline
              preload="none"
            >
              <track
                kind="captions"
                src={TOUR_CAPTIONS_SRC}
                srcLang="en"
                label="English"
                default
              />
            </video>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
