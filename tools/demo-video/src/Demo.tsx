import React from "react";
import { AbsoluteFill, Easing, Html5Audio, Img, Sequence, spring, staticFile, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import manifest from "../public/cap/manifest.json";
import { FPS, ORDER, SCENES, TOTAL_SECONDS, w } from "./timeline";

const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });

// Brand palette (BRANDING_KIT.md)
const C = {
  ink: "#11161C",
  steel: "#5A6878",
  mist: "#D8E1E8",
  paper: "#F7F5F0",
  cloud: "#FCFBF8",
  blue: "#356DFF",
  cyan: "#8EDBE8",
};

type Box = { x: number; y: number; w: number; h: number };
type Screen = { at: number; still?: string; seq?: keyof typeof manifest.sequences; dur?: number };
type Cam = { at: number; x: number; y: number; s: number; dur?: number };
// curve: overrides the cursor's spring, e.g. to drag in step with a captured sequence.
type Cur = { at: number; x: number; y: number; click?: boolean; dur?: number; hide?: boolean; curve?: (p: number) => number };
// ring: outline only, for a small target inside a larger focused one.
type Hl = { from: number; to: number; box: Box; pad?: number; ring?: boolean };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// Camera: gentle start, long settle. A raw spring starts too abruptly for a calm camera.
const glide = Easing.bezier(0.45, 0, 0.15, 1);
// Cursor: a critically damped spring, quick off the mark and easing into the target like a hand.
const flick = (p: number) => spring({ frame: p * 30, fps: 30, config: { damping: 20, stiffness: 100 }, durationInFrames: 30 });
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const S = SCENES;
const BASE = 0.9; // app window scale when the camera is at rest

// ---------------------------------------------------------------------------
// Element boxes (CSS px in the 1920x1080 app), measured from the live DOM by capture.mjs
const st = manifest.states as Record<string, Record<string, Box | null>>;
const tree = st.home.tree!;
const palette = st["cmdk-empty"].palette!;
const B = {
  learning: st.home.learning!,
  pm: st.learning.pm!,
  pmflow: st.dept.pmflow!,
  // The tree's items plus its "Process Tree" header.
  treePanel: { x: tree.x - 4, y: 72, w: tree.w + 8, h: tree.y + tree.h - 66 },
  // The whole result row, not just its label.
  cmdkResult: { x: palette.x + 8, y: st.cmdk.result!.y - 9, w: palette.w - 16, h: 38 },
  interview: st.proc.interview!,
  voice: st.proc.voice!,
  upload: st.proc.upload!,
  tabOverview: st.proc.tabOverview!,
  tabContributions: st.proc.tabContributions!,
  tabFlow: st.proc.tabFlow!,
  tabInsights: st.proc.tabInsights!,
  tabRecommendations: st.proc.tabRecommendations!,
  player: st.conv.player!,
  summary: st.conv.summary!,
  facts: st.ov.facts!,
  ovSummary: st.ov.summary!,
  agreements: st["ov-evidence"].agreements!,
  // The column runs to the bottom of the page; hold the focus on its first entry.
  tensions: { ...st["ov-evidence"].tensions!, h: 252 },
  corroborated: st["ov-evidence"].corroborated!,
  sources: st["ov-evidence"].sources!,
  flowNode: st["flow-panned"].flowNode!,
  bottleneckTag: st["flow-panned"].bottleneckTag!,
  bottleneckStat: st["flow-panned"].stats!,
  findings: st.insights.findings!,
  cardSteps: st.insights.steps!,
  cardHandoffs: st.insights.handoffs!,
  cardTools: st.insights.tools!,
  cardDecisions: st.insights.decisions!,
  cardBottlenecks: st.insights.bottlenecks!,
  recList: st.recs.list!,
  recRow: st.recs.row!,
  recFollowOn: st.recs.followOn!,
  recValue: st.recs.value!,
  recEffort: st.recs.effort!,
  recEvidence: st.recs.evidence!,
  tryIt: st["recs-plan"].tryIt!,
  plan: st["recs-plan"].plan!,
  copy: st["recs-plan"].copy!,
};

// ---------------------------------------------------------------------------
// Timeline (absolute seconds). Clicks land on the word that names the control.
const CLICK = 0.75; // cursor travel time
const HOVER = 0.3; // a control shows its hover state this long before the click lands
const tabClick = (scene: keyof typeof S) => S[scene].start + 0.15 + CLICK;

