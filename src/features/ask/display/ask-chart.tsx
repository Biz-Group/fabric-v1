"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BarChart3 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { AskDisplayPart } from "../../../../convex/lib/askSchema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { chartLinkHref } from "../citation-links";

export type AskChartData = NonNullable<FunctionReturnType<typeof api.askCharts.getChart>>;

const PLOT_HEIGHT = "h-52";

const AskChartPlot = dynamic(() => import("./ask-chart-plot"), {
  ssr: false,
  loading: () => <Skeleton className={`${PLOT_HEIGHT} w-full rounded-md`} />,
});

/** The caption: scope, today's date, and whether the data moved since the answer (D56). */
export function chartCaption(data: Pick<AskChartData, "updatedAt" | "more">, answeredAt: number, today: Date): string {
  const date = today.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return [
    `Current data, ${date}`,
    data.updatedAt !== null && data.updatedAt > answeredAt ? "updated since this answer" : null,
    data.more > 0 ? `${data.more} more not shown` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ChartTable({ data, hrefFor }: { data: AskChartData; hrefFor: (index: number) => string | null }) {
  const totals = data.series.length > 1;
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-1.5 font-medium">
              {data.type === "timeline" ? "Week of" : "Name"}
            </th>
            {data.series.map((series) => (
              <th key={series.key} scope="col" className="px-2 py-1.5 text-right font-medium">
                {series.label}
              </th>
            ))}
            {totals && (
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Total
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, index) => {
            const href = hrefFor(index);
            return (
              <tr key={`${row.label}-${index}`} className="border-t">
                <th scope="row" className="px-2 py-1.5 text-left font-normal">
                  {href ? (
                    <Link href={href} className="focus-ring rounded hover:underline">
                      {row.label}
                    </Link>
                  ) : (
                    row.label
                  )}
                </th>
                {row.values.map((value, i) => (
                  <td key={i} className="px-2 py-1.5 text-right tabular-nums">
                    {value.toLocaleString()}
                  </td>
                ))}
                {totals && (
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.values.reduce((sum, n) => sum + n, 0).toLocaleString()}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A chart (FR-11.2): live data for a chart id and scope, re-authorized on
 * every view (D56). The answer's text keeps the counts it cited; the caption
 * says when the data has changed since. A table view gives the same numbers
 * to keyboard and screen-reader users, with each row linking to its source.
 */
export function AskChart({ part, answeredAt }: { part: AskDisplayPart; answeredAt: number }) {
  const data = useQuery(api.askCharts.getChart, part.chartId ? { chartId: part.chartId, scope: part.refs[0] ?? null } : "skip");
  const [asTable, setAsTable] = useState(false);
  const { appHref } = useWorkspaceRoutes();
  const router = useRouter();
  if (!part.chartId) return null;
  if (data === undefined) return <Skeleton className="h-64 w-full rounded-lg" aria-busy />;
  if (data === null || data.rows.length === 0) return null;

  const hrefFor = (index: number) => {
    const link = data.rows[index]?.link;
    return link ? chartLinkHref(link, appHref) : null;
  };
  const scope = data.scopeName === "the organization" ? "Whole organization" : data.scopeName;
  return (
    <section aria-label={`Chart: ${data.title}, ${scope}`} className="rounded-lg border bg-background p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <BarChart3 className="size-4 shrink-0 text-org-accent" aria-hidden />
            {data.title}
          </p>
          <p className="text-xs text-muted-foreground">{scope}</p>
        </div>
        <Button type="button" variant="ghost" size="xs" aria-pressed={asTable} onClick={() => setAsTable((value) => !value)}>
          {asTable ? "Show as chart" : "Show as table"}
        </Button>
      </div>
      {asTable ? (
        <ChartTable data={data} hrefFor={hrefFor} />
      ) : (
        // The plot is a picture of the table; keyboard and screen-reader users get the table.
        <div aria-hidden>
          <AskChartPlot
            data={data}
            onOpen={(index) => {
              const href = hrefFor(index);
              if (href) router.push(href);
            }}
          />
        </div>
      )}
      <p className="mt-2 text-2xs text-muted-foreground">{chartCaption(data, answeredAt, new Date())}</p>
    </section>
  );
}
