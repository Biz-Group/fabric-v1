/**
 * Fabric cards for MCP Apps hosts (Phase 5, B9–B11): one sandboxed HTML view
 * that renders the show tools' results — entity cards, a flow step, a chart.
 *
 * Built by scripts/build-mcp-cards.mjs into convex/mcp/cardsHtml.generated.ts
 * and served as `ui://fabric/cards`. Talks to the host over postMessage
 * (JSON-RPC 2.0, the MCP Apps `ui/*` methods). Everything shown comes from the
 * tool result's `structuredContent`; contributor-written text is only ever set
 * with `textContent`, never as HTML. No network access: the host's default CSP
 * applies.
 */

type Json = Record<string, unknown>;
type Message = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Json; result?: unknown; error?: unknown };

const root = document.getElementById("root") as HTMLElement;
let nextId = 1;
const pending = new Map<number | string, (message: Message) => void>();
let initialized = false;

function post(message: Message) {
  window.parent.postMessage(message, "*");
}

function request(method: string, params: Json): Promise<Message> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    post({ jsonrpc: "2.0", id, method, params });
  });
}

function notify(method: string, params: Json = {}) {
  post({ jsonrpc: "2.0", method, params });
}

// ---- Host context: theme and the host's style variables ------------------------

function applyHostContext(context: Json | undefined) {
  if (!context) return;
  const theme = context.theme;
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  const styles = context.styles as { variables?: Record<string, string | undefined>; css?: { fonts?: string } } | undefined;
  for (const [name, value] of Object.entries(styles?.variables ?? {})) {
    if (name.startsWith("--") && typeof value === "string") document.documentElement.style.setProperty(name, value);
  }
  if (styles?.css?.fonts && !document.getElementById("host-fonts")) {
    const style = document.createElement("style");
    style.id = "host-fonts";
    style.textContent = styles.css.fonts;
    document.head.appendChild(style);
  }
}