const tTreeClick1 = w("tree", "Click to expand") + 0.15;
const tTreeClick2 = w("tree", "any branch", "end") + 0.15;
const tCtrlK = w("tree", "Control K");
const tTyped = w("tree", "jump straight") + 0.2;
const tResultClick = S.capture.start + 0.2;
const tInterviewClick = w("capture", "AI interview", "end") + 0.1;
const tSolo = w("capture", "Prefer to go solo");
const tFacts = w("overview", "the key facts");
const tStory = w("overview", "the full story");
const tScrollOv = w("overview", "Further down") - 0.1;
const tAgree = w("overview", "agree");
const tPanStart = w("flow", "every step");
const tBottlenecks = w("flow", "Bottlenecks");
const panDur = Math.max(2, tBottlenecks - tPanStart - 0.35);
const tFindings = w("insights", "key findings");
const tNumbers = w("insights", "rolls everything up");
const tRecList = w("recommendations", "practical fixes");
const tRule = w("recommendations", "a clear handover");
const tWorkflow = w("recommendations", "a new workflow");
const tRanked = w("recommendations", "ranked by value");
const tBacked = w("recommendations", "backed by");
const tScrollRecs = w("recommendations", "Every recommendation") - 0.1;
const tPilot = w("recommendations", "small pilot");
const tPlan = w("recommendations", "a change plan");
const tCopyClick = w("recommendations", "copy and share") + 0.15;
const tEndCard = w("outro", "We'll take care") - 0.15;

// "PM Fl" appears one keystroke at a time, the last still being the palette with its result.
const typed = (manifest as { typed?: number }).typed ?? 5;
const keyTimes = Array.from({ length: typed }, (_, i) => tCtrlK + 0.4 + (i * (tTyped - tCtrlK - 0.4)) / (typed - 1));

const screens: Screen[] = [
  { at: 0, still: "home" },
  { at: tTreeClick1 - HOVER, still: "home-hover" },
  { at: tTreeClick1 + 0.15, still: "learning" },
  { at: tTreeClick2 - HOVER, still: "learning-hover" },
  { at: tTreeClick2 + 0.15, still: "dept" },
  { at: tCtrlK + 0.1, still: "cmdk-empty" },
  ...keyTimes.map((at, i) => ({ at, still: i === typed - 1 ? "cmdk" : `cmdk-${i + 1}` })),
  { at: tResultClick + 0.15, still: "proc" },
  { at: tInterviewClick - HOVER, still: "proc-hover-interview" },
  { at: tInterviewClick + 0.15, still: "modal" },
  { at: tSolo - 0.1, still: "proc" },
  { at: tabClick("contributions") - HOVER, still: "proc-hover-contributions" },
  { at: tabClick("contributions") + 0.15, still: "conv" },
  { at: w("contributions", "full transcript"), seq: "conv_scroll", dur: 1.6 },
  { at: tabClick("overview") - HOVER, still: "conv-hover-overview" },
  { at: tabClick("overview") + 0.15, still: "ov" },
  { at: tScrollOv, seq: "ov_scroll", dur: Math.max(1.6, tAgree - tScrollOv - 0.15) },
  { at: tAgree - 0.1, still: "ov-evidence" },
  { at: tabClick("flow") - HOVER, still: "ov-hover-flow" },
  { at: tabClick("flow") + 0.15, still: "flow" },
  { at: tPanStart, seq: "flow_pan", dur: panDur },
  { at: tBottlenecks - 0.3, still: "flow-panned" },
  { at: tabClick("insights") - HOVER, still: "flow-hover-insights" },
  { at: tabClick("insights") + 0.15, still: "insights" },
  { at: tabClick("recommendations") - HOVER, still: "insights-hover-recommendations" },
  { at: tabClick("recommendations") + 0.15, still: "recs" },
  { at: tScrollRecs, seq: "recs_scroll", dur: Math.max(1.2, tPilot - tScrollRecs - 0.15) },
  { at: tPilot - 0.1, still: "recs-plan" },
  { at: tCopyClick - HOVER, still: "recs-hover-copy" },
  { at: tCopyClick + 0.1, still: "recs-copied" },
  { at: S.outro.start + 0.1, still: "proc" },
  { at: w("outro", "hit Start") + 0.45, still: "proc-hover-interview" },
];

