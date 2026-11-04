import type { Role } from "../lib/orgAuth";

/**
 * Starter prompts (FR-6), built deterministically from the same signals the
 * tools return (T8, T9, T15), with no model call. Every prompt must be
 * answerable with a citation (FR-6.4): each names data the tools can reach.
 */

export type SuggestionCategory = "orgWide" | "entitySignal" | "department" | "whatsNew" | "help";
/** What a prompt is about, for its card's label on the new-thread page. */
export type SuggestionTopic =
  | "friction"
  | "biggestMoves"
  | "systems"
  | "duplication"
  | "bottlenecks"
  | "handoffs"
  | "keyPersonRisk"
  | "gaps"
  | "whatsNew"
  | "coverage"
  | "usingFabric";
export type Suggestion = { text: string; category: SuggestionCategory; topic: SuggestionTopic };

export type SuggestionInputs = {
  /** Completed contributions in the org; zero means help prompts (FR-6.5). */
  completedContributions: number;
  role: Role;
  /** The strongest named signal, e.g. the top bottleneck and its process. */
  topSignal: { signal: "bottleneck" | "friction" | "tribalKnowledge" | "handoff"; processName: string } | null;
  /** Whether systems are evidenced, so a systems prompt has something to answer from. */
  hasSystems: boolean;
  /** The user's department, when they have a placement (FR-6.2). */
  department: string | null;
  /** New completed contributions since the user's previous visit, and that date. */
  newSince: { count: number; date: string } | null;
};

const SIGNAL_PHRASE = {
  bottleneck: "the bottleneck",
  friction: "the friction",
  tribalKnowledge: "the knowledge only a few people hold",
  handoff: "the handoffs",
} as const;

const SIGNAL_TOPIC = {
  bottleneck: "bottlenecks",
  friction: "friction",
  tribalKnowledge: "keyPersonRisk",
  handoff: "handoffs",
} as const satisfies Record<keyof typeof SIGNAL_PHRASE, SuggestionTopic>;

const FRICTION_PROMPT = "What's consistently slowing us down or creating friction across the business?";
const MOVES_PROMPT = "What would be the three most impactful moves we could make, based on the evidence?";
const SYSTEMS_PROMPT = "Which systems cause the most friction, and what would a replacement need to fix?";
const COVERAGE_PROMPT = "How much of the organization has been interviewed so far, and where are the gaps?";

/**
 * Help prompts for an org with no completed contributions yet, written so each
 * maps to a help article the role can read (T14 filters by audience).
 */
function helpPrompts(role: Role): Suggestion[] {
  const prompts =
    role === "viewer"
      ? [
          "What does Fabric do, and how is it organized?",
          "What can I see and do as a viewer?",
          "How do I read a process flow?",
          "How do I find my way around the workspace?",
        ]
      : [
          "How do I start an AI interview about a process?",
          "How do I record a voice note in my browser?",
          "What happens after I contribute?",
          role === "admin" ? "How do I invite members and manage roles?" : "What can each role see and do?",
        ];
  return prompts.map((text) => ({ text, category: "help", topic: "usingFabric" }));
}

/** 4–6 prompts in the FR-6.2 mix, or help prompts for an empty org (FR-6.5). */
export function buildSuggestions(inputs: SuggestionInputs): Suggestion[] {
  if (inputs.completedContributions === 0) return helpPrompts(inputs.role);

  const prompts: Suggestion[] = [
    // At least two org-wide executive prompts, in the seed-set style.
    { text: FRICTION_PROMPT, category: "orgWide", topic: "friction" },
    { text: MOVES_PROMPT, category: "orgWide", topic: "biggestMoves" },
  ];
  if (inputs.topSignal) {
    prompts.push({
      text: `What's behind ${SIGNAL_PHRASE[inputs.topSignal.signal]} in ${inputs.topSignal.processName}?`,
      category: "entitySignal",
      topic: SIGNAL_TOPIC[inputs.topSignal.signal],
    });
  }
  if (inputs.department) {
    prompts.push({
      text: `What are the biggest gaps in how ${inputs.department} works today?`,
      category: "department",
      topic: "gaps",
    });
  }
  if (inputs.newSince && inputs.newSince.count > 0) {
    prompts.push({ text: `What's new since ${inputs.newSince.date}?`, category: "whatsNew", topic: "whatsNew" });
  }
  if (inputs.hasSystems && prompts.length < 6) {
    prompts.push({ text: SYSTEMS_PROMPT, category: "orgWide", topic: "systems" });
  }
  if (prompts.length < 4) {
    prompts.push({ text: COVERAGE_PROMPT, category: "orgWide", topic: "coverage" });
  }
  return prompts.slice(0, 6);
}

/**
 * The topic of a prompt stored before topics existed, from its category and
 * the template it came from. Null for text no template produces.
 */
export function topicForStoredPrompt(prompt: { text: string; category: SuggestionCategory }): SuggestionTopic | null {
  switch (prompt.category) {
    case "help":
      return "usingFabric";
    case "whatsNew":
      return "whatsNew";
    case "department":
      return "gaps";
    case "entitySignal": {
      for (const signal of Object.keys(SIGNAL_PHRASE) as Array<keyof typeof SIGNAL_PHRASE>) {
        if (prompt.text.startsWith(`What's behind ${SIGNAL_PHRASE[signal]} in `)) return SIGNAL_TOPIC[signal];
      }
      return null;
    }
    case "orgWide": {
      const byText: Record<string, SuggestionTopic> = {
        [FRICTION_PROMPT]: "friction",
        [MOVES_PROMPT]: "biggestMoves",
        [SYSTEMS_PROMPT]: "systems",
        [COVERAGE_PROMPT]: "coverage",
      };
      return byText[prompt.text] ?? null;
    }
  }
}