// ---- DOM helpers --------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A link that asks the host to open it (sandboxed iframes can't navigate). Only http(s). */
function link(text: string, href: unknown, className = "link"): HTMLElement {
  const url = str(href);
  if (!/^https?:\/\//.test(url)) return el("span", className, text);
  const a = el("a", className, text);
  a.href = url;
  a.rel = "noopener noreferrer";
  a.target = "_blank";
  a.addEventListener("click", (event) => {
    event.preventDefault();
    void request("ui/open-link", { url }).then((reply) => {
      if (reply.error) window.open(url, "_blank", "noopener");
    });
  });
  return a;
}

const KIND_LABEL: Record<string, string> = { function: "Function", department: "Department", process: "Process" };
const STEP_LABEL: Record<string, string> = { start: "Start", end: "End", action: "Action", decision: "Decision", handoff: "Handoff", wait: "Wait" };
/** The same labels AskFabric's entity cards use (src/features/ask/display/entity-cards.tsx). */
const OVERVIEW_LABEL: Record<string, string> = {
  current: "Overview current",
  partial: "Overview partial",
  stale: "Overview out of date",
  refreshing: "Overview refreshing",
  failed: "Overview failed",
  missing: "No overview yet",
};

// ---- Renderers ----------------------------------------------------------------

function renderCards(data: Json) {
  const cards = Array.isArray(data.cards) ? (data.cards as Json[]) : [];
  const grid = el("div", "cards");
  for (const card of cards) {
    const item = el("article", "card");
    item.appendChild(el("span", "badge", KIND_LABEL[str(card.kind)] ?? "Item"));
    const title = el("h2", "card-title");
    title.appendChild(link(str(card.name), card.href));
    item.appendChild(title);
    const trail = Array.isArray(card.trail) ? (card.trail as unknown[]).map(str).filter(Boolean) : [];
    if (trail.length) item.appendChild(el("p", "trail", trail.join(" › ")));
    if (str(card.headline)) item.appendChild(el("p", "headline", str(card.headline)));
    const facts = [
      card.processes !== null && card.processes !== undefined ? `${num(card.processes)} processes` : "",
      card.departments !== null && card.departments !== undefined ? `${num(card.departments)} departments` : "",
      card.contributions !== null && card.contributions !== undefined ? `${num(card.contributions)} contributions` : "",
      OVERVIEW_LABEL[str(card.overviewState)] ?? "",
    ].filter(Boolean);
    if (facts.length) item.appendChild(el("p", "facts", facts.join(" · ")));
    grid.appendChild(item);
  }
  root.replaceChildren(grid);
}

function stepChip(step: Json, current = false): HTMLElement {
  const category = str(step.category);
  const chip = el("div", `step step-${category}${current ? " step-current" : ""}`);
  chip.appendChild(el("span", "step-kind", STEP_LABEL[category] ?? "Step"));
  chip.appendChild(link(str(step.label), step.href, "step-label"));
  if (str(step.edgeLabel)) chip.appendChild(el("span", "step-edge", str(step.edgeLabel)));
  return chip;
}

function side(title: string, steps: Json[], more: number): HTMLElement {
  const column = el("div", "flow-side");
  column.appendChild(el("p", "flow-side-title", title));
  if (steps.length === 0) column.appendChild(el("p", "muted", "None"));
  for (const step of steps) column.appendChild(stepChip(step));
  if (more > 0) column.appendChild(el("p", "muted", `+${more} more`));
  return column;
}

function renderFlow(data: Json) {
  const wrap = el("div", "flow");
  const header = el("div", "flow-header");
  header.appendChild(el("p", "eyebrow", "Process flow"));
  header.appendChild(el("h2", "card-title", str(data.processName)));
  wrap.appendChild(header);
  const grid = el("div", "flow-grid");
  grid.appendChild(side("Before", Array.isArray(data.before) ? (data.before as Json[]) : [], num(data.moreBefore)));
  grid.appendChild(el("div", "arrow", "→"));
  const middle = el("div", "flow-side");
  middle.appendChild(el("p", "flow-side-title", "This step"));
  middle.appendChild(stepChip((data.step as Json) ?? {}, true));
  grid.appendChild(middle);
  grid.appendChild(el("div", "arrow", "→"));
  grid.appendChild(side("After", Array.isArray(data.after) ? (data.after as Json[]) : [], num(data.moreAfter)));
  wrap.appendChild(grid);
  if (data.stale === true) wrap.appendChild(el("p", "note", "This flow is out of date with newer contributions."));
  root.replaceChildren(wrap);
}

const SERIES_CLASS = ["s1", "s2", "s3"];

function renderChart(data: Json) {
  const series = Array.isArray(data.series) ? (data.series as Json[]) : [];
  const rows = Array.isArray(data.rows) ? (data.rows as Json[]) : [];
  const wrap = el("div", "chart");
  const header = el("div", "chart-header");
  header.appendChild(el("h2", "card-title", str(data.title)));
  // The scope name is written for mid-sentence use ("the organization"); it stands alone here.
  const scope = str(data.scopeName);
  header.appendChild(el("p", "trail", scope.charAt(0).toUpperCase() + scope.slice(1)));
  wrap.appendChild(header);

  if (series.length > 1) {
    const legend = el("div", "legend");
    series.forEach((s, i) => {
      const item = el("span", "legend-item");
      item.appendChild(el("span", `swatch ${SERIES_CLASS[i % 3]}`));
      item.appendChild(document.createTextNode(str(s.label)));
      legend.appendChild(item);
    });
    wrap.appendChild(legend);
  }

  const totals = rows.map((row) => (Array.isArray(row.values) ? (row.values as unknown[]).reduce<number>((sum, v) => sum + num(v), 0) : 0));
  const max = Math.max(1, ...totals);

  if (str(data.type) === "timeline") {
    const columns = el("div", "timeline");
    rows.forEach((row, i) => {
      const column = el("div", "timeline-col");
      column.title = `${str(row.label)}: ${totals[i]}`;
      const bar = el("div", "timeline-bar s1");
      bar.style.height = `${Math.max(totals[i] ? 4 : 0, (totals[i] / max) * 100)}%`;
      column.appendChild(bar);
      columns.appendChild(column);
    });
    wrap.appendChild(columns);
    if (rows.length) {
      const axis = el("div", "timeline-axis");
      axis.appendChild(el("span", "", str(rows[0].label)));
      axis.appendChild(el("span", "", str(rows[rows.length - 1].label)));
      wrap.appendChild(axis);
    }
  } else {
    const list = el("div", "bars");
    rows.forEach((row, i) => {
      const line = el("div", "bar-row");
      line.appendChild(link(str(row.label), row.href, "bar-label"));
      const track = el("div", "bar-track");
      const values = Array.isArray(row.values) ? (row.values as unknown[]) : [];
      values.forEach((value, s) => {
        if (num(value) <= 0) return;
        const segment = el("div", `bar-seg ${series.length > 1 ? SERIES_CLASS[s % 3] : "accent"}`);
        segment.style.width = `${(num(value) / max) * 100}%`;
        segment.title = `${str(series[s]?.label)}: ${num(value)}`;
        track.appendChild(segment);
      });
      line.appendChild(track);
      line.appendChild(el("span", "bar-value", String(totals[i])));
      list.appendChild(line);
    });
    wrap.appendChild(list);
  }
  if (num(data.more) > 0) wrap.appendChild(el("p", "muted", `+${num(data.more)} more not shown`));
  root.replaceChildren(wrap);
}

function render(structured: unknown) {
  if (!structured || typeof structured !== "object") {
    root.replaceChildren(el("p", "muted", "Nothing to show."));
    return;
  }
  const data = structured as Json;
  if (data.kind === "cards") renderCards(data);
  else if (data.kind === "flow") renderFlow(data);
  else if (data.kind === "chart") renderChart(data);
  else root.replaceChildren(el("p", "muted", "Nothing to show."));
}

// ---- Sizing -------------------------------------------------------------------

let lastHeight = 0;
new ResizeObserver(() => {
  const height = Math.ceil(document.documentElement.scrollHeight);
  if (initialized && height !== lastHeight) {
    lastHeight = height;
    notify("ui/notifications/size-changed", { width: Math.ceil(document.documentElement.scrollWidth), height });
  }
}).observe(document.body);

// ---- Messages from the host ---------------------------------------------------

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window.parent) return;
  const message = event.data as Message;
  if (!message || message.jsonrpc !== "2.0") return;

  // A reply to one of our requests.
  if (message.method === undefined && message.id !== undefined) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }

  switch (message.method) {
    case "ui/notifications/tool-result":
      render(message.params?.structuredContent);
      break;
    case "ui/notifications/host-context-changed":
      applyHostContext(message.params);
      break;
    case "ui/resource-teardown":
      if (message.id !== undefined) post({ jsonrpc: "2.0", id: message.id, result: {} });
      break;
    default:
      // Requests we don't handle get an error; notifications are ignored.
      if (message.id !== undefined && message.method) {
        post({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
      }
  }
});

// ---- Handshake ----------------------------------------------------------------

function markInitialized() {
  if (initialized) return;
  initialized = true;
  notify("ui/notifications/initialized");
}

void request("ui/initialize", {
  protocolVersion: "2026-01-26",
  // The spec names the view's identity and capabilities inconsistently; send both forms.
  appInfo: { name: "fabric-cards", version: "1.0.0" },
  clientInfo: { name: "fabric-cards", version: "1.0.0" },
  appCapabilities: { availableDisplayModes: ["inline"] },
  capabilities: {},
}).then((reply) => {
  applyHostContext((reply.result as Json | undefined)?.hostContext as Json | undefined);
  markInitialized();
});
// Hosts that never answer still get the initialized notification.
setTimeout(markInitialized, 2000);

// A module, so tests can import it for its side effects.
export {};
