import {
  ArrowUpRight,
  BarChart3,
  Bot,
  ClipboardList,
  EyeOff,
  FileSearch,
  Gauge,
  KeyRound,
  Layers,
  LockKeyhole,
  Quote,
  Scale,
  ShieldCheck,
  Sparkles,
  ToggleRight,
} from "lucide-react";

import {
  AskPreview,
  RecommendationsPreview,
} from "@/features/marketing/marketing-landing-demos";
import type { FeaturePageContent } from "@/features/marketing/feature-page";
import styles from "@/features/marketing/marketing-subpages.module.css";

/*
 * Feature page copy. Every claim here is checked against the in-app help
 * (src/content/help: askfabric.md, insights-and-recommendations.md,
 * fabric-mcp.md). Keep them in step: when the product changes, change both.
 * No residency or hosting claims until /security is approved (decision M3).
 */

/** A labelled band of short items, for the part of a page that's a list. */
function ListBand({
  heading,
  intro,
  groups,
}: {
  heading: string;
  intro: string;
  groups: ReadonlyArray<{ label: string; items: readonly string[] }>;
}) {
  return (
    <section className={styles.listBand}>
      <div className={styles.listBandIntro}>
        <h2>{heading}</h2>
        <p>{intro}</p>
      </div>
      <div className={styles.listBandGroups}>
        {groups.map((group) => (
          <div key={group.label}>
            <h3>{group.label}</h3>
            <ul>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export const askFabricContent: FeaturePageContent = {
  path: "/features/askfabric",
  eyebrow: "AskFabric",
  badge: "Beta",
  title: (
    <>
      Ask how your organisation <em>really works.</em>
    </>
  ),
  lede: "AskFabric answers questions in plain language from what your people have told Fabric, and links every claim to the evidence behind it.",
  visual: <AskPreview />,
  pointsHeading: "Answers you can check.",
  points: [
    {
      icon: Quote,
      title: "Every claim has a source",
      description:
        "Each claim carries a numbered source. Open it to read the quoted evidence, or follow it to the finding, flow step or transcript line it came from.",
    },
    {
      icon: FileSearch,
      title: "Only your evidence",
      description:
        "Answers come from your workspace’s contributions, overviews and process flows, never from general knowledge, and say how much of the organisation they cover.",
    },
    {
      icon: LockKeyhole,
      title: "Sees what you see",
      description:
        "AskFabric answers only from what the person asking can see. Threads are private: admins see usage and ratings, never the questions or answers.",
    },
    {
      icon: BarChart3,
      title: "More than text",
      description:
        "Answers can end with cards for the processes they cover, a flow step with the steps around it, or a chart you can switch to a table.",
    },
  ],
  stepsHeading: "Ask, check, follow up.",
  steps: [
    {
      title: "Ask in plain words",
      description:
        "Type a question or pick a suggested one. Start from any process, department or function page, or type @ to point at one.",
    },
    {
      title: "Check the evidence",
      description:
        "Hover over or tap a source to read what was said. The Sources list under each answer groups them by type.",
    },
    {
      title: "Keep going",
      description:
        "Ask a suggested follow-up in one click, copy the answer with its sources, or play it aloud. Threads stay in your list to rename, pin or archive.",
    },
  ],
  extra: (
    <ListBand
      heading="What it will and won’t do."
      intro="AskFabric is built to answer about the work, from the evidence, and to say so when the evidence runs out."
      groups={[
        {
          label: "It will",
          items: [
            "Answer from your workspace’s evidence and Fabric’s help",
            "Say how much of the organisation an answer covers",
            "Judge impact by how many processes and people a problem affects",
            "Ask which one you meant when a name matches several",
          ],
        },
        {
          label: "It won’t",
          items: [
            "Answer from general knowledge",
            "Profile, rank or judge individual people",
            "Recommend products or vendors",
            "Show anyone what they can’t already see in Fabric",
          ],
        },
      ]}
    />
  ),
  closing: {
    heading: "Ask your own organisation a question.",
    line: "See AskFabric answer from real evidence in a demo.",
  },
};

export const recommendationsContent: FeaturePageContent = {
  path: "/features/recommendations",
  eyebrow: "Recommendations",
  title: (
    <>
      Know <em>what to change</em> next, and why.
    </>
  ),
  lede: "For every process, Fabric suggests up to five changes, technical or not, ranked by value and effort and tied to what contributors described.",
  visual: <RecommendationsPreview />,
  pointsHeading: "Changes grounded in the work.",
  points: [
    {
      icon: Scale,
      title: "The lighter change first",
      description:
        "Removing a step or training a team can beat building an agent. When two changes would work equally well, Fabric prefers the lighter one.",
    },
    {
      icon: Gauge,
      title: "Ranked by value, then effort",
      description:
        "Value weighs how often the work happens, the problems reported on those steps and the roles involved. Effort weighs the kind of change and the systems it touches.",
    },
    {
      icon: ShieldCheck,
      title: "Evidence you can check",
      description:
        "Each one shows how many interviews it rests on, its cause, the people affected and what isn’t known yet. One interview is one person’s account.",
    },
    {
      icon: ClipboardList,
      title: "Ready to act on",
      description:
        "A non-technical change comes with a change plan: a pilot, a measure, a review date and how to undo it. A technical one comes with a build brief for Copilot Studio.",
    },
  ],
  stepsHeading: "From interviews to a decision.",
  steps: [
    {
      title: "People describe the work",
      description:
        "Contributors talk through a process. Fabric builds its flow and shows where it needs attention: bottlenecks, handoffs and knowledge held by one person.",
    },
    {
      title: "Fabric recommends",
      description:
        "Up to five changes per process. Zero is a real answer: nothing described needs changing. Recommendations follow the process flow, so they update when it does.",
    },
    {
      title: "Your team decides",
      description:
        "Shortlist, start, mark done or dismiss with a reason. Every decision is kept in the recommendation’s history.",
    },
  ],
  extra: (
    <ListBand
      heading="Nine kinds of change."
      intro="Each recommendation is one kind of change, so it’s clear what acting on it involves."
      groups={[
        {
          label: "Non-technical",
          items: ["Remove a step", "Simplify", "Standardise", "Role or policy", "Training"],
        },
        {
          label: "Technical",
          items: ["Workflow", "Integration", "AI assist", "Agent"],
        },
      ]}
    />
  ),
  closing: {
    heading: "Find the change worth making first.",
    line: "See Fabric’s recommendations on a real process in a demo.",
  },
};

/**
 * A generic assistant, not a likeness of Claude or Copilot: the point is that
 * Fabric's answer arrives wherever people already ask.
 */
function AssistantPreview() {
  return (
    <div className={styles.assistantPreview} aria-hidden="true">
      <div className={styles.assistantHeader}>
        <span><Bot /></span>
        <strong>Your assistant</strong>
        <i>Fabric connected</i>
      </div>
      <div className={styles.assistantBody}>
        <p className={styles.assistantQuestion}>
          Where does supplier onboarding slow down?
        </p>
        <p className={styles.assistantTool}>
          <Sparkles /> Read from Fabric: Supplier onboarding flow, Procurement overview
        </p>
        <div className={styles.assistantAnswer}>
          <p>
            Most of the waiting sits between Procurement and Finance. New
            suppliers wait for their bank details to be verified, and two
            contributors said requests are chased by email when nothing moves.
          </p>
          <ul>
            <li>
              Supplier onboarding · Process Flow <ArrowUpRight />
            </li>
            <li>
              Procurement · Overview <ArrowUpRight />
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export const assistantsContent: FeaturePageContent = {
  path: "/features/claude-and-copilot",
  eyebrow: "Fabric in Claude and Copilot",
  badge: "Add-on",
  title: (
    <>
      Ask Fabric from the assistant <em>you already use.</em>
    </>
  ),
  lede: "Connect Claude or Microsoft Copilot Studio to Fabric, and people can ask how the organisation works without leaving the assistant, with links back to the Fabric pages each answer comes from.",
  visual: <AssistantPreview />,
  pointsHeading: "Connected, on your terms.",
  points: [
    {
      icon: EyeOff,
      title: "Read-only",
      description:
        "An assistant can read from Fabric through the Model Context Protocol (MCP), but it can’t change anything in it.",
    },
    {
      icon: KeyRound,
      title: "Only what you can see",
      description:
        "Each person signs in with their own Fabric account, and their role and membership are checked on every request.",
    },
    {
      icon: ToggleRight,
      title: "Your admin decides",
      description:
        "A workspace admin switches the add-on on and chooses whether assistants can also read individual contributions. Switching it off cuts access straight away.",
    },
    {
      icon: Layers,
      title: "Usage, not content",
      description:
        "Admins see calls, active members and assistants over 30 days. Fabric records which tool was used and when, never what was asked.",
    },
  ],
  stepsHeading: "Set up once, ask anywhere.",
  steps: [
    {
      title: "An admin switches it on",
      description:
        "Under Admin, then MCP, after accepting the terms. They explain that what an assistant reads leaves Fabric and is handled by the assistant’s provider.",
    },
    {
      title: "Connect the assistant",
      description:
        "In Claude, add Fabric as a custom connector with your workspace’s address. In Copilot Studio, an agent maker and a Fabric admin set it up once per agent, step by step.",
    },
    {
      title: "Sign in and ask",
      description:
        "Sign in with your Fabric account when asked, then ask about how the organisation works. Answers link back to the Fabric pages they draw on.",
    },
  ],
  extra: (
    <ListBand
      heading="What an assistant can read."
      intro="The same organised knowledge your team sees in Fabric, limited to what the person asking can see."
      groups={[
        {
          label: "Always",
          items: [
            "Function, department and process overviews",
            "Process flows",
            "Signals, systems and coverage",
            "Recommendations",
            "Fabric help",
          ],
        },
        {
          label: "Only if an admin allows it",
          items: ["Individual contributions and transcripts"],
        },
      ]}
    />
  ),
  closing: {
    heading: "Bring Fabric to the assistant your people already use.",
    line: "Ask us about the add-on in a demo.",
  },
};
