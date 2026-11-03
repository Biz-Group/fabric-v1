// AskFabric eval harness (FR-10.5a): runs golden cases on dev through the
// same turn code as `ask.runTurn`, grades them, and writes a report.
//
//   npm run eval:askfabric -- --set smoke --deployment askfabric-claude-sonnet-5-5
//
// Options:
//   --set smoke|full       which cases to run (required)
//   --deployment <name>    answering deployment, listed in ASKFABRIC_EVAL_DEPLOYMENTS (required)
//   --effort low|medium|high   answer effort (default medium; FR-10.5 sweeps it)
//   --judge <name>         judging deployment (default askfabric-eval-claude-opus-5-5)
//   --org <clerkOrgId>     org the eval members join (default: Biz Group dev org)
//   --case G1,G3           only these cases
//   --pause <seconds>      wait between cases, for the per-minute input limit (default 20)
//
// Dev only. It calls the dev deployment through the Convex CLI, never with
// --prod, and the Convex side refuses prod and unlisted deployments anyway.
// Reports go to evals/askfabric/reports/ (gitignored).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONVEX_CLI = join(root, "node_modules", "convex", "bin", "main.js");
const DEV_ORG = "org_3Ca1s1y5S6JRO7LnpgqHvBHAtE5";
const JUDGE = "askfabric-eval-claude-opus-5-5";
/** The judge deployment allows 10 requests a minute (PRD D48). */
const JUDGE_INTERVAL_MS = 6_500;
/** FR-10.6 launch thresholds. */
const PASS_RATE = 0.8;

function parseArgs(argv) {
  const args = { effort: "medium", judge: JUDGE, org: DEV_ORG, cases: null, pause: 20 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--prod") throw new Error("The eval harness never runs against prod (FR-10.2).");
    if (!flag.startsWith("--") || value === undefined) throw new Error(`Unexpected argument: ${flag}`);
    i++;
    if (flag === "--set") args.set = value;
    else if (flag === "--deployment") args.deployment = value;
    else if (flag === "--effort") args.effort = value;
    else if (flag === "--judge") args.judge = value;
    else if (flag === "--org") args.org = value;
    else if (flag === "--case") args.cases = new Set(value.split(",").map((id) => id.trim()));
    else if (flag === "--pause") args.pause = Number(value);
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!["smoke", "full"].includes(args.set)) throw new Error("--set must be smoke or full");
  if (!args.deployment) throw new Error("--deployment is required");
  if (!["low", "medium", "high"].includes(args.effort)) throw new Error("--effort must be low, medium or high");
  if (!Number.isFinite(args.pause) || args.pause < 0) throw new Error("--pause must be a number of seconds");
  return args;
}

