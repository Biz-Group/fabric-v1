// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

/** The committed cards bundle must match a fresh build: run `node scripts/build-mcp-cards.mjs` after editing src/mcp-cards. */
test("convex/mcp/cardsHtml.generated.ts matches a fresh build of src/mcp-cards", async () => {
  const { renderCardsHtml, renderModule } = await import("../../scripts/build-mcp-cards.mjs");
  const committed = await readFile(path.resolve("convex/mcp/cardsHtml.generated.ts"), "utf8");
  expect(committed.replace(/\r\n/g, "\n")).toBe(renderModule(await renderCardsHtml()));
}, 30_000);