const REST = { x: 960, y: 540, s: 1 };
const cams: Cam[] = [
  { at: 0, ...REST, dur: 0.01 },
  { at: w("tree", "On the left"), x: 430, y: 330, s: 1.5 },
  { at: tCtrlK - 0.1, x: 960, y: 330, s: 1.3 },
  { at: S.capture.start + 0.1, ...REST },
  { at: w("capture", "Hit Start") - 0.2, x: 1500, y: 170, s: 1.7 },
  { at: tInterviewClick + 0.15, x: 960, y: 540, s: 1.4 },
  { at: tSolo - 0.1, x: 1500, y: 170, s: 1.7 },
  { at: S.contributions.start, ...REST },
  { at: w("contributions", "with the audio") - 0.2, x: 1590, y: 470, s: 1.55 },
  { at: S.overview.start, ...REST },
  { at: tFacts - 0.3, ...center(B.facts), s: 1.4 },
  { at: tStory - 0.2, ...center(B.ovSummary), s: 1.35 },
  { at: tScrollOv - 0.3, ...REST, dur: 0.5 },
  { at: tAgree, x: 1270, y: 560, s: 1.3 },
  { at: w("overview", "which sources"), x: 1010, y: 500, s: 1.6 },
  { at: w("overview", "The more people"), ...REST, dur: 1.2 },
  { at: S.flow.start, ...REST },
  { at: tBottlenecks - 0.2, x: 1000, y: 700, s: 1.8 },
  { at: w("flow", "spot the friction"), x: 980, y: 900, s: 1.5 },
  { at: S.insights.start, ...REST },
  { at: tFindings - 0.2, ...center(B.findings), s: 1.35 },
  { at: tNumbers - 0.2, x: 1266, y: 700, s: 1.4 },
  { at: S.recommendations.start, ...REST },
  { at: tRecList - 0.3, x: 900, y: 560, s: 1.35 },
  { at: tRanked - 0.3, x: 1420, y: 400, s: 1.5 },
  { at: tScrollRecs - 0.3, ...REST, dur: 0.5 },
  { at: tPilot - 0.2, x: 1340, y: 330, s: 1.45 },
  { at: tPlan - 0.2, x: 1340, y: 900, s: 1.5 },
  { at: S.outro.start, ...REST },
  { at: w("outro", "hit Start") - 0.3, x: 1330, y: 160, s: 2 },
];

const at = (b: Box) => center(b);
// The flow is panned by dragging from here, as capture.mjs did.
const flowCanvas = st.flow.canvas!;
const drag = { x: flowCanvas.x + flowCanvas.w * 0.75, y: flowCanvas.y + flowCanvas.h * 0.25 };
const cursor: Cur[] = [
  { at: 0, x: 1100, y: 700, hide: true },
  { at: w("tree", "functions") - 0.4, ...at(B.learning), hide: false, dur: 0.01 },
  { at: tTreeClick1 - CLICK, ...at(B.learning), click: true },
  { at: tTreeClick2 - CLICK, ...at(B.pm), click: true },
  { at: tTreeClick2 + 0.5, ...at(B.pmflow) },
  { at: tTyped + 0.2, ...at(B.cmdkResult) },
  { at: tResultClick - CLICK, ...at(B.cmdkResult), click: true },
  { at: tInterviewClick - CLICK, ...at(B.interview), click: true },
  { at: tSolo, ...at(B.voice) },
  { at: w("capture", "upload a recording") - 0.3, ...at(B.upload) },
  { at: tabClick("contributions") - CLICK, ...at(B.tabContributions), click: true },
  { at: w("contributions", "the audio") - 0.3, x: 1340, y: 400 },
  { at: tabClick("overview") - CLICK, ...at(B.tabOverview), click: true },
  { at: tabClick("overview") + 0.4, x: 1700, y: 700 },
  { at: tabClick("flow") - CLICK, ...at(B.tabFlow), click: true },
  { at: tPanStart - 0.5, ...drag },
  { at: tPanStart - 0.05, ...drag, dur: 0.05, click: true },
  // Drag the canvas: the pointer travels with the frames, on the same curve.
  { at: tPanStart, x: drag.x - 1500, y: drag.y, dur: panDur, curve: ease },
  { at: tBottlenecks - 0.6, x: 1120, y: 770, dur: 0.6 },
  { at: tabClick("insights") - CLICK, ...at(B.tabInsights), click: true },
  { at: tabClick("insights") + 0.4, x: 1300, y: 880 },
  { at: tabClick("recommendations") - CLICK, ...at(B.tabRecommendations), click: true },
  { at: tRule - 0.4, x: B.recRow.x + B.recRow.w - 40, y: center(B.recRow).y },
  { at: tWorkflow - 0.4, x: B.recFollowOn.x + B.recFollowOn.w - 40, y: center(B.recFollowOn).y },
  { at: tRanked - 0.3, x: 1420, y: 470 },
  { at: tCopyClick - CLICK, ...at(B.copy), click: true },
  { at: S.outro.start + 0.2, x: 1100, y: 600 },
  { at: w("outro", "hit Start") - 0.2, ...at(B.interview) },
  { at: tEndCard, ...at(B.interview), hide: true },
];