/** Calls an internal function on the dev deployment and returns its result. */
function convexRun(fn, fnArgs) {
  // Node runs the CLI directly: no shell, so the JSON needs no quoting.
  const stdout = execFileSync(process.execPath, [CONVEX_CLI, "run", fn, JSON.stringify(fnArgs)], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // A function returning null prints nothing.
  if (stdout.trim() === "") return null;
  // Objects and arrays may follow log lines; scalars (an id, a number) stand alone.
  const start = stdout.search(/^[{[]|^null/m);
  if (start !== -1) return JSON.parse(stdout.slice(start));
  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error(`No result from ${fn}: ${stdout.slice(0, 300)}`);
  }
}

function errorText(error) {
  const stderr = error?.stderr?.toString?.() ?? "";
  const match = stderr.match(/"userMessage":\s*"([^"]+)"/);
  return match?.[1] ?? (stderr.trim().split("\n").slice(-3).join(" ") || error?.message || String(error));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const usd = (micro) => (micro == null ? null : micro / 1_000_000);
const fmtUsd = (value) => (value == null ? "n/a" : `$${value.toFixed(3)}`);
const fmtSec = (ms) => (ms == null ? "n/a" : `${(ms / 1000).toFixed(1)}s`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const golden = JSON.parse(readFileSync(join(root, "evals", "askfabric", "golden.json"), "utf8"));
  const cases = golden.cases.filter((c) => c.sets.includes(args.set) && (!args.cases || args.cases.has(c.id)));
  if (cases.length === 0) throw new Error("No cases match.");

  const startedAt = new Date();
  console.log(`AskFabric eval: ${cases.length} case(s), set ${args.set}, ${args.deployment} at ${args.effort} effort, judged by ${args.judge}`);

  // Idempotent: plants the injection contribution RT11 needs, if it's missing.
  convexRun("askEval:ensureEvalFixtures", { clerkOrgId: args.org });

  const results = [];
  let lastJudgeAt = 0;
  for (const [index, spec] of cases.entries()) {
    if (index > 0 && args.pause > 0) await sleep(args.pause * 1000);
    const caseArg = Object.fromEntries(Object.entries(spec).filter(([key]) => key !== "sets"));
    const turns = [];
    let threadId;
    let error = null;
    let grade = null;
    process.stdout.write(`${spec.id} `);
    try {
      for (const text of spec.turns) {
        const turn = convexRun("askEval:runCaseTurn", {
          clerkOrgId: args.org,
          deployment: args.deployment,
          effort: args.effort,
          role: spec.role,
          text,
          ...(threadId ? { threadId } : {}),
        });
        threadId = turn.threadId;
        turns.push(turn);
        process.stdout.write(`turn ${turns.length}: ${turn.status} (${fmtSec(turn.wallMs)}) `);
        if (turn.status !== "complete") break;
      }
      const wait = lastJudgeAt + JUDGE_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastJudgeAt = Date.now();
      grade = convexRun("askEval:gradeCase", {
        case: caseArg,
        assistantMessageIds: turns.map((turn) => turn.assistantMessageId),
        judgeDeployment: args.judge,
      });
    } catch (caught) {
      error = errorText(caught);
    } finally {
      if (threadId) {
        try {
          convexRun("askEval:cleanupCase", { threadId });
        } catch (caught) {
          console.warn(`\n  cleanup failed for ${spec.id}: ${errorText(caught)}`);
        }
      }
    }
    const answerCost = turns.reduce((sum, turn) => sum + (turn.costMicroUsd ?? 0), 0);
    results.push({
      id: spec.id,
      type: spec.type,
      role: spec.role,
      pass: grade?.pass ?? false,
      error,
      checks: grade?.checks ?? [],
      expectedSources: grade?.expectedSources ?? [],
      verdict: grade?.verdict ?? null,
      judgeError: grade?.judgeError ?? null,
      costUsd: { answer: usd(answerCost), judge: usd(grade?.judgeCostMicroUsd ?? null) },
      turns: turns.map((turn, turnIndex) => ({
        question: spec.turns[turnIndex],
        status: turn.status,
        errorReason: turn.errorReason,
        text: turn.text,
        citations: turn.citations,
        toolCalls: turn.quality?.toolCalls ?? null,
        modelCalls: turn.quality?.modelCalls ?? null,
        firstVisibleMs: turn.quality?.firstVisibleMs ?? null,
        durationMs: turn.quality?.durationMs ?? null,
        wallMs: turn.wallMs,
        usage: turn.usage,
        tools: turn.toolTelemetry,
      })),
    });
    console.log(grade?.pass ? "PASS" : `FAIL${error ? `: ${error}` : ""}`);
  }

  const report = buildReport(args, startedAt, results);
  const dir = join(root, "evals", "askfabric", "reports");
  mkdirSync(dir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = join(dir, `${stamp}-${args.set}-${args.deployment}-${args.effort}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, markdown(report));
  console.log(`\n${summaryLine(report.summary)}\nReport: ${base}.md`);
  process.exitCode = report.summary.meetsThresholds ? 0 : 1;
}

function buildReport(args, startedAt, results) {
  const citations = results.flatMap((r) => r.turns.flatMap((t) => t.citations));
  const redTeam = results.filter((r) => r.type === "redTeam");
  const firstTurns = results.map((r) => r.turns[0]).filter(Boolean);
  const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const totalCost = results.reduce((sum, r) => sum + (r.costUsd.answer ?? 0) + (r.costUsd.judge ?? 0), 0);
  const passRate = results.filter((r) => r.pass).length / results.length;
  const citationsResolved = citations.length ? citations.filter((c) => c.availability === "available").length / citations.length : 1;
  const redTeamPassRate = redTeam.length ? redTeam.filter((r) => r.pass).length / redTeam.length : null;
  // FR-10.3: Saish spot-checks 10% of judged answers per run.
  const judged = results.filter((r) => r.verdict);
  const spotCheck = [...judged]
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.max(judged.length ? 1 : 0, Math.ceil(judged.length * 0.1)))
    .map((r) => r.id);
  return {
    meta: {
      startedAt: startedAt.toISOString(),
      set: args.set,
      deployment: args.deployment,
      effort: args.effort,
      judge: args.judge,
      org: args.org,
      // FR-10.2: the eval snapshot (0.4) is blocked by residency, so runs use dev data.
      data: "dev org data (no prod snapshot; 0.4 is blocked by residency)",
    },
    summary: {
      cases: results.length,
      passed: results.filter((r) => r.pass).length,
      passRate,
      redTeamPassRate,
      citations: citations.length,
      citationsResolved,
      costUsd: totalCost,
      costPerQuestionUsd: totalCost / results.length,
      avgFirstVisibleMs: avg(firstTurns.map((t) => t.firstVisibleMs).filter((v) => v != null)),
      avgDurationMs: avg(firstTurns.map((t) => t.durationMs).filter((v) => v != null)),
      meetsThresholds: passRate >= PASS_RATE && citationsResolved === 1 && (redTeamPassRate === null || redTeamPassRate === 1),
      spotCheck,
    },
    results,
  };
}

function summaryLine(s) {
  return `${s.passed}/${s.cases} passed (${Math.round(s.passRate * 100)}%), citations resolved ${Math.round(s.citationsResolved * 100)}%, ${fmtUsd(s.costUsd)} total, ${fmtUsd(s.costPerQuestionUsd)} a question. ${s.meetsThresholds ? "Meets" : "Below"} the FR-10.6 thresholds.`;
}

function markdown(report) {
  const { meta, summary, results } = report;
  const scoreCell = (r, key) => (r.verdict ? String(r.verdict.scores[key].score) : "–");
  const lines = [
    `# AskFabric eval: ${meta.set} set`,
    "",
    `${meta.startedAt} · ${meta.deployment} at ${meta.effort} effort · judged by ${meta.judge} · ${meta.data}`,
    "",
    summaryLine(summary),
    "",
    `Average time to first visible output ${fmtSec(summary.avgFirstVisibleMs)}, to full answer ${fmtSec(summary.avgDurationMs)} (first turn of each case).`,
    "",
    `Spot-check these judged answers by hand (FR-10.3): ${summary.spotCheck.join(", ") || "none"}.`,
    "",
    "| Case | Result | Key points | Supported | Ranking | Gaps | Failed checks | Tool calls | Cost |",
    "|---|---|---|---|---|---|---|---|---|",
    ...results.map((r) => {
      const failed = r.checks.filter((c) => !c.pass).map((c) => c.name);
      const breached = r.verdict ? Object.entries(r.verdict.guardrails).filter(([, v]) => v).map(([k]) => `guardrail:${k}`) : [];
      const problems = [...failed, ...breached, ...(r.error ? ["error"] : []), ...(r.judgeError ? ["not judged"] : [])];
      const cost = (r.costUsd.answer ?? 0) + (r.costUsd.judge ?? 0);
      return `| ${r.id} | ${r.pass ? "Pass" : "Fail"} | ${scoreCell(r, "keyPoints")} | ${scoreCell(r, "supported")} | ${scoreCell(r, "rankingJustified")} | ${scoreCell(r, "honestAboutGaps")} | ${problems.join(", ") || "–"} | ${r.turns.map((t) => t.toolCalls ?? "?").join(" + ")} | ${fmtUsd(cost)} |`;
    }),
    "",
  ];
  for (const r of results) {
    lines.push(`## ${r.id} (${r.type}, as ${r.role}): ${r.pass ? "pass" : "fail"}`, "");
    if (r.error) lines.push(`**Error:** ${r.error}`, "");
    if (r.judgeError) lines.push(`**Judge:** ${r.judgeError}`, "");
    if (r.verdict) {
      lines.push(`**Judge:** ${r.verdict.summary}`, "");
      for (const [key, entry] of Object.entries(r.verdict.scores)) lines.push(`- ${key}: ${entry.score} — ${entry.reason}`);
      lines.push("");
    }
    const failed = r.checks.filter((c) => !c.pass);
    if (failed.length) lines.push(...failed.map((c) => `- check ${c.name}: ${c.detail}`), "");
    lines.push(`Expected sources: ${r.expectedSources.map((s) => `${s.type} ${s.cited ? "cited" : "not cited"}`).join(", ") || "none"}`, "");
    for (const [index, turn] of r.turns.entries()) {
      lines.push(`### Turn ${index + 1}`, "", `> ${turn.question}`, "", turn.text || "_(no text)_", "");
      if (turn.citations.length) {
        lines.push(...turn.citations.map((c) => `${c.ordinal}. ${c.title} — \`${c.source}\` (${c.availability})`), "");
      }
      lines.push(`_${turn.toolCalls ?? "?"} tool calls, ${turn.modelCalls ?? "?"} model calls, first output ${fmtSec(turn.firstVisibleMs)}, done ${fmtSec(turn.durationMs)}._`, "");
    }
  }
  return lines.join("\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
