import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';

/**
 * `trend.sources` — which trend sources are live, and how well each honours a
 * keyword.
 *
 * ── Why a screen needs this ───────────────────────────────────────────────
 *
 * The recipe wizard asks for keywords. What those keywords *do* depends entirely
 * on which sources a workspace has configured: Reddit and YouTube take a query
 * and search their platform, while Hacker News, Product Hunt and Pinterest can
 * only narrow the trending page they already fetch. For a niche keyword the
 * second kind returns nothing — and nothing on a screen is indistinguishable from
 * "there are no trends about this", one being a fact about the world and the other
 * a fact about our integration.
 *
 * So the wizard can either say which it is, or let the owner conclude their
 * keyword is wrong. This is what lets it say.
 *
 * ── Injected rather than read from the environment ────────────────────────
 *
 * `packages/trends` never reads `process.env`; `apps/api/src/trend-sources.ts`
 * owns that and passes the description in at registration. Same shape as every
 * other vendor-gated seam here: the package holds the capability and the
 * composition root holds the credentials.
 */

export const TrendSourcesInput = z.object({});

const SourceDescription = z.object({
  name: z.string(),
  /**
   * `server` — asks the platform for the keyword, across its whole corpus.
   * `filter` — fetches its usual trending list and drops what does not match.
   */
  keywordSupport: z.enum(['server', 'filter']),
});

export const TrendSourcesOutput = z.object({
  sources: z.array(SourceDescription),
  /**
   * True when at least one live source can search. The single fact the wizard
   * branches on: with none, a keyword is a filter over trending pages and the
   * screen should say so before the owner types one.
   */
  anyKeywordSearch: z.boolean(),
  /**
   * A sentence the screen can show verbatim.
   *
   * Composed here rather than in the component because it is a claim about the
   * engine's behaviour, and two screens phrasing it differently is how a product
   * comes to describe itself two ways.
   */
  keywordNote: z.string(),
});

export function makeTrendSources(describe: () => Array<{ name: string; keywordSupport: 'server' | 'filter' }>) {
  return defineTool({
    name: 'trend.sources',
    version: 1,

    summary:
      'Which trend sources are live in this workspace, and which of them can search their platform for a ' +
      'keyword rather than only filtering what they already fetch. Read-only, free.',

    input: TrendSourcesInput,
    output: TrendSourcesOutput,

    effect: 'read',
    autonomy: 'auto',
    // Everyone who can see Discovery or build a recipe. It describes the
    // workspace's own configuration and carries no genome data at all.
    scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
    idempotent: true,
    surfaces: ['AUTO-02', 'DISC-01'],

    async handler() {
      const sources = describe();
      const searching = sources.filter((s) => s.keywordSupport === 'server');
      const filtering = sources.filter((s) => s.keywordSupport === 'filter');

      /**
       * Three cases, and the middle one is the reason this tool exists.
       *
       * All-searching needs no caveat. None-searching needs a warning *before* the
       * owner types a keyword, because their first niche word will return nothing.
       * A mix needs both halves named, since the result will be partly a search
       * and partly a filter and no single sentence about "keywords" is true of it.
       */
      const keywordNote =
        sources.length === 0
          ? 'No trend source is configured, so keywords have nothing to search. Trends come from a built-in ' +
            'sample set until one is connected.'
          : filtering.length === 0
            ? `Keywords search ${searching.map((s) => s.name).join(' and ')} directly.`
            : searching.length === 0
              ? `Keywords narrow what ${filtering.map((s) => s.name).join(' and ')} already return rather than ` +
                'searching those platforms — so a very specific word may find nothing even when the topic is ' +
                'active. Broader words work better here.'
              : `Keywords search ${searching.map((s) => s.name).join(' and ')} directly, and narrow what ` +
                `${filtering.map((s) => s.name).join(' and ')} already return.`;

      return { sources, anyKeywordSearch: searching.length > 0, keywordNote };
    },
  });
}
