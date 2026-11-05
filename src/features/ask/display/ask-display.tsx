"use client";

import type { AskDisplayPart } from "../../../../convex/lib/askSchema";
import { EntityCards } from "./entity-cards";

/**
 * The components an answer shows (D56, PRD §4.3). Each display kind maps to
 * one whitelisted component that loads its own data through access-checked
 * queries. A kind this page doesn't render yet (one a newer backend sends)
 * renders nothing, and the answer still reads in full without it.
 */
function DisplayPart({ part }: { part: AskDisplayPart }) {
  switch (part.display) {
    case "entities":
      return <EntityCards part={part} />;
    default:
      return null;
  }
}

export function AskDisplays({ parts }: { parts: AskDisplayPart[] }) {
  if (parts.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {parts.map((part, index) => (
        <DisplayPart key={index} part={part} />
      ))}
    </div>
  );
}
