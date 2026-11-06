"use client";

import type { AskDisplayPart } from "../../../../convex/lib/askSchema";
import { ChoicePicker, type ChoiceOption } from "./choice-picker";
import { ContributeCard } from "./contribute-card";
import { EntityCards } from "./entity-cards";
import { FlowSnippet } from "./flow-snippet";
import { AskChart } from "./ask-chart";

/** What a picker needs from the conversation around it. */
export type ChoiceContext = {
  chosenId: string | null;
  active: boolean;
  onChoose: (option: ChoiceOption) => Promise<boolean>;
};

/**
 * The components an answer shows (D56, PRD §4.3). Each display kind maps to
 * one whitelisted component that loads its own data through access-checked
 * queries. A kind this page doesn't render yet (one a newer backend sends)
 * renders nothing, and the answer still reads in full without it.
 */
function DisplayPart({ part, choice, answeredAt }: { part: AskDisplayPart; choice: ChoiceContext; answeredAt: number }) {
  switch (part.display) {
    case "entities":
      return <EntityCards part={part} />;
    case "choices":
      return <ChoicePicker part={part} {...choice} />;
    case "contribute":
      return <ContributeCard part={part} />;
    case "flow":
      return <FlowSnippet part={part} />;
    case "chart":
      return <AskChart part={part} answeredAt={answeredAt} />;
    default:
      return null;
  }
}

/** `answeredAt` dates the answer, so a chart can say its data has changed since. */
export function AskDisplays({ parts, choice, answeredAt }: { parts: AskDisplayPart[]; choice: ChoiceContext; answeredAt: number }) {
  if (parts.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {parts.map((part, index) => (
        <DisplayPart key={index} part={part} choice={choice} answeredAt={answeredAt} />
      ))}
    </div>
  );
}
