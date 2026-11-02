import { v } from "convex/values";
import { keyTerms, normalizeKey } from "../lib/askNormalize";
import { askToolQuery } from "./executor";
import { HELP_ARTICLES } from "./helpCorpus.generated";
import type { HelpArticle, HelpAudience } from "./helpCorpusBuild";
import {
  DEFAULT_BUDGET_TOKENS,
  ResultBuilder,
  clipText,
  searchResult,
  sources,
} from "./results";

/** Articles returned per search; the best few are enough to answer from. */
const MAX_HELP_RESULTS = 3;

/**
 * Keyword relevance: each query term found in the title counts 3, in the
 * summary or tags 2, in the body 1. Ties go to the article whose title is
 * alphabetically first, so results are stable.
 */
export function rankHelpArticles(
  articles: readonly HelpArticle[],
  query: string,
  role: HelpAudience,
): Array<{ article: HelpArticle; score: number }> {
  const terms = [...keyTerms(query)];
  if (terms.length === 0) return [];
  return articles
    .filter((article) => article.audience.includes(role))
    .map((article) => {
      const title = normalizeKey(article.title);
      const summary = normalizeKey(`${article.summary} ${article.tags.join(" ")}`);
      const body = normalizeKey(article.body);
      const score = terms.reduce(
        (sum, term) =>
          sum + (title.includes(term) ? 3 : 0) + (summary.includes(term) ? 2 : 0) + (body.includes(term) ? 1 : 0),
        0,
      );
      return { article, score };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title));
}

export const searchFabricHelpInput = { query: v.string() };

/**
 * T14. Product help from the approved corpus (D28, D36), filtered to articles
 * written for the caller's role. Holds no tenant data, but still runs as the
 * viewer so the role filter uses their current membership.
 */
export const searchFabricHelp = askToolQuery({
  input: searchFabricHelpInput,
  handler: async (_ctx, viewer, input) => {
    const hits = rankHelpArticles(HELP_ARTICLES, input.query, viewer.role).slice(0, MAX_HELP_RESULTS);
    const builder = new ResultBuilder(DEFAULT_BUDGET_TOKENS);
    const perArticle = Math.floor((DEFAULT_BUDGET_TOKENS - 200) / Math.max(hits.length, 1));
    for (const { article } of hits) {
      builder.add(
        searchResult(
          sources.help(article.id),
          article.title,
          clipText(`${article.summary}\n\n${article.body}`, perArticle - 30),
        ),
      );
    }
    return builder.finish({
      query: input.query,
      articles: hits.length,
      ...(hits.length === 0 ? { note: "No help article matches. Say so rather than guessing how Fabric works." } : {}),
    });
  },
});
