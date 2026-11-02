// Captures every screen state for the demo video from the live tenant, with
// people's names masked (mask.js). Writes stills + scroll/pan frame sequences to
// public/cap/ and element boxes (CSS px in a 1920x1080 frame) to public/cap/manifest.json.
// Read-only: it never clicks a decision, rating or regenerate control.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "public/cap";
const ORIGIN = "https://biz-group.bizfabric.ai";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// A site zoom saved in the profile (Ctrl+ during `npm run login`) would rescale every
// capture and throw off every box, so clear it before Chrome starts.
{
  const prefsPath = "profile/Default/Preferences";
  const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
  const levels = prefs.partition?.per_host_zoom_levels ?? {};
  let cleared = false;
  for (const hosts of Object.values(levels)) {
    if (hosts && new URL(ORIGIN).host in hosts) delete hosts[new URL(ORIGIN).host], (cleared = true);
  }
  if (cleared) {
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
    console.log("cleared saved site zoom");
  }
}

const ctx = await chromium.launchPersistentContext("./profile", {
  channel: "chrome",
  headless: true,
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});
// The change plan's Copy button reports failure without clipboard access.
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
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

const rect = (r) => r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w ?? r.width), h: Math.round(r.h ?? r.height) };
const box = async (locator) => {
  const b = await locator.first().boundingBox({ timeout: 5000 }).catch(() => null);
  if (!b) console.warn("no box for", String(locator));
  return rect(b);
};
// The nearest ancestor drawn as a card (border + rounded corners) that is larger than the element.
const card = (locator) => async () =>
  rect(
    await locator.first().evaluate((el) => {
      const own = el.getBoundingClientRect();
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        if (parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderTopLeftRadius) > 0 && r.width > own.width + 8) return r.toJSON();
      }
      return null;
    }).catch(() => null),
  );
// The smallest element containing both a and b (a row of pills, a column, a grid).
const span = (a, b) => async () => {
  const other = await b.first().elementHandle().catch(() => null);
  if (!other) return null;
  return rect(
    await a.first().evaluate((el, o) => {
      let n = el;
      while (n && !n.contains(o)) n = n.parentElement;
      return n?.getBoundingClientRect().toJSON() ?? null;
    }, other).catch(() => null),
  );
};
// The largest ancestor of the element that does not also contain `stop`: a column next to
// another column, or a section above the next one.
const upUntil = (locator, stop) => async () => {
  const other = await stop.first().elementHandle().catch(() => null);
  return rect(
    await locator.first().evaluate((el, o) => {
      let n = el;
      while (n.parentElement && n.parentElement !== document.body && !n.parentElement.contains(o)) n = n.parentElement;
      return n.getBoundingClientRect().toJSON();
    }, other).catch(() => null),
  );
};
// The nth match that is on screen (lists scrolled part-way keep earlier matches above the fold).
const onScreen = async (locator, nth = 0, test = (b) => true) => {
  let i = 0;
  for (const el of await locator.all()) {
    const b = await el.boundingBox().catch(() => null);
    if (b && b.y >= 0 && b.y + b.height <= 1080 && test(b) && i++ === nth) return el;
  }
  return locator.first();
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
const snap = async (name) => {
  await scrub(name);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 92 });
};
const shot = async (name, targets = {}, { keepMouse = false } = {}) => {
  if (!keepMouse) await page.mouse.move(1900, 1070);
  await page.waitForTimeout(600);
  await snap(name);
  const boxes = {};
  for (const [k, t] of Object.entries(targets)) boxes[k] = typeof t === "function" ? await t() : await box(t);
  for (const [k, b] of Object.entries(boxes)) if (!b) console.warn(`no box for ${name}.${k}`);
  manifest.states[name] = boxes;
  console.log("still", name, JSON.stringify(boxes));
};
// The same screen with the pointer resting on the next control, so its hover state shows
// as the video's cursor arrives.
const hover = async (name, locator) => {
  const b = await box(locator);
  await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
  await page.waitForTimeout(400);
  await snap(name);
  manifest.states[name] = {};
  console.log("hover", name);
};
const treeItem = (name) => page.locator('[role="treeitem"]', { hasText: new RegExp(`^\\s*${name}`) });
const tab = (name) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const settle = () => page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
const scrollParentOf = (loc) =>
  loc.first().evaluateHandle((el) => {
    let n = el.parentElement;
    while (n && !(n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY))) n = n.parentElement;
    return n;
  });
// Scroll offset that brings `el` to `margin` px below its scroll container's top.
const scrollTargetOf = (loc, margin) =>
  loc.first().evaluate((el, m) => {
    let n = el.parentElement;
    while (n && !(n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY))) n = n.parentElement;
    return Math.min(n.scrollHeight - n.clientHeight, el.getBoundingClientRect().top - n.getBoundingClientRect().top + n.scrollTop - m);
  }, margin);

