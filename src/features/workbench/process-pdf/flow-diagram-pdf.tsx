import {
  Circle,
  Path,
  Polygon,
  Rect,
  Svg,
  Text as SvgText,
  View,
  Text,
} from "@react-pdf/renderer";
import { CATEGORY_LABELS, CATEGORY_TONES, COLORS } from "./pdf-theme";
import type { ProcessPdfData, NodeBox, StepNode } from "./build-process-pdf-data";
import type { FlowNode } from "@/features/insights/insights-derivations";

// Landscape A4 content box available to the diagram (page padding + section
// header + legend already accounted for).
const MAX_W = 760;
const MAX_H = 418;

function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (maxChars <= 1) return [clean];
  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  // Truncate the final line if content overflowed the line budget.
  const consumed = lines.join(" ").length;
  if (consumed < clean.length && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] =
      last.length > maxChars - 1
        ? `${last.slice(0, Math.max(1, maxChars - 1))}…`
        : `${last}…`;
  }
  return lines;
}

function FlowNodeShape({
  box,
  node,
  number,
  scale,
}: {
  box: NodeBox;
  node: StepNode;
  number: number;
  scale: number;
}) {
  const tone = CATEGORY_TONES[node.category];
  const px = (apparent: number) => apparent / scale;

  const numberFont = px(9);
  const catFont = px(6.5);
  const titleFont = px(8);
  const titleLH = px(9.6);
  const metaFont = px(6.5);
  const innerWidth = box.width - 26;
  const charsPerLine = Math.max(
    6,
    Math.floor((innerWidth * scale) / (8 * 0.5)),
  );
  const titleLines = wrapLabel(node.label, charsPerLine, 2);

  const flags: string[] = [];
  if (node.isBottleneck) flags.push("Bottleneck");
  if (node.isTribalKnowledge) flags.push("Tribal");
  const metaText =
    flags.length > 0
      ? flags.join("  •  ")
      : node.estimatedDuration
        ? node.estimatedDuration
        : node.actors[0] ?? "";

  return (
    <>
      {/* Card */}
      <Rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={px(7)}
        ry={px(7)}
        fill={COLORS.white}
        stroke={COLORS.hair}
        strokeWidth={px(0.9)}
      />
      {/* Left accent bar */}
      <Rect
        x={box.x}
        y={box.y + px(8)}
        width={px(4.5)}
        height={box.height - px(16)}
        fill={tone.base}
      />
      {/* Number medallion */}
      <Circle
        cx={box.x + px(20)}
        cy={box.y + px(20)}
        r={px(11)}
        fill={tone.soft}
        stroke={tone.base}
        strokeWidth={px(0.9)}
      />
      <SvgText
        x={box.x + px(20)}
        y={box.y + px(23.2)}
        fill={tone.text}
        textAnchor="middle"
        style={{ fontFamily: "Helvetica-Bold", fontSize: numberFont }}
      >
        {String(number)}
      </SvgText>
      {/* Category eyebrow */}
      <SvgText
        x={box.x + px(36)}
        y={box.y + px(18)}
        fill={tone.text}
        style={{ fontFamily: "Helvetica-Bold", fontSize: catFont }}
      >
        {CATEGORY_LABELS[node.category].toUpperCase()}
      </SvgText>
      {/* Title (up to two lines) */}
      {titleLines.map((line, i) => (
        <SvgText
          key={i}
          x={box.x + px(13)}
          y={box.y + px(40) + i * titleLH}
          fill={COLORS.ink}
          style={{ fontFamily: "Helvetica-Bold", fontSize: titleFont }}
        >
          {line}
        </SvgText>
      ))}
      {/* Meta line */}
      {metaText ? (
        <SvgText
          x={box.x + px(13)}
          y={box.y + box.height - px(11)}
          fill={node.isBottleneck ? COLORS.danger : COLORS.muted}
          style={{ fontFamily: "Helvetica", fontSize: metaFont }}
        >
          {wrapLabel(metaText, charsPerLine, 1)[0]}
        </SvgText>
      ) : null}
    </>
  );
}

