import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
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
type Cur = { at: number; x: number; y: number; click?: boolean; dur?: number; hide?: boolean };
type Hl = { from: number; to: number; box: Box; pad?: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const S = SCENES;
const BASE = 0.9; // app window scale when the camera is at rest

// ---------------------------------------------------------------------------
// Element boxes (CSS px in the 1920x1080 app), from capture manifest + measured stills
const st = manifest.states as Record<string, Record<string, Box | null>>;
const B = {
  learning: st.home.learning!,
  pm: st.learning.pm!,
  pmflow: st.dept.pmflow!,
  treePanel: { x: 256, y: 68, w: 352, h: 470 },
  searchTrigger: { x: 272, y: 14, w: 576, h: 36 },
  palette: { x: 672, y: 130, w: 576, h: 258 },
  cmdkResult: { x: 704, y: 205, w: 560, h: 38 },
  interview: st.proc.interview!,
  voice: st.proc.voice!,
  upload: st.proc.upload!,
  tabOverview: st.proc.tabOverview!,
  tabConversations: st.proc.tabConversations!,
  tabFlow: st.proc.tabFlow!,
  tabInsights: st.proc.tabInsights!,
  tabAutomations: st.proc.tabAutomations!,
  dialog: st.modal.dialog!,
  convCard: { x: 636, y: 302, w: 606, h: 96 },
  player: { x: 1296, y: 266, w: 596, h: 48 },
  summary: { x: 1296, y: 334, w: 596, h: 400 },
  ovSummary: { x: 776, y: 372, w: 792, h: 390 },
  agreements: { x: 778, y: 352, w: 474, h: 728 },
  tensions: { x: 1282, y: 352, w: 482, h: 270 },
  corroborated: { x: 1069, y: 394, w: 176, h: 30 },
  sources: { x: 781, y: 582, w: 236, h: 44 },
  flowNode: { x: 827, y: 596, w: 256, h: 126 },
  bottleneckTag: { x: 836, y: 699, w: 68, h: 22 },
  bottleneckStat: { x: 740, y: 1026, w: 108, h: 30 },
  cardSteps: { x: 961, y: 352, w: 298, h: 113 },
  cardHandoffs: { x: 1272, y: 352, w: 298, h: 113 },
  cardTools: { x: 1583, y: 352, w: 298, h: 113 },
  cardDecisions: { x: 650, y: 478, w: 298, h: 113 },
  cardBottlenecks: { x: 961, y: 478, w: 298, h: 113 },
  autoList: { x: 612, y: 236, w: 303, h: 840 },
  autoItem2: { x: 612, y: 566, w: 303, h: 90 },
  brief: { x: 926, y: 252, w: 980, h: 360 },
  copy: st.auto2.copy!,
};

// ---------------------------------------------------------------------------
// Timeline (absolute seconds). Clicks land on the word that names the control.
const CLICK = 0.75; // cursor travel time
const tabClick = (scene: keyof typeof S) => S[scene].start + 0.15 + CLICK;

const tTreeClick1 = w("tree", "Click to expand") + 0.15;
const tTreeClick2 = w("tree", "any branch", "end") + 0.15;
const tCtrlK = w("tree", "Control K");
const tTyped = w("tree", "jump straight") + 0.2;
const tResultClick = S.capture.start + 0.2;
const tInterviewClick = w("capture", "AI interview", "end") + 0.1;
const tSolo = w("capture", "Prefer to go solo");
const tScrollOv = w("overview", "of the process", "end") + 0.15;
const tAgree = w("overview", "agree");
const tPanStart = w("flow", "every step");
const tBottlenecks = w("flow", "Bottlenecks");
const tItem2Click = w("automations", "off people's plates", "end") - 0.2;
const tCopyClick = w("automations", "brief for Copilot", "end") + 0.1;
const tEndCard = w("outro", "We'll take care") - 0.15;

const screens: Screen[] = [
  { at: 0, still: "home" },
  { at: tTreeClick1 + 0.15, still: "learning" },
  { at: tTreeClick2 + 0.15, still: "dept" },
  { at: tCtrlK + 0.1, still: "cmdk-empty" },
  { at: tTyped, still: "cmdk" },
  { at: tResultClick + 0.15, still: "proc" },
  { at: tInterviewClick + 0.15, still: "modal" },
  { at: tSolo - 0.1, still: "proc" },
  { at: tabClick("conversations") + 0.15, still: "conv" },
  { at: w("conversations", "full transcript"), seq: "conv_scroll", dur: 1.6 },
  { at: tabClick("overview") + 0.15, still: "ov" },
  { at: tScrollOv, seq: "ov_scroll", dur: Math.max(1.6, tAgree - tScrollOv - 0.15) },
  { at: tAgree - 0.1, still: "ov-evidence" },
  { at: tabClick("flow") + 0.15, still: "flow" },
  { at: tPanStart, seq: "flow_pan", dur: Math.max(2, tBottlenecks - tPanStart - 0.35) },
  { at: tBottlenecks - 0.3, still: "flow-panned" },
  { at: tabClick("insights") + 0.15, still: "insights" },
  { at: tabClick("automations") + 0.15, still: "auto" },
  { at: tItem2Click + 0.15, still: "auto2" },
  { at: S.outro.start + 0.1, still: "proc" },
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
  { at: S.conversations.start, ...REST },
  { at: w("conversations", "with the audio") - 0.2, x: 1590, y: 470, s: 1.55 },
  { at: S.overview.start, ...REST },
  { at: w("overview", "a single overview"), x: 1172, y: 560, s: 1.4 },
  { at: tScrollOv - 0.3, ...REST, dur: 0.5 },
  { at: tAgree, x: 1270, y: 560, s: 1.3 },
  { at: w("overview", "which sources"), x: 1010, y: 500, s: 1.6 },
  { at: w("overview", "The more people"), ...REST, dur: 1.2 },
  { at: S.flow.start, ...REST },
  { at: tBottlenecks - 0.2, x: 1000, y: 700, s: 1.8 },
  { at: w("flow", "spot the friction"), x: 980, y: 900, s: 1.5 },
  { at: S.insights.start, ...REST },
  { at: w("insights", "rolls it all up"), x: 1265, y: 470, s: 1.4 },
  { at: S.automations.start, ...REST },
  { at: w("automations", "recommends"), x: 900, y: 620, s: 1.3 },
  { at: w("automations", "writes a ready") - 0.2, x: 1420, y: 400, s: 1.45 },
  { at: S.outro.start, ...REST },
  { at: w("outro", "hit Start") - 0.3, x: 1330, y: 160, s: 2 },
];

const at = (b: Box) => center(b);
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
  { at: tabClick("conversations") - CLICK, ...at(B.tabConversations), click: true },
  { at: w("conversations", "the audio") - 0.3, x: 1360, y: 290 },
  { at: tabClick("overview") - CLICK, ...at(B.tabOverview), click: true },
  { at: tabClick("overview") + 0.4, x: 1640, y: 640 },
  { at: tabClick("flow") - CLICK, ...at(B.tabFlow), click: true },
  { at: tPanStart - 0.5, x: 1500, y: 470 },
  { at: tPanStart - 0.05, x: 1500, y: 470, dur: 0.05, click: true },
  { at: tBottlenecks - 0.3, x: 1100, y: 800, dur: 0.3 },
  { at: tabClick("insights") - CLICK, ...at(B.tabInsights), click: true },
  { at: tabClick("insights") + 0.4, x: 1300, y: 700 },
  { at: tabClick("automations") - CLICK, ...at(B.tabAutomations), click: true },
  { at: tItem2Click - CLICK, ...at(B.autoItem2), click: true },
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
  { from: w("conversations", "the audio"), to: w("conversations", "an AI summary"), box: B.player },
  { from: w("conversations", "an AI summary"), to: w("conversations", "full transcript"), box: B.summary },
  { from: w("overview", "a single overview") + 0.4, to: tScrollOv - 0.2, box: B.ovSummary },
  { from: tAgree, to: w("overview", "differ") - 0.1, box: B.agreements },
  { from: w("overview", "differ") - 0.1, to: w("overview", "which sources") - 0.1, box: B.tensions },
  { from: w("overview", "which sources"), to: w("overview", "The more people"), box: B.corroborated },
  { from: w("overview", "which sources") + 0.2, to: w("overview", "The more people"), box: B.sources },
  { from: tBottlenecks, to: w("flow", "spot the friction"), box: B.bottleneckTag },
  { from: tBottlenecks, to: w("flow", "spot the friction"), box: B.flowNode, pad: 6 },
  { from: w("flow", "spot the friction"), to: S.flow.end, box: B.bottleneckStat },
  { from: w("insights", "steps"), to: w("insights", "handoffs"), box: B.cardSteps },
  { from: w("insights", "handoffs"), to: w("insights", "tools"), box: B.cardHandoffs },
  { from: w("insights", "tools"), to: w("insights", "decisions"), box: B.cardTools },
  { from: w("insights", "decisions"), to: w("insights", "pain points"), box: B.cardDecisions },
  { from: w("insights", "pain points"), to: S.insights.end, box: B.cardBottlenecks },
  { from: w("automations", "recommends"), to: tItem2Click - CLICK, box: B.autoList, pad: 0 },
  { from: w("automations", "writes a ready"), to: tCopyClick, box: B.brief },
  { from: w("outro", "hit Start"), to: tEndCard + 0.3, box: B.interview },
];