// Scroll sequence: one frame per step.
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
  // Land exactly on the target so the next still continues from the last frame.
  await containerHandle.evaluate((el, v) => (el.scrollTop = v), to);
  manifest.sequences[name] = frames;
  console.log("seq", name, frames.length);
}

// --- Home: collapsed tree, nothing selected ---------------------------------
await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
await page.getByText("Process Tree").waitFor({ timeout: 60000 });
await settle();
for (const el of await page.locator('[role="treeitem"][aria-expanded="true"]').all().then((a) => a.reverse())) {
  await el.click().catch(() => {});
}
await shot("home", { learning: treeItem("Learning"), tree: page.locator('[role="tree"]') });
await hover("home-hover", treeItem("Learning"));

await treeItem("Learning").first().click();
await settle();
await shot("learning", { pm: treeItem("Project Management") });
await hover("learning-hover", treeItem("Project Management"));

await treeItem("Project Management").first().click();
await settle();
await shot("dept", { pmflow: treeItem("PM Flow") });

// --- Command palette: one still per keystroke ----------------------------------
await page.keyboard.press("Control+k");
await page.waitForTimeout(500);
await shot("cmdk-empty", { palette: page.getByRole("dialog") });
const QUERY = "PM Fl";
for (let i = 1; i <= QUERY.length; i++) {
  await page.keyboard.type(QUERY[i - 1]);
  await page.waitForTimeout(i === QUERY.length ? 800 : 250);
  await snap(`cmdk-${i}`);
}
manifest.typed = QUERY.length;
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
  tabOverview: tab("Overview"),
  tabContributions: tab("Contributions"),
  tabFlow: tab("Process Flow"),
  tabInsights: tab("Insights"),
  tabRecommendations: tab("Recommendations"),
});
await hover("proc-hover-interview", page.getByRole("button", { name: "Start AI interview" }));

await page.getByRole("button", { name: "Start AI interview" }).click();
// The workbench mounts the modal twice (desktop + mobile layouts) and Playwright
// treats neither as visible, so wait on its text and measure the rendered box directly.
// Nothing is created until the name step is submitted; we close before that.
await page.getByText("Who is being recorded?").first().waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
await shot("modal", {}, { keepMouse: true });
manifest.states.modal.dialog = rect(
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-slot="dialog-content"]')]
      .map((e) => e.getBoundingClientRect().toJSON())
      .find((r) => r.width > 0 && r.height > 0),
  ),
);
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
await hover("proc-hover-contributions", tab("Contributions"));

// --- Contributions ---------------------------------------------------------------
await tab("Contributions").click();
await settle();
await page.waitForTimeout(2000);
const firstContribution = page.getByText("PM Flow Explained").first();
const summaryLabel = page.getByText("Summary", { exact: true });
const transcriptLabel = page.getByText("Transcript", { exact: true });
await shot("conv", {
  card: card(firstContribution),
  player: async () => upUntil(await onScreen(page.getByText(/^\d{1,2}:\d{2}$/), 0, (b) => b.x > 1250), summaryLabel)(),
  summary: upUntil(summaryLabel, transcriptLabel),
  transcript: transcriptLabel,
});
{
  const transcript = page.getByText("Transcript", { exact: true });
  await scrollSequence("conv_scroll", await scrollParentOf(transcript), Math.max(0, Math.round(await scrollTargetOf(transcript, 30))), 10);
}
await hover("conv-hover-overview", tab("Overview"));

// --- Overview ------------------------------------------------------------------
await tab("Overview").click();
await settle();
await page.waitForTimeout(2000);
await shot("ov", {
  facts: span(page.getByText("Process trigger", { exact: true }), page.getByText("Open question", { exact: true })),
  // The narrative summary: the first paragraph with bold key terms.
  summary: page.locator("p").filter({ has: page.locator("strong, b") }).first(),
  heading: page.getByRole("heading", { name: "Overview" }),
});
{
  // Pass through "Scope and participants" (corroborated sources) to "Evidence alignment".
  const heading = page.getByRole("heading", { name: "Evidence alignment" });
  const target = Math.round(await scrollTargetOf(heading, 40));
  manifest.ovTarget = target;
  await scrollSequence("ov_scroll", await scrollParentOf(heading), target, 16);
  const agreements = page.getByText(/^agreements$/i).first();
  const tensions = page.getByText(/^knowledge gaps and tensions$/i).first();
  // Source pills are named after contributors, i.e. the stand-ins.
  const pill = page.getByRole("button", {
    name: new RegExp(MASK_PAIRS.map(([, fake]) => fake.split(" ")[0]).filter((n) => n.length >= 3).join("|")),
  });
  await shot("ov-evidence", {
    agreements: upUntil(agreements, tensions),
    tensions: upUntil(tensions, agreements),
    // Below the sticky header, i.e. inside the evidence columns.
    corroborated: async () => box(await onScreen(page.getByText(/^Corroborated/), 0, (b) => b.y > 300)),
    sources: async () => span(await onScreen(pill, 0, (b) => b.y > 300), await onScreen(pill, 1, (b) => b.y > 300))(),
  });
}
await hover("ov-hover-flow", tab("Process Flow"));

