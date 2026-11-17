"use client";

import { Check, ChevronRight, Copy, ExternalLink } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Building blocks for the MCP setup guides (Admin → MCP and Connect AI
 * assistants): a numbered step list where each step carries the exact values
 * it needs, so nobody has to match a field in one place to a value in another.
 */

/**
 * Copies text. The Clipboard API exists only in secure contexts (https or
 * localhost), so local dev on http://*.lvh.me falls back to a hidden textarea
 * and execCommand. The textarea goes next to the button, so a dialog's focus
 * trap doesn't stop it being selected.
 */
export async function copyText(text: string, near?: HTMLElement | null): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  (near?.parentElement ?? document.body).appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** A numbered list of steps joined by a rail. */
export function Steps({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cn("space-y-0", className)}>{children}</ol>;
}

/**
 * One step. `done` swaps the number for a tick, and is status only: every step
 * stays open, because admins come back to add another connector or copy a value.
 */
export function Step({
  n,
  title,
  done = false,
  status,
  children,
}: {
  n: number;
  title: ReactNode;
  done?: boolean;
  /** A short label beside the title, e.g. "Added". */
  status?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="group/step relative flex gap-3 pb-6 last:pb-0">
      <span aria-hidden className="absolute top-7 bottom-1 left-3 w-px -translate-x-1/2 bg-border group-last/step:hidden" />
      <span
        className={cn(
          "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
          done ? "border-success bg-success text-success-foreground" : "bg-background text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3.5" aria-hidden /> : n}
        <span className="sr-only">{done ? `Step ${n}, done` : `Step ${n}`}</span>
      </span>
      <div className="min-w-0 flex-1 space-y-2.5 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="text-sm font-medium">{title}</h4>
          {status && <span className="text-xs font-medium text-success">{status}</span>}
        </div>
        {children}
      </div>
    </li>
  );
}

/** A muted one-liner under a step title. */
export function StepHint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/** Where to click in another app, e.g. Settings › Connectors › Add custom connector. */
export function MenuPath({ items, label }: { items: string[]; label?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs">
      {label && <span className="mr-0.5 text-muted-foreground">{label}</span>}
      {items.map((item, i) => (
        <Fragment key={item}>
          {i > 0 && <ChevronRight className="size-3 text-muted-foreground" aria-label="then" />}
          <span className="rounded border bg-muted/50 px-1.5 py-0.5 font-medium">{item}</span>
        </Fragment>
      ))}
    </p>
  );
}

/** An icon button that copies `value`, with a tick for two seconds after. */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={async (event) => {
        if (await copyText(value, event.currentTarget)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } else {
          toast.error(`Couldn't copy the ${label.toLowerCase()}. Select it and copy it by hand.`);
        }
      }}
    >
      {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </Button>
  );
}

/** A bordered group of label / value / copy rows. */
export function Values({ children }: { children: ReactNode }) {
  return <div className="divide-y overflow-hidden rounded-md border">{children}</div>;
}

/**
 * One row: the label matches the field name in the other app, so the value goes
 * where the label says. Pass `children` instead of `value` for a row that has
 * no copyable value (e.g. a secret that's no longer shown).
 */
export function ValueRow({
  label,
  value,
  children,
  tone = "default",
}: {
  label: string;
  value?: string | null;
  children?: ReactNode;
  tone?: "default" | "warning";
}) {
  // An unconfigured value (e.g. no issuer on this deployment) is left out rather than shown blank.
  if (children === undefined && !value) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 sm:flex-nowrap",
        tone === "warning" && "bg-warning-subtle",
      )}
    >
      <span className="basis-full text-xs text-muted-foreground sm:basis-40 sm:shrink-0">{label}</span>
      {children ?? (
        <>
          <code className="min-w-0 flex-1 truncate font-mono text-xs" title={value ?? undefined}>
            {value}
          </code>
          {value && <CopyButton value={value} label={label} className="-mr-1.5 shrink-0" />}
        </>
      )}
    </div>
  );
}

/** A link out to another app, opened in a new tab. */
export function OpenAppLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
      {children}
      <ExternalLink data-icon="inline-end" aria-hidden />
    </a>
  );
}