const highlights: Hl[] = [
  { from: w("tree", "Process Tree"), to: tTreeClick1 - CLICK, box: B.treePanel, pad: 4 },
  { from: tTyped, to: tResultClick, box: B.cmdkResult, pad: 2 },
  { from: w("capture", "Hit Start") + 0.2, to: tInterviewClick, box: B.interview },
  { from: tSolo + 0.6, to: w("capture", "upload a recording") - 0.1, box: B.voice },
  { from: w("capture", "upload a recording") + 0.4, to: S.capture.end, box: B.upload },
  { from: w("contributions", "the audio"), to: w("contributions", "an AI summary"), box: B.player },
  { from: w("contributions", "an AI summary"), to: w("contributions", "full transcript"), box: B.summary },
  { from: tFacts, to: tStory - 0.1, box: B.facts },
  { from: tStory - 0.1, to: tScrollOv - 0.2, box: B.ovSummary },
  { from: tAgree, to: w("overview", "differ") - 0.1, box: B.agreements },
  { from: w("overview", "differ") - 0.1, to: w("overview", "which sources") - 0.1, box: B.tensions },
  { from: w("overview", "which sources"), to: w("overview", "The more people"), box: B.corroborated },
  { from: w("overview", "which sources") + 0.2, to: w("overview", "The more people"), box: B.sources },
  { from: tBottlenecks, to: w("flow", "spot the friction"), box: B.bottleneckTag, ring: true },
  { from: tBottlenecks, to: w("flow", "spot the friction"), box: B.flowNode, pad: 6 },
  { from: w("flow", "spot the friction"), to: S.flow.end, box: B.bottleneckStat },
  { from: tFindings, to: tNumbers - 0.1, box: B.findings },
  { from: w("insights", "steps"), to: w("insights", "handoffs"), box: B.cardSteps },
  { from: w("insights", "handoffs"), to: w("insights", "tools"), box: B.cardHandoffs },
  { from: w("insights", "tools"), to: w("insights", "decisions"), box: B.cardTools },
  { from: w("insights", "decisions"), to: w("insights", "and bottlenecks"), box: B.cardDecisions },
  { from: w("insights", "and bottlenecks"), to: w("insights", "the evidence", "end"), box: B.cardBottlenecks },
  { from: tRecList, to: tRule - 0.1, box: B.recList, pad: 0 },
  { from: tRule - 0.1, to: tWorkflow - 0.1, box: B.recRow, pad: 2 },
  { from: tWorkflow - 0.1, to: tRanked - 0.1, box: B.recFollowOn, pad: 2 },
  { from: tRanked, to: tBacked - 0.1, box: B.recValue },
  { from: tRanked + 0.25, to: tBacked - 0.1, box: B.recEffort },
  { from: tBacked - 0.1, to: tScrollRecs - 0.2, box: B.recEvidence },
  { from: tPilot, to: tPlan - 0.1, box: B.tryIt },
  { from: tPlan, to: S.recommendations.end, box: B.plan },
  { from: w("outro", "hit Start"), to: tEndCard + 0.3, box: B.interview },
];