const CHAPTERS: { scene: keyof typeof S; label: string }[] = [
  { scene: "tree", label: "Navigate" },
  { scene: "capture", label: "Capture" },
  { scene: "conversations", label: "Conversations" },
  { scene: "overview", label: "Overview" },
  { scene: "flow", label: "Process Flow" },
  { scene: "insights", label: "Insights" },
  { scene: "automations", label: "Automations" },
];

// ---------------------------------------------------------------------------
function keyframed<T extends { at: number; dur?: number }>(
  list: T[],
  t: number,
  pick: (k: T) => number[],
  defaultDur: number,
): number[] {
  let v = pick(list[0]);
  for (const k of list) {
    if (k.at > t) break;
    const p = ease(clamp01((t - k.at) / (k.dur ?? defaultDur)));
    const to = pick(k);
    v = v.map((a, i) => a + (to[i] - a) * p);
  }
  return v;
}

function camera(t: number) {
  const [x0, y0, s] = keyframed(cams, t, (k) => [k.x, k.y, k.s], 0.9);
  const k = BASE * s;
  const clamp = (v: number, half: number, size: number) =>
    k <= 1 ? size / 2 + (v - size / 2) * 0 : Math.min(size - half / k, Math.max(half / k, v));
  return { x: clamp(x0, 960, 1920), y: clamp(y0, 540, 1080), k };
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

const Highlight: React.FC<{ t: number; h: Hl }> = ({ t, h }) => {
  const o = Math.min(clamp01((t - h.from) / 0.25), clamp01((h.to - t) / 0.25));
  if (o <= 0) return null;
  const pad = h.pad ?? 6;
  const pulse = 1 + 0.25 * Math.sin((t - h.from) * 5);
  return (
    <div
      style={{
        position: "absolute",
        left: h.box.x - pad,
        top: h.box.y - pad,
        width: h.box.w + pad * 2,
        height: h.box.h + pad * 2,
        borderRadius: 12,
        border: `3px solid ${C.blue}`,
        boxShadow: `0 0 0 ${6 * pulse}px rgba(53,109,255,0.16), 0 0 28px rgba(53,109,255,0.28)`,
        opacity: o,
      }}
    />
  );
};

const Cursor: React.FC<{ t: number; k: number }> = ({ t, k }) => {
  const [x, y] = keyframed(cursor, t, (c) => [c.x, c.y], CLICK);
  const last = cursor.findLast((c) => c.at <= t);
  const visible = cursor.findLast((c) => c.at <= t && c.hide !== undefined)?.hide === false;
  const prev = cursor.findLast((c) => c.at <= t && c.hide !== undefined);
  const o = visible ? clamp01((t - (prev?.at ?? 0)) / 0.3) : 1 - clamp01((t - (prev?.at ?? 0)) / 0.3);
  // Click: on arrival, press + ripple
  const clicks = cursor.filter((c) => c.click).map((c) => c.at + (c.dur ?? CLICK));
  const tc = clicks.findLast((c) => c <= t + 0.05);
  const since = tc === undefined ? 99 : t - tc;
  const press = since > -0.05 && since < 0.18 ? 0.82 : 1;
  const size = 1 / Math.sqrt(k);
  void last;
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

const Toast: React.FC<{ t: number }> = ({ t }) => {
  const tc = tCopyClick + 0.1;
  const o = Math.min(clamp01((t - tc) / 0.2), clamp01((S.automations.end - t) / 0.3));
  if (o <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 1560,
        top: 300 + (1 - o) * 10,
        padding: "12px 18px",
        borderRadius: 10,
        background: C.ink,
        color: "#fff",
        fontSize: 17,
        fontWeight: 500,
        opacity: o,
        boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
        display: "flex",
        gap: 10,
        alignItems: "center",
      }}
    >
      <span style={{ color: C.cyan }}>✓</span> Brief copied
    </div>
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
        stroke={i % 3 === 0 ? "rgba(53,109,255,0.10)" : "rgba(90,104,120,0.08)"}
        strokeWidth={1.5}
      />
    ))}
  </svg>
);