// --- Process Flow --------------------------------------------------------------
await tab("Process Flow").click();
await settle();
await page.waitForTimeout(3000);
await shot("flow", { canvas: page.locator(".react-flow").first() });
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
  // The bottleneck node nearest the middle of the panned view.
  const tags = page.getByText(/^bottleneck$/i);
  let pick = tags.first(), best = Infinity;
  for (const el of await tags.all()) {
    const b = await el.boundingBox().catch(() => null);
    if (b && b.x > 700 && b.x < 1700 && b.y > 300 && b.y < 950 && Math.abs(b.x - 1100) < best) (best = Math.abs(b.x - 1100)), (pick = el);
  }
  await shot("flow-panned", {
    bottleneckTag: pick,
    flowNode: async () =>
      rect(await pick.evaluate((el) => el.closest(".react-flow__node")?.getBoundingClientRect().toJSON() ?? null)),
    // The canvas footer's "7 bottlenecks" (number and word are separate nodes).
    stats: async () =>
      rect(
        await (await onScreen(page.getByText(/bottlenecks/i), 0, (b) => b.y > 900)).evaluate((el) => {
          const n = /^\d/.test(el.textContent.trim()) ? el : el.parentElement;
          return n.getBoundingClientRect().toJSON();
        }).catch(() => null),
      ),
  });
}
await hover("flow-hover-insights", tab("Insights"));

// --- Insights --------------------------------------------------------------------
await tab("Insights").click();
await settle();
await page.waitForTimeout(2500);
const tile = (label) => card(page.getByText(new RegExp(`^${label}$`, "i")).first());
await shot("insights", {
  findings: upUntil(page.getByText("Key findings", { exact: true }), page.getByText(/^mapped steps$/i)),
  steps: tile("mapped steps"),
  handoffs: tile("handoffs"),
  tools: tile("tools"),
  decisions: tile("decisions"),
  bottlenecks: tile("bottlenecks"),
});
await hover("insights-hover-recommendations", tab("Recommendations"));

// --- Recommendations --------------------------------------------------------------
await tab("Recommendations").click();
await settle();
await page.waitForTimeout(3000);
const rows = page.locator("button", { hasText: /Value (High|Medium|Low|unknown)/i });
const followOn = page.locator("button", { hasText: /^\s*Then:/ }).first();
// The detail pane sits right of the list; match there, not the list's own labels.
const listRight = await box(rows.first()).then((b) => b.x + b.w);
const inDetail = (locator) => onScreen(locator, 0, (b) => b.x > listRight);
const detailLabel = async (label) => card(await inDetail(page.getByText(new RegExp(`^${label}$`, "i"))))();
const firstTitle = (await rows.first().innerText()).split("\n")[0].trim();
const problemLabel = page.getByText(/^the problem$/i);
await shot("recs", {
  list: upUntil(rows.first(), problemLabel),
  row: rows.first(),
  followOn,
  detail: upUntil(problemLabel, rows.first()),
  title: async () => box(await inDetail(page.getByText(firstTitle, { exact: true }))),
  value: () => detailLabel("value"),
  effort: () => detailLabel("effort"),
  evidence: () => detailLabel("evidence"),
});
{
  // Detail pane down to the pilot and the change plan's Copy button.
  const copy = page.getByRole("button", { name: /^Copy (change plan|for Copilot Studio)$/ });
  const tryIt = page.getByText(/^try it$/i).first();
  const target = Math.round(await scrollTargetOf(tryIt, 24));
  await scrollSequence("recs_scroll", await scrollParentOf(tryIt), target, 14);
  await shot("recs-plan", {
    tryIt: span(tryIt, page.getByText(/^Measure:/).first()),
    plan: span(page.getByText(/^(change plan|build brief)$/i).first(), copy),
    copy,
  });
  await hover("recs-hover-copy", copy);
  await copy.first().click();
  await page.waitForTimeout(500);
  await shot("recs-copied", {}, { keepMouse: true });
}

fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
await ctx.close();
console.log("done");
