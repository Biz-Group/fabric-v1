// Compiles src/content/help/*.md into convex/askTools/helpCorpus.generated.ts,
// the corpus AskFabric's help tool searches (FR-1.18). Run after changing an
// article or REVIEW-NOTES.md; a test fails while the committed module is stale.
//
//   node scripts/build-help-corpus.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHelpCorpus,
  renderHelpCorpusModule,
} from "../convex/askTools/helpCorpusBuild.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helpDir = join(root, "src", "content", "help");
const files = Object.fromEntries(
  readdirSync(helpDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => [name, readFileSync(join(helpDir, name), "utf8")]),
);
const corpus = buildHelpCorpus(files, files["REVIEW-NOTES.md"] ?? "");
const out = join(root, "convex", "askTools", "helpCorpus.generated.ts");
writeFileSync(out, renderHelpCorpusModule(corpus));
console.log(
  `Wrote ${corpus.articles.length} articles to ${out}` +
    (corpus.excluded.length ? `; excluded under review: ${corpus.excluded.join(", ")}` : ""),
);
