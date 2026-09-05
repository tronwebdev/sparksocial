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

export const TrendSourcesInput = z.object({
  /**
   * Optional, and the only reason this tool takes anything at all: with a
   * genome it can also report which of the live sources *that brand* has muted
   * (`trend.source.mute`). Without one it still answers the keyword question,
   * which is what the recipe wizard asks before a brand is in scope.
   */
  genomeId: z.string().min(1).optional(),
});

const SourceDescription = z.object({
  name: z.string(),
  /**
   * `server` — asks the platform for the keyword, across its whole corpus.
   * `filter` — fetches its usual trending list and drops what does not match.
   */
  keywordSupport: z.enum(['server', 'filter']),
  /**
   * Whether this brand has muted the source. False when no `genomeId` was
   * passed — "not asked" reads as "not muted" here rather than as unknown,
   * because the caller that omits the genome is the recipe wizard, which is
   * describing the workspace's capability and not one brand's preferences.
   */
  muted: z.boolean(),
  /**
   * Credentials present. False means nobody has set the vendor up — which is a
   * different fact from `enabled: false` (somebody turned it off) and from
   * `muted` (this brand does not want it), and the three fail differently
   * enough that collapsing them would send the reader looking for the wrong
   * fix.
   */
  configured: z.boolean(),
  /** The operator's `TREND_SOURCE_*_ENABLED` switch. */
  enabled: z.boolean(),
  /**
   * Environment variable **names** that would make this source live. Never
   * values: the value of a bearer token has no business leaving the API, and
   * the name is the only part a person reading a screen needs.
   */
  requires: z.array(z.string()),
  /** One line of context for a source that is not live. */
  note: z.string().optional(),
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

/**
 * `describe` returns **every** source this build knows about, not only the
 * configured ones — see `describeAllTrendSources` in
 * `apps/api/src/trend-sources.ts`. Discovery's rail lists what it returns, and a
 * vendor that is merely unconfigured must be visible-and-explained rather than
 * absent: "we do not support TikTok" and "nobody has pasted a TikTok token" are
 * different facts and only one is true.
 */
export function makeTrendSources(
  describe: () => Array<{
    name: string;
    keywordSupport: 'server' | 'filter';
    configured: boolean;
    enabled: boolean;
    requires: string[];
    note?: string;
  }>,
) {
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

    async handler(input, ctx) {
      const muted = input.genomeId
        ? new Set(await ctx.db.trendSourceMutes.list(input.genomeId, ctx.orgId))
        : new Set<string>();
      const sources = describe().map((s) => ({ ...s, muted: muted.has(s.name) }));
      /* Only a source that is configured, switched on and unmuted can answer a
         keyword. All three stay in `sources` so the screen can render each
         state; the keyword claim is about what would actually be searched. */
      const live = sources.filter((s) => !s.muted && s.configured && s.enabled);
      const searching = live.filter((s) => s.keywordSupport === 'server');
      const filtering = live.filter((s) => s.keywordSupport === 'filter');

      /**
       * Three cases, and the middle one is the reason this tool exists.
       *
       * All-searching needs no caveat. None-searching needs a warning *before* the
       * owner types a keyword, because their first niche word will return nothing.
       * A mix needs both halves named, since the result will be partly a search
       * and partly a filter and no single sentence about "keywords" is true of it.
       */
      const keywordNote =
        live.length === 0
          ? 'No trend source is live, so keywords have nothing to search. Trends come from a built-in ' +
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
