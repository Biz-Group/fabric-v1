"use client";

import { useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cardVariants } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const UNAVAILABLE_REASON = {
  switchOff: "AskFabric isn't switched on for this workspace.",
  missingConfig: "AskFabric isn't configured on this deployment yet.",
  invalidConfig: "AskFabric's configuration on this deployment is invalid.",
} as const;

function usd(microUsd: number): string {
  const value = microUsd / 1_000_000;
  return value < 0.01 && value > 0 ? "<$0.01" : `$${value.toFixed(2)}`;
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * "AskFabric usage" in /admin (FR-8.3, D39): who uses it and what it costs,
 * with no thread titles or content. Shows why it's unavailable when it is.
 */
export function AskFabricUsageCard() {
  const availability = useQuery(api.ask.getAvailability);
  const usage = useQuery(api.askUsage.getOrgUsage);

  return (
    <section className="space-y-3" aria-labelledby="askfabric-usage-heading">
      <div>
        <h3 id="askfabric-usage-heading" className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden />
          AskFabric usage
        </h3>
        <p className="text-xs text-muted-foreground">The last 30 days. Counts and cost only; questions and answers stay private.</p>
      </div>
      <div className={cardVariants({ className: "space-y-4" })}>
        {availability && !availability.available && availability.reason && (
          <p className="text-sm text-muted-foreground">{UNAVAILABLE_REASON[availability.reason]}</p>
        )}
        {usage === undefined ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : usage.last30Days.questions === 0 ? (
          <p className="text-sm text-muted-foreground">No questions asked yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Questions"
                value={String(usage.last30Days.questions)}
                hint={`${usage.last7Days.questions} in the last 7 days`}
              />
              <Stat
                label="Active users"
                value={String(usage.last30Days.activeUsers)}
                hint={`${usage.last30Days.threads} threads`}
              />
              <Stat label="Cost" value={usd(usage.costMicroUsd)} hint={`${usage.tokens.toLocaleString()} tokens`} />
              <Stat
                label="Feedback"
                value={`${usage.thumbsUp} up · ${usage.thumbsDown} down`}
                hint={`${percent(usage.errorRate)} errors · ${percent(usage.stopRate)} stopped`}
              />
            </div>
            {usage.members.length > 0 && (
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Questions and cost per member, last 30 days</caption>
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th scope="col" className="py-1.5 font-medium">Member</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Questions</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.members.map((member) => (
                    <tr key={member.userId} className="border-b last:border-b-0">
                      <td className="max-w-0 truncate py-1.5">{member.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{member.questions}</td>
                      <td className="py-1.5 text-right tabular-nums">{usd(member.costMicroUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {usage.capped && <p className="text-xs text-muted-foreground">Counts are capped at the most recent activity.</p>}
          </>
        )}
      </div>
    </section>
  );
}
