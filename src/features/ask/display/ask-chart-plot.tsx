"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { AskChartData } from "./ask-chart";

/**
 * The plot itself, loaded only when a chart appears so `/ask` doesn't carry
 * Recharts. Colours: one series takes the tenant accent (D57); several take
 * the validated categorical slots (`--series-1..3`), since an arbitrary accent
 * can't be checked against fixed partner hues for colour-vision separation.
 */

const BAR_ROW = 30;
const LABEL_CHARS = 20;

function shortLabel(label: string): string {
  return label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1)}…` : label;
}

function weekLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

/** A bar's name on one line (Recharts' default tick wraps), the full name on hover. */
function NameTick(props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) {
  const name = String(props.payload?.value ?? "");
  return (
    <text x={Number(props.x ?? 0)} y={Number(props.y ?? 0)} dy={4} dx={-4} textAnchor="end" className="fill-muted-foreground text-xs">
      <title>{name}</title>
      {shortLabel(name)}
    </text>
  );
}

export default function AskChartPlot({ data, onOpen }: { data: AskChartData; onOpen: (index: number) => void }) {
  const config: ChartConfig = Object.fromEntries(
    data.series.map((series, index) => [
      series.key,
      { label: series.label, color: data.series.length === 1 ? "var(--org-accent)" : `var(--series-${index + 1})` },
    ]),
  );
  const rows = data.rows.map((row, index) => ({
    index,
    label: row.label,
    ...Object.fromEntries(data.series.map((series, i) => [series.key, row.values[i]])),
  }));
  const last = data.series.length - 1;
  // Series order, not alphabetical (Recharts sorts by name by default).
  const legend = data.series.length > 1 ? <ChartLegend itemSorter={null} content={<ChartLegendContent />} /> : null;
  const open = (entry: unknown) => {
    const index = (entry as { payload?: { index?: number } })?.payload?.index;
    if (typeof index === "number") onOpen(index);
  };

  if (data.type === "timeline") {
    return (
      <ChartContainer config={config} className="aspect-auto h-52 w-full">
        <BarChart data={rows} margin={{ left: -16, right: 4, top: 8 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickFormatter={weekLabel} minTickGap={16} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(value) => `Week of ${weekLabel(String(value))}`} />} />
          {data.series.map((series) => (
            <Bar key={series.key} dataKey={series.key} fill={`var(--color-${series.key})`} radius={[4, 4, 0, 0]} maxBarSize={28} />
          ))}
        </BarChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: rows.length * BAR_ROW + (legend ? 56 : 24) }}>
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 8 }} accessibilityLayer={false}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={160} tick={<NameTick />} interval={0} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        {legend}
        {data.series.map((series, index) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            stackId="stack"
            fill={`var(--color-${series.key})`}
            // A 2px surface gap between stacked segments.
            stroke="var(--background)"
            strokeWidth={2}
            radius={index === last ? [0, 4, 4, 0] : 0}
            maxBarSize={20}
            className="cursor-pointer"
            onClick={open}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
