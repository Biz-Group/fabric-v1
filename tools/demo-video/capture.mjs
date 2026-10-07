// Captures every screen state for the demo video from the live tenant, with
// people's names masked (mask.js). Writes stills + scroll/pan frame sequences to
// public/cap/ and element boxes (CSS px in a 1920x1080 frame) to public/cap/manifest.json.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "public/cap";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext("./profile", {
  channel: "chrome",
  headless: true,
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});
// [real, stand-in] name pairs; gitignored so real names never land in the repo.
const MASK_PAIRS = JSON.parse(fs.readFileSync("mask-names.json", "utf8"));
await ctx.addInitScript({ content: `window.__MASK_PAIRS = ${JSON.stringify(MASK_PAIRS)};` });
await ctx.addInitScript({ path: "./mask.js" });
// Hide the text caret and scrollbars so stills and sequences match frame to frame.
await ctx.addInitScript({
  content: `document.addEventListener("DOMContentLoaded",()=>{const s=document.createElement("style");s.textContent="*{caret-color:transparent!important}::-webkit-scrollbar{width:0!important;height:0!important}";document.head.appendChild(s)})`,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const manifest = { states: {}, sequences: {} };

const box = async (locator) => {
  const b = await locator.first().boundingBox({ timeout: 5000 }).catch(() => null);
  if (!b) console.warn("no box for", String(locator));
  return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
};
// Every real word in the mask list (names, not initials) must be absent from each capture.
const LEAKS = [...new Set(MASK_PAIRS.flatMap(([real]) => real.match(/[A-Za-z]{3,}/g) ?? []))];
// Text nodes are masked by mask.js; input values are not, so swap those here,
// then refuse to continue if any real name is still on screen.
const scrub = async (name) => {
  const text = await page.evaluate((pairs) => {
    for (const el of document.querySelectorAll("input, textarea")) {
      for (const [real, fake] of pairs) el.value = el.value.split(real).join(fake);
    }
    const vals = [...document.querySelectorAll("input, textarea")].map((e) => e.value).join("\n");
    return document.body.innerText + "\n" + vals;
  }, MASK_PAIRS);
  const leaked = LEAKS.filter((n) => new RegExp(`\\b${n}`).test(text));
  if (leaked.length) throw new Error(`name leak in ${name}: ${leaked}`);
};
const shot = async (name, targets = {}) => {
  await page.waitForTimeout(600);
  await scrub(name);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 92 });
  const boxes = {};
  for (const [k, loc] of Object.entries(targets)) boxes[k] = await box(loc);
  manifest.states[name] = boxes;
  console.log("still", name, JSON.stringify(boxes));
};
const treeItem = (name) => page.locator('[role="treeitem"]', { hasText: new RegExp(`^\\s*${name}`) });
const tab = (name) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const settle = () => page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

// --- Home: collapsed tree, nothing selected ---------------------------------
await page.goto("https://biz-group.bizfabric.ai/", { waitUntil: "domcontentloaded" });
await page.getByText("Process Tree").waitFor({ timeout: 60000 });
await settle();
for (const el of await page.locator('[role="treeitem"][aria-expanded="true"]').all().then((a) => a.reverse())) {
  await el.click().catch(() => {});
}
await page.mouse.move(1900, 1070);
await shot("home", { learning: treeItem("Learning"), tree: page.getByText("Process Tree") });

await treeItem("Learning").first().click();
await settle();
await shot("learning", { pm: treeItem("Project Management") });

await treeItem("Project Management").first().click();
await settle();
await shot("dept", { pmflow: treeItem("PM Flow") });

// --- Command palette ---------------------------------------------------------
await page.keyboard.press("Control+k");
await page.waitForTimeout(500);
await shot("cmdk-empty", { search: page.getByText("Search functions, departments, or processes...").first() });
await page.keyboard.type("PM Fl", { delay: 60 });
await page.waitForTimeout(800);
await shot("cmdk", { result: page.getByRole("dialog").getByText("PM Flow").first() });
await page.keyboard.press("Escape");

// --- Process page --------------------------------------------------------------
await treeItem("PM Flow").first().click();
await tab("Overview").waitFor();
await settle();
await page.waitForTimeout(1500);
await shot("proc", {
  interview: page.getByRole("button", { name: "Start AI interview" }),
  voice: page.getByRole("button", { name: "Record a voice note" }),
  upload: page.getByRole("button", { name: "Upload files" }),
  title: page.getByRole("heading", { name: "PM Flow" }),
  tabs: page.getByRole("tablist"),
  tabConversations: tab("Conversations"),
  tabFlow: tab("Process Flow"),
  tabInsights: tab("Insights"),
  tabAutomations: tab("Automations"),
  tabOverview: tab("Overview"),
});

