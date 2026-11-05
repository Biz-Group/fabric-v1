"use client";

import type { AskDisplayPart } from "../../../../convex/lib/askSchema";
import { ChoicePicker, type ChoiceOption } from "./choice-picker";
import { ContributeCard } from "./contribute-card";
import { EntityCards } from "./entity-cards";

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
function DisplayPart({ part, choice }: { part: AskDisplayPart; choice: ChoiceContext }) {
  switch (part.display) {
    case "entities":
      return <EntityCards part={part} />;
    case "choices":
      return <ChoicePicker part={part} {...choice} />;
    case "contribute":
      return <ContributeCard part={part} />;
    default:
      return null;
  }
}

export function AskDisplays({ parts, choice }: { parts: AskDisplayPart[]; choice: ChoiceContext }) {
  if (parts.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {parts.map((part, index) => (
        <DisplayPart key={index} part={part} choice={choice} />
      ))}
    </div>
  );
}