const CHAPTERS: { scene: keyof typeof S; label: string }[] = [
  { scene: "tree", label: "Navigate" },
  { scene: "capture", label: "Capture" },
  { scene: "contributions", label: "Contributions" },
  { scene: "overview", label: "Overview" },
  { scene: "flow", label: "Process Flow" },
  { scene: "insights", label: "Insights" },
  { scene: "recommendations", label: "Recommendations" },
];

// ---------------------------------------------------------------------------
function keyframed<T extends { at: number; dur?: number; curve?: (p: number) => number }>(
  list: T[],
  t: number,
  pick: (k: T) => number[],
  defaultDur: number,
  curve: (p: number) => number,
): number[] {
  let v = pick(list[0]);
  for (const k of list) {
    if (k.at > t) break;
    const p = (k.curve ?? curve)(clamp01((t - k.at) / (k.dur ?? defaultDur)));
    const to = pick(k);
    v = v.map((a, i) => a + (to[i] - a) * p);
  }
  return v;
}

function camera(t: number) {
  // Zoom is interpolated in log space so a zoom feels even rather than rushing at the end.
  const [x0, y0, ls] = keyframed(cams, t, (k) => [k.x, k.y, Math.log(k.s)], 0.9, glide);
  const k = BASE * Math.exp(ls);
  const clamp = (v: number, half: number, size: number) =>
    k <= 1 ? size / 2 + (v - size / 2) * 0 : Math.min(size - half / k, Math.max(half / k, v));
  return { x: clamp(x0, 960, 1920), y: clamp(y0, 540, 1080), k };
}

// Where the app window sits on screen at time t (the camera plus the intro hand-off).
function view(t: number) {
  const { x, y, k } = camera(t);
  const appIn = ease(clamp01((t - (S.tree.start - 0.9)) / 1.1));
  return { x, y, k, appIn, scale: k * (0.78 + 0.22 * appIn), dy: (1 - appIn) * 120 };
}

function cursorAt(t: number) {
  const [x, y] = keyframed(cursor, t, (c) => [c.x, c.y], CLICK, flick);
  // Bow each move slightly, as a wrist would, instead of travelling in a ruler-straight line.
  const k = cursor.findLast((c) => c.at <= t);
  const i = k ? cursor.indexOf(k) : -1;
  if (i <= 0 || k!.curve) return { x, y };
  const p = clamp01((t - k!.at) / (k!.dur ?? CLICK));
  const [fx, fy] = keyframed(cursor, k!.at, (c) => [c.x, c.y], CLICK, flick);
  const bow = 0.08 * Math.sin(Math.PI * p);
  return { x: x - (k!.y - fy) * bow, y: y + (k!.x - fx) * bow };
}


const AppScreen: React.FC<{ t: number }> = ({ t }) => {
  const idx = screens.findLastIndex((s) => s.at <= t);
  const layers = [screens[Math.max(0, idx - 1)], screens[Math.max(0, idx)]];
  const srcOf = (s: Screen) => {
    if (s.still) return `cap/${s.still}.jpg`;
    const frames = manifest.sequences[s.seq!];
    const p = ease(clamp01((t - s.at) / (s.dur ?? 1)));
    return frames[Math.round(p * (frames.length - 1))];
  };
  const fade = clamp01((t - layers[1].at) / (layers[1].seq ? 0.12 : 0.22));
  return (
    <>
      {layers.map((s, i) => (
        <Img
          key={i}
          src={staticFile(srcOf(s))}
          style={{ position: "absolute", inset: 0, width: 1920, height: 1080, opacity: i === 0 ? 1 : fade }}
        />
      ))}
    </>
  );
};

const hlOpacity = (t: number, h: Hl) => ease(Math.min(clamp01((t - h.from) / 0.35), clamp01((h.to - t) / 0.35)));

// How far the rest of the screen recedes. Highlights that hand straight over to the next
// are merged into one span, so the page stays receded across the hand-over instead of
// sharpening for a frame between them.
const focusSpans = highlights
  .filter((h) => !h.ring)
  .map((h) => [h.from, h.to])
  .sort((a, b) => a[0] - b[0])
  .reduce<number[][]>((spans, [from, to]) => {
    const last = spans.at(-1);
    if (last && from <= last[1] + 0.4) last[1] = Math.max(last[1], to);
    else spans.push([from, to]);
    return spans;
  }, []);
