import { Svg, Line, Polygon, Text, View } from "@react-pdf/renderer";
import { CATEGORY_LABELS, CATEGORY_TONES, COLORS } from "./pdf-theme";
import type { ProcessPdfData, StepNode } from "./build-process-pdf-data";
import type { FlowEdge, FlowNode } from "@/features/insights/insights-derivations";

// The flow is rendered as a clean vertical flowchart: full-width, legible node
// cards connected by arrows, with branches/exceptions annotated. Unlike a
// fit-to-page node-link diagram (illegible for large processes in a
// non-zoomable PDF), this stays readable at any node count and paginates.

const COLUMN_WIDTH = 384;

function Medallion({ number, category }: { number: number; category: FlowNode["category"] }) {
  const tone = CATEGORY_TONES[category];
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: tone.soft,
        borderWidth: 1.2,
        borderColor: tone.base,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontFamily: "Helvetica-Bold",
          fontSize: 11,
          lineHeight: 1,
          color: tone.text,
        }}
      >
        {number}
      </Text>
    </View>
  );
}

function MiniChip({
  label,
  tone,
}: {
  label: string;
  tone: { soft: string; text: string };
}) {
  return (
    <Text
      style={{
        backgroundColor: tone.soft,
        color: tone.text,
        borderRadius: 8,
        paddingVertical: 1.5,
        paddingHorizontal: 5,
        fontSize: 7,
        fontFamily: "Helvetica-Bold",
        lineHeight: 1,
      }}
    >
      {label}
    </Text>
  );
}

function Connector({ isHappyPath }: { isHappyPath: boolean }) {
  const color = isHappyPath ? COLORS.muted : COLORS.faint;
  return (
    <View style={{ width: COLUMN_WIDTH, alignItems: "center" }}>
      <Svg width={14} height={15}>
        <Line
          x1={7}
          y1={0}
          x2={7}
          y2={10}
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray={isHappyPath ? undefined : "2 2"}
        />
        <Polygon points="7,15 3,9 11,9" fill={color} />
      </Svg>
    </View>
  );
}

function BranchRow({
  edge,
  data,
}: {
  edge: FlowEdge;
  data: ProcessPdfData;
}) {
  const targetNum = data.nodeNumber[edge.target];
  const targetLabel =
    data.steps.find((s) => s.id === edge.target)?.label ?? edge.target;
  const dot = edge.isHappyPath ? COLORS.accent : "#d97706";
  return (
    <Text
      style={{
        fontSize: 7.8,
        color: COLORS.muted,
        lineHeight: 1.4,
        marginTop: 2,
      }}
    >
      <Text style={{ color: dot, fontFamily: "Helvetica-Bold" }}>{"•  "}</Text>
      {edge.label ? `${edge.label} ` : ""}
      <Text style={{ color: COLORS.faint }}>to </Text>
      <Text style={{ fontFamily: "Helvetica-Bold", color: COLORS.body }}>
        {targetNum ? `#${targetNum} ` : ""}
        {targetLabel}
      </Text>
      {edge.isHappyPath ? "" : "  · exception"}
    </Text>
  );
}

function NodeCard({
  step,
  data,
  nextId,
}: {
  step: StepNode;
  data: ProcessPdfData;
  nextId: string | null;
}) {
  const tone = CATEGORY_TONES[step.category];
  // Branches = outgoing edges other than the one represented by the connector
  // to the next card in reading order.
  const branches = data.edges.filter(
    (e) => e.source === step.id && e.target !== nextId,
  );

  return (
    <View
      style={{
        width: COLUMN_WIDTH,
        borderWidth: 1,
        borderColor: COLORS.hair,
        borderLeftWidth: 3,
        borderLeftColor: tone.base,
        borderRadius: 7,
        backgroundColor: COLORS.white,
        paddingVertical: 8,
        paddingHorizontal: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Medallion number={step.number} category={step.category} />
        <View style={{ flex: 1, marginLeft: 9 }}>
          <Text
            style={{ fontFamily: "Helvetica-Bold", fontSize: 10.5, color: COLORS.ink }}
          >
            {step.label}
          </Text>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 4,
              marginTop: 3,
            }}
          >
            <MiniChip label={CATEGORY_LABELS[step.category]} tone={tone} />
            {step.isBottleneck && (
              <MiniChip
                label="Bottleneck"
                tone={{ soft: "#fef2f2", text: "#b91c1c" }}
              />
            )}
            {step.isTribalKnowledge && (
              <MiniChip
                label="Tribal"
                tone={{ soft: "#fffbeb", text: "#b45309" }}
              />
            )}
            {step.automationPotential === "high" && (
              <MiniChip
                label="Automatable"
                tone={{ soft: "#ecfdf5", text: "#047857" }}
              />
            )}
            {step.estimatedDuration ? (
              <MiniChip
                label={step.estimatedDuration}
                tone={{ soft: COLORS.surfaceAlt, text: COLORS.muted }}
              />
            ) : null}
          </View>
        </View>
      </View>
      {branches.length > 0 && (
        <View style={{ marginTop: 5, paddingLeft: 35 }}>
          {branches.map((edge) => (
            <BranchRow key={edge.id} edge={edge} data={data} />
          ))}
        </View>
      )}
    </View>
  );
}

export function FlowDiagramPdf({ data }: { data: ProcessPdfData }) {
  const { steps } = data;

  return (
    <View style={{ alignItems: "center" }}>
      {steps.map((step, i) => {
        const next = steps[i + 1] ?? null;
        const nextId = next?.id ?? null;
        // Draw a connector to the next card only when a real edge links them,
        // so the spine reflects the actual flow rather than mere adjacency.
        const linkingEdge = next
          ? data.edges.find((e) => e.source === step.id && e.target === next.id)
          : undefined;
        return (
          <View key={step.id} style={{ alignItems: "center" }}>
            <NodeCard step={step} data={data} nextId={nextId} />
            {next && (
              <View style={{ marginVertical: 2 }}>
                {linkingEdge ? (
                  <Connector isHappyPath={linkingEdge.isHappyPath} />
                ) : (
                  // No direct edge: small gap marker so the break reads as
                  // "continues below" rather than a missing link.
                  <View style={{ height: 8 }} />
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
