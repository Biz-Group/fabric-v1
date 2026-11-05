"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { Check } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { AskDisplayPart } from "../../../../convex/lib/askSchema";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type ChoiceOption = { kind: "function" | "department" | "process"; id: string; name: string };

/**
 * The disambiguation picker (FR-11.4): the entities a name matched, each with
 * its path. Choosing one asks the question again about it, as a new question.
 * Once chosen, the choice stays marked and the rest are disabled; a picker on
 * an older answer that was never answered is disabled too.
 */
export function ChoicePicker({
  part,
  chosenId,
  active,
  onChoose,
}: {
  part: AskDisplayPart;
  /** The option the next question mentioned, if any. */
  chosenId: string | null;
  /** Only the latest answer's picker can still be answered. */
  active: boolean;
  onChoose: (option: ChoiceOption) => Promise<boolean>;
}) {
  // Live names and paths, re-checked as the viewer (D56).
  const options = useQuery(api.askDisplay.getEntityCards, { refs: part.refs });
  const [pending, setPending] = useState<string | null>(null);
  const picked = chosenId ?? pending;

  if (options === undefined) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        {part.refs.map((ref) => (
          <Skeleton key={ref.id} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (options.length === 0) return null;

  const choose = async (option: ChoiceOption) => {
    setPending(option.id);
    if (!(await onChoose(option))) setPending(null);
  };

  return (
    <div role="group" aria-label="Which one do you mean?" className="flex flex-col gap-2">
      {options.map((option) => {
        const chosen = option.id === picked;
        const disabled = !active || picked !== null;
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            aria-pressed={chosen}
            onClick={() => void choose({ kind: option.kind, id: option.id, name: option.name })}
            className={cn(
              "focus-ring flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
              chosen
                ? "border-org-accent-border bg-org-accent-selected text-org-accent-selected-foreground"
                : "bg-background text-foreground enabled:hover:border-org-accent-border enabled:hover:bg-org-accent-subtle",
              disabled && !chosen && "opacity-60",
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{option.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {`${option.kind[0].toUpperCase()}${option.kind.slice(1)}`}
                {option.trail.length > 0 && ` in ${option.trail.join(" › ")}`}
              </span>
            </span>
            {chosen && <Check className="size-4 shrink-0 text-org-accent" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