// Released over half a second: the blur reads as sharp well before it reaches zero, so a
// shorter release looks like a blink.
const focusDepth = (t: number) =>
  Math.max(0, ...focusSpans.map(([from, to]) => ease(Math.min(clamp01((t - from) / 0.35), clamp01((to - t) / 0.5)))));

// Depth of field: the target is a sharp copy of the screen, clipped to its box and lifted
// slightly off a blurred, washed-out page.
const Focus: React.FC<{ t: number; h: Hl }> = ({ t, h }) => {
  const o = hlOpacity(t, h);
  if (o <= 0) return null;
  const pad = h.pad ?? 6;
  const x = Math.max(0, h.box.x - pad), y = Math.max(0, h.box.y - pad);
  const r = { x, y, w: Math.min(1920, h.box.x + h.box.w + pad) - x, h: Math.min(1080, h.box.y + h.box.h + pad) - y };
  if (h.ring) {
    return (
      <div
        style={{
          position: "absolute",
          left: r.x,
          top: r.y,
          width: r.w,
          height: r.h,
          borderRadius: 8,
          boxShadow: `0 0 0 2px rgba(53,109,255,${0.8 * o}), 0 0 0 6px rgba(53,109,255,${0.12 * o})`,
        }}
      />
    );
  }
  return (
    <div
      style={{
        position: "absolute",
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
        // Fades into the blurred page as it hands over, rather than popping out.
        opacity: Math.min(1, o * 3),
        transform: `scale(${1 + 0.012 * o})`,
        boxShadow: `0 ${16 * o}px ${44 * o}px rgba(17,22,28,${0.16 * o}), 0 0 0 1.5px rgba(53,109,255,${0.5 * o}), 0 0 0 ${6 * o}px rgba(53,109,255,${0.08 * o})`,
      }}
    >
      <div style={{ position: "absolute", left: -r.x, top: -r.y, width: 1920, height: 1080 }}>
        <AppScreen t={t} />
      </div>
    </div>
  );
};

const Cursor: React.FC<{ t: number; k: number }> = ({ t, k }) => {
  const { x, y } = cursorAt(t);
  const visible = cursor.findLast((c) => c.at <= t && c.hide !== undefined)?.hide === false;
  const prev = cursor.findLast((c) => c.at <= t && c.hide !== undefined);
  const o = visible ? clamp01((t - (prev?.at ?? 0)) / 0.3) : 1 - clamp01((t - (prev?.at ?? 0)) / 0.3);
  // Click: on arrival, press + ripple
  const clicks = cursor.filter((c) => c.click).map((c) => c.at + (c.dur ?? CLICK));
  const tc = clicks.findLast((c) => c <= t + 0.05);
  const since = tc === undefined ? 99 : t - tc;
  const press = since > -0.05 && since < 0.18 ? 0.82 : 1;
  const size = 1 / Math.sqrt(k);
  if (o <= 0) return null;
  return (
    <>
      {since >= 0 && since < 0.55 && (
        <div
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: 70 * size,
            height: 70 * size,
            marginLeft: -35 * size,
            marginTop: -35 * size,
            borderRadius: "50%",
            background: "rgba(53,109,255,0.28)",
            transform: `scale(${0.2 + since * 1.6})`,
            opacity: 1 - since / 0.55,
          }}
        />
      )}
      <svg
        width={26}
        height={34}
        viewBox="0 0 26 34"
        style={{
          position: "absolute",
          left: x - 3 * size,
          top: y - 2 * size,
          opacity: o,
          transform: `scale(${press * size * 1.25})`,
          transformOrigin: "3px 2px",
          filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))",
        }}
      >
        <path d="M3 2 L3 26 L9.5 20 L14 31 L18.5 29 L14 18.5 L23 18.5 Z" fill={C.ink} stroke="#fff" strokeWidth={2} strokeLinejoin="round" />
      </svg>
    </>
  );
};

const Keycaps: React.FC<{ t: number }> = ({ t }) => {
  const o = Math.min(clamp01((t - tCtrlK + 0.1) / 0.2), clamp01((tTyped + 0.6 - t) / 0.3));
  if (o <= 0) return null;
  const cap: React.CSSProperties = {
    padding: "14px 24px",
    borderRadius: 14,
    background: "#fff",
    border: `1px solid ${C.mist}`,
    borderBottomWidth: 5,
    fontSize: 34,
    fontWeight: 600,
    color: C.ink,
    boxShadow: "0 12px 30px rgba(17,22,28,0.18)",
  };
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 830, display: "flex", justifyContent: "center", gap: 14, opacity: o, transform: `translateY(${(1 - o) * 16}px)` }}>
      <span style={cap}>Ctrl</span>
      <span style={{ ...cap, background: "transparent", border: "none", boxShadow: "none", padding: "14px 0" }}>+</span>
      <span style={cap}>K</span>
    </div>
  );
};