const TitleCard: React.FC<{ t: number; kind: "intro" | "end" }> = ({ t, kind }) => {
  const t0 = kind === "intro" ? 0.2 : tEndCard;
  const p = (d: number, len = 0.6) => ease(clamp01((t - t0 - d) / len));
  const line1At = kind === "intro" ? w("intro", "everyday conversations") - t0 : 0.5;
  const line2At = kind === "intro" ? w("intro", "into clear") - t0 : 0.9;
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
        <div style={{ marginTop: 44, fontSize: 40, fontWeight: 500, color: C.ink, display: "flex", gap: 18, justifyContent: "center", alignItems: "center" }}>
          {kind === "intro" ? (
            <>
              <span style={{ opacity: p(line1At, 0.5) }}>Everyday conversations</span>
              <span style={{ opacity: p(line2At - 0.2, 0.4), color: C.steel }}>→</span>
              <span style={{ opacity: p(line2At, 0.5), color: C.blue }}>living process maps</span>
            </>
          ) : (
            <span style={{ opacity: p(line1At, 0.5) }}>
              Pick a process. <span style={{ color: C.blue }}>Start an AI interview.</span> Just talk.
            </span>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const { x, y, k } = camera(t);

  // Intro card hands off to the app window just before the tour starts.
  const appIn = ease(clamp01((t - (S.tree.start - 0.9)) / 1.1));
  const endIn = ease(clamp01((t - tEndCard) / 0.8));
  const enter = 0.78 + 0.22 * appIn;

  return (
    <AbsoluteFill style={{ fontFamily, background: C.paper }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1200px 700px at 15% 0%, rgba(142,219,232,0.35), transparent 60%), radial-gradient(1000px 700px at 100% 100%, rgba(53,109,255,0.14), transparent 60%), ${C.paper}`,
        }}
      />
      {appIn > 0 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 1920,
            height: 1080,
            transformOrigin: "0 0",
            transform: `translate(960px, ${540 + (1 - appIn) * 120}px) scale(${k * enter}) translate(${-x}px, ${-y}px)`,
            opacity: appIn,
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
            <AppScreen t={t} />
          </div>
          {highlights.map((h, i) => (
            <Highlight key={i} t={t} h={h} />
          ))}
          <Toast t={t} />
          <Cursor t={t} k={k} />
        </div>
      )}
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
          <Audio src={staticFile(`vo/${id}.mp3`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const DURATION_FRAMES = Math.ceil(TOTAL_SECONDS * FPS);