await page.getByRole("button", { name: "Start AI interview" }).click();
// The workbench mounts the modal twice (desktop + mobile layouts) and Playwright
// treats neither as visible, so wait on its text and measure the rendered box directly.
// Nothing is created until the name step is submitted; we close before that.
await page.getByText("Who is being recorded?").first().waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
await shot("modal");
manifest.states.modal.dialog = await page.evaluate(() => {
  const r = [...document.querySelectorAll('[data-slot="dialog-content"]')]
    .map((e) => e.getBoundingClientRect())
    .find((r) => r.width > 0 && r.height > 0);
  return r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

// --- Conversations -------------------------------------------------------------
await tab("Conversations").click();
await settle();
await page.waitForTimeout(2000);
await shot("conv", {
  first: page.getByRole("button", { name: /PM Flow Explained/ }).or(page.getByText("PM Flow Explained")).first(),
  player: page.getByText("Summary", { exact: true }),
  transcript: page.getByText("Transcript", { exact: true }),
});

// Scroll sequence: conversation detail panel down to the transcript.
async function scrollSequence(name, containerHandle, to, step) {
  await scrub(name);
  const from = await containerHandle.evaluate((el) => el.scrollTop);
  const dir = Math.sign(to - from) || 1;
  const frames = [];
  for (let y = from, i = 0; dir > 0 ? y <= to : y >= to; y += dir * step, i++) {
    await containerHandle.evaluate((el, v) => (el.scrollTop = v), y);
    await page.waitForTimeout(40);
    const f = `${OUT}/${name}_${String(i).padStart(4, "0")}.jpg`;
    await page.screenshot({ path: f, type: "jpeg", quality: 90 });
    frames.push(f.replace("public/", ""));
  }
  manifest.sequences[name] = frames;
  console.log("seq", name, frames.length);
}
const scrollParentOf = (loc) =>
  loc.first().evaluateHandle((el) => {
    let n = el.parentElement;
    while (n && !(n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY))) n = n.parentElement;
    return n;
  });

{
  const transcript = page.getByText("Transcript", { exact: true });
  const sc = await scrollParentOf(transcript);
  const target = await transcript.first().evaluate((el, ) => {
    let n = el.parentElement;
    while (n && !(n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY))) n = n.parentElement;
    return el.getBoundingClientRect().top - n.getBoundingClientRect().top + n.scrollTop - 30;
  });
  await scrollSequence("conv_scroll", sc, Math.max(0, Math.round(target)), 10);
}

// --- Overview ------------------------------------------------------------------
await tab("Overview").click();
await settle();
await page.waitForTimeout(2000);
await shot("ov", { overview: page.getByRole("heading", { name: "Overview" }) });
{
  const heading = page.getByRole("heading", { name: "Evidence alignment" });
  const sc = await scrollParentOf(heading);
  // Pass through "Scope and participants" (corroborated sources) to "Evidence alignment".
  const target = await heading.first().evaluate((el) => {
    let n = el.parentElement;
    while (n && !(n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY))) n = n.parentElement;
    return el.getBoundingClientRect().top - n.getBoundingClientRect().top + n.scrollTop - 40;
  });
  manifest.ovTarget = Math.round(target);
  await scrollSequence("ov_scroll", sc, Math.round(target), 16);
  await shot("ov-evidence", {
    agreements: page.getByRole("heading", { name: "AGREEMENTS" }),
    tensions: page.getByRole("heading", { name: "KNOWLEDGE GAPS AND TENSIONS" }),
  });
}

// --- Process Flow --------------------------------------------------------------
await tab("Process Flow").click();
await settle();
await page.waitForTimeout(3000);
await shot("flow", {
  canvas: page.locator(".react-flow").first(),
  bottleneck: page.getByText("bottleneck").first(),
  stats: page.getByText(/bottlenecks/).first(),
});
{
  // Pan the canvas left by dragging, one frame per step.
  const c = await box(page.locator(".react-flow__pane").first());
  const sx = c.x + c.w * 0.75, sy = c.y + c.h * 0.25;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const frames = [];
  const total = 1500, step = 10;
  for (let d = 0, i = 0; d <= total; d += step, i++) {
    await page.mouse.move(sx - d, sy, { steps: 1 });
    await page.waitForTimeout(30);
    const f = `${OUT}/flow_pan_${String(i).padStart(4, "0")}.jpg`;
    await page.screenshot({ path: f, type: "jpeg", quality: 90 });
    frames.push(f.replace("public/", ""));
  }
  await page.mouse.up();
  manifest.sequences.flow_pan = frames;
  console.log("seq flow_pan", frames.length);
  await page.mouse.move(1900, 1070);
  await shot("flow-panned", { bottleneck: page.getByText("bottleneck").first() });
}

// --- Insights --------------------------------------------------------------------
await tab("Insights").click();
await settle();
await page.waitForTimeout(2500);
await page.mouse.move(1900, 1070);
await shot("insights", {
  steps: page.getByText("MAPPED STEPS", { exact: false }).first(),
  handoffs: page.getByText("HANDOFFS", { exact: false }).first(),
  decisions: page.getByText("DECISIONS", { exact: false }).first(),
  bottlenecks: page.getByText("BOTTLENECKS", { exact: false }).first(),
});

// --- Automations -----------------------------------------------------------------
await tab("Automations").click();
await settle();
await page.waitForTimeout(2500);
await shot("auto", {
  list: page.getByText("POTENTIAL AUTOMATIONS").first(),
  item2: page.getByText("Automated Feedback Consolidation & Report Generation").first(),
  copy: page.getByRole("button", { name: /^Copy/ }).first(),
});
await page.getByText("Automated Feedback Consolidation & Report Generation").first().click();
await page.waitForTimeout(1200);
await shot("auto2", { copy: page.getByRole("button", { name: /^Copy/ }).first() });


fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
await ctx.close();
console.log("done");