const ChapterBar: React.FC<{ t: number }> = ({ t }) => {
  const o = Math.min(clamp01((t - S.tree.start - 0.4) / 0.4), clamp01((S.outro.start + 0.4 - t) / 0.4));
  if (o <= 0) return null;
  // Switch chapters when the tab is clicked, not when the narration moves on.
  const active = CHAPTERS.findLastIndex((c) => (c.scene === "tree" ? S.tree.start : S[c.scene].start + 0.15 + CLICK) <= t);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, display: "flex", justifyContent: "center", opacity: o }}>
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 5,
          borderRadius: 999,
          background: "rgba(252,251,248,0.92)",
          border: `1px solid ${C.mist}`,
          boxShadow: "0 8px 24px rgba(17,22,28,0.12)",
        }}
      >
        {CHAPTERS.map((c, i) => (
          <div
            key={c.label}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              fontSize: 15,
              fontWeight: i === active ? 600 : 500,
              color: i === active ? "#fff" : i < active ? C.ink : C.steel,
              background: i === active ? C.blue : "transparent",
            }}
          >
            {c.label}
          </div>
        ))}
      </div>
    </div>
  );
};

const Rings: React.FC<{ t: number }> = ({ t }) => (
  <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
    {Array.from({ length: 9 }, (_, i) => (
      <circle
        key={i}
        cx={960}
        cy={540}
        r={180 + i * 95 + ((t * 18) % 95)}
        fill="none"
        // Strong enough to survive the web encode; fainter rings vanish into the paper.
        stroke={i % 3 === 0 ? "rgba(53,109,255,0.22)" : "rgba(90,104,120,0.16)"}
        strokeWidth={2}
      />
    ))}
  </svg>
);

// A word that sharpens and rises into place.
const Word: React.FC<{ t: number; at: number; color?: string; children: React.ReactNode }> = ({ t, at, color, children }) => {
  const p = ease(clamp01((t - at) / 0.45));
  return (
    <span style={{ display: "inline-block", color, opacity: p, filter: `blur(${(1 - p) * 8}px)`, transform: `translateY(${(1 - p) * 14}px)` }}>
      {children}
    </span>
  );
};

// Each tagline word arrives as the narrator says it.
const TAGLINE: { text: string; at: number; color?: string }[] = [
  { text: "Everyday", at: w("intro", "everyday") },
  { text: "conversations", at: w("intro", "conversations") },
  { text: "→", at: w("intro", "into clear") - 0.2, color: C.steel },
  { text: "living", at: w("intro", "living"), color: C.blue },
  { text: "process", at: w("intro", "process maps"), color: C.blue },
  { text: "maps", at: w("intro", "maps"), color: C.blue },
  { text: "→", at: w("intro", "practical") - 0.2, color: C.steel },
  { text: "practical", at: w("intro", "practical"), color: C.blue },
  { text: "improvements", at: w("intro", "improve"), color: C.blue },
];
// The narrator has already said these by the end card, so they follow each other briskly.
const END_LINE = [
  { text: "Pick a process.", at: tEndCard + 0.5 },
  { text: "Start an AI interview.", at: tEndCard + 0.85, color: C.blue },
  { text: "Just talk.", at: tEndCard + 1.2 },
];