function FlowEdgeShape({
  source,
  target,
  isHappyPath,
  label,
  scale,
}: {
  source: NodeBox;
  target: NodeBox;
  isHappyPath: boolean;
  label?: string;
  scale: number;
}) {
  const px = (apparent: number) => apparent / scale;
  const sx = source.x + source.width;
  const sy = source.y + source.height / 2;
  const tx = target.x;
  const ty = target.y + target.height / 2;
  const dx = Math.max(px(24), Math.abs(tx - sx) * 0.5);

  const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
  const stroke = isHappyPath ? COLORS.muted : COLORS.faint;
  const arrow = px(7);

  return (
    <>
      <Path
        d={d}
        stroke={stroke}
        strokeWidth={isHappyPath ? px(1.7) : px(1.3)}
        strokeOpacity={isHappyPath ? 0.75 : 0.55}
        fill="none"
        strokeDasharray={isHappyPath ? undefined : `${px(4.5)} ${px(3.5)}`}
      />
      <Polygon
        points={`${tx},${ty} ${tx - arrow},${ty - arrow * 0.6} ${tx - arrow},${ty + arrow * 0.6}`}
        fill={stroke}
        fillOpacity={isHappyPath ? 0.85 : 0.6}
      />
      {label ? (
        <SvgText
          x={(sx + tx) / 2}
          y={(sy + ty) / 2 - px(2)}
          fill={COLORS.muted}
          textAnchor="middle"
          style={{ fontFamily: "Helvetica", fontSize: px(6.5) }}
        >
          {label.length > 26 ? `${label.slice(0, 25)}…` : label}
        </SvgText>
      ) : null}
    </>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginRight: 12 }}>
      <View
        style={{
          width: 9,
          height: 9,
          borderRadius: 2.5,
          backgroundColor: color,
          marginRight: 4,
        }}
      />
      <Text style={{ fontSize: 7.5, color: COLORS.muted }}>{label}</Text>
    </View>
  );
}

export function FlowDiagramPdf({ data }: { data: ProcessPdfData }) {
  const { layout, graphWidth, graphHeight, edges, nodeNumber, steps } = data;
  const boxById = new Map<string, NodeBox>(layout.map((b) => [b.id, b]));
  const stepById = new Map<string, StepNode>(steps.map((s) => [s.id, s]));

  const scale = Math.min(MAX_W / graphWidth, MAX_H / graphHeight, 1);
  const svgW = graphWidth * scale;
  const svgH = graphHeight * scale;

  const usedCategories = Array.from(
    new Set(steps.map((s) => s.category)),
  ) as FlowNode["category"][];
  const hasException = edges.some((e) => !e.isHappyPath);

  return (
    <View>
      <View style={{ alignItems: "center" }}>
        <Svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${graphWidth} ${graphHeight}`}
        >
          {/* Edges first so nodes paint on top */}
          {edges.map((edge) => {
            const source = boxById.get(edge.source);
            const target = boxById.get(edge.target);
            if (!source || !target) return null;
            return (
              <FlowEdgeShape
                key={edge.id}
                source={source}
                target={target}
                isHappyPath={edge.isHappyPath}
                label={edge.label}
                scale={scale}
              />
            );
          })}
          {layout.map((box) => {
            const node = stepById.get(box.id);
            if (!node) return null;
            return (
              <FlowNodeShape
                key={box.id}
                box={box}
                node={node}
                number={nodeNumber[box.id] ?? 0}
                scale={scale}
              />
            );
          })}
        </Svg>
      </View>

      {/* Legend */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 12,
          paddingTop: 8,
          borderTopWidth: 1,
          borderTopColor: COLORS.hair,
        }}
      >
        {usedCategories.map((category) => (
          <LegendSwatch
            key={category}
            color={CATEGORY_TONES[category].base}
            label={CATEGORY_LABELS[category]}
          />
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", marginRight: 12 }}>
          <View
            style={{
              width: 14,
              height: 0,
              borderTopWidth: 1.6,
              borderTopColor: COLORS.muted,
              marginRight: 4,
            }}
          />
          <Text style={{ fontSize: 7.5, color: COLORS.muted }}>Happy path</Text>
        </View>
        {hasException && (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 14,
                height: 0,
                borderTopWidth: 1.3,
                borderTopColor: COLORS.faint,
                borderStyle: "dashed",
                marginRight: 4,
              }}
            />
            <Text style={{ fontSize: 7.5, color: COLORS.muted }}>
              Exception path
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