const TitleCard: React.FC<{ t: number; kind: "intro" | "end" }> = ({ t, kind }) => {
  const t0 = kind === "intro" ? 0.2 : tEndCard;
  const p = (d: number, len = 0.6) => ease(clamp01((t - t0 - d) / len));
  const words = kind === "intro" ? TAGLINE : END_LINE;
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center" }}>
      <Rings t={t} />
      <div style={{ textAlign: "center", transform: `translateY(${(1 - p(0)) * 24}px)` }}>
        <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: C.steel, opacity: p(0.15), marginBottom: 18 }}>
          {kind === "intro" ? "Welcome to" : "Your turn"}
        </div>
        <div style={{ fontSize: 168, fontWeight: 600, letterSpacing: "-0.045em", color: C.ink, lineHeight: 1, opacity: p(0) }}>
          Fabric.
        </div>
        <div style={{ marginTop: 44, fontSize: 38, fontWeight: 500, color: C.ink, display: "flex", gap: 14, justifyContent: "center", alignItems: "center" }}>
          {words.map((wd, i) => (
            <Word key={i} t={t} at={wd.at} color={wd.color}>
              {wd.text}
            </Word>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Sound: a soft click on every click, a faint tick per keystroke, and a breath of air on
// the larger zoom-ins only.
const SFX: { at: number; src: string; volume: number }[] = [
  ...cursor.filter((c) => c.click).map((c) => ({ at: c.at + (c.dur ?? CLICK), src: "sfx/click.wav", volume: 0.3 })),
  ...keyTimes.map((at) => ({ at, src: "sfx/click.wav", volume: 0.1 })),
  ...cams
    .filter((c, i) => i > 0 && Math.log(c.s / cams[i - 1].s) > 0.3)
    .filter((c, i, list) => i === 0 || c.at - list[i - 1].at > 2.5)
    .map((c) => ({ at: c.at, src: "sfx/whoosh.wav", volume: 0.08 })),
];

// The app window and everything riding on it.
const Stage: React.FC<{ t: number }> = ({ t }) => {
  const v = view(t);
  if (v.appIn <= 0) return null;
  const depth = focusDepth(t);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1920,
        height: 1080,
        transformOrigin: "0 0",
        // On the hand-off from the intro, the window rises tilted back and settles flat.
        transform: `translate(960px, ${540 + v.dy}px) perspective(2200px) rotateX(${(1 - v.appIn) * 14}deg) scale(${v.scale}) translate(${-v.x}px, ${-v.y}px)`,
        opacity: v.appIn,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 18,
          overflow: "hidden",
          background: "#fff",
          boxShadow: "0 40px 90px rgba(17,22,28,0.22), 0 0 0 1px rgba(17,22,28,0.08)",
        }}
      >
        <div style={{ position: "absolute", inset: 0, filter: depth > 0 ? `blur(${3.5 * depth}px)` : undefined }}>
          <AppScreen t={t} />
        </div>
        {depth > 0 && <div style={{ position: "absolute", inset: 0, background: C.paper, opacity: 0.32 * depth }} />}
      </div>
      {highlights.map((h, i) => (
        <Focus key={i} t={t} h={h} />
      ))}
      <Cursor t={t} k={v.k} />
    </div>
  );
};

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const appIn = view(t).appIn;
  const endIn = ease(clamp01((t - tEndCard) / 0.8));

  return (
    <AbsoluteFill style={{ fontFamily, background: C.paper }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1200px 700px at 15% 0%, rgba(142,219,232,0.35), transparent 60%), radial-gradient(1000px 700px at 100% 100%, rgba(53,109,255,0.14), transparent 60%), ${C.paper}`,
        }}
      />
      {/* No motion blur: CameraMotionBlur's layer blending washed out and tinted frames
          as it switched on and off, and the in-canvas variant fails to render here. */}
      <Stage t={t} />
      <Keycaps t={t} />
      <ChapterBar t={t} />
      {appIn < 1 && (
        <AbsoluteFill style={{ opacity: 1 - appIn }}>
          <TitleCard t={t} kind="intro" />
        </AbsoluteFill>
      )}
      {endIn > 0 && (
        <AbsoluteFill style={{ opacity: endIn }}>
          <TitleCard t={t} kind="end" />
        </AbsoluteFill>
      )}
      {ORDER.map((id) => (
        <Sequence key={id} from={Math.round(S[id].vo * FPS)} durationInFrames={Math.ceil((S[id].dur + 0.3) * FPS)}>
          <Html5Audio src={staticFile(`vo/${id}.mp3`)} />
        </Sequence>
      ))}
      {SFX.map((s, i) => (
        <Sequence key={`sfx${i}`} from={Math.round(s.at * FPS)} durationInFrames={FPS}>
          <Html5Audio src={staticFile(s.src)} volume={s.volume} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const DURATION_FRAMES = Math.ceil(TOTAL_SECONDS * FPS);
