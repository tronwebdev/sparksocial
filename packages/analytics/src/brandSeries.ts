import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `analytics.brand_series` — the numbers behind the cockpit's KPI row and its
 * Performance Insights panel (`DASH-B-01`, M1).
 *
 * ── What the data can and cannot support ───────────────────────────────────
 *
 * The prototype's dashboard shows a seven-day impressions *line* with a
 * period-over-period delta. `content_metrics` cannot produce that: it holds one
 * row per `(content_item_id, platform)`, upserted on every sync, so the database
 * knows what each post looks like *now* and nothing about what it looked like
 * yesterday. Its own table comment says so outright — "this is what the platform
 * reports right now, not a time series".
 *
 * Two ways to close that. Start recording history — a per-sync append, a job to
 * fill it, and weeks of waiting before the first chart has a second point. Or ask
 * the same question the other way round: not "how did impressions move over the
 * week" but **"how did the posts published on each day of the week do"**. The
 * second is answerable from rows that already exist, it is what a brand owner is
 * actually asking, and every number in it is measured rather than interpolated.
 *
 * So that is what this returns, and the difference is stated in `basis` rather
 * than left for someone to infer from a chart that looks like a time series.
 *
 * ── The caveat that has to travel with it ─────────────────────────────────
 *
 * A post published this morning has had hours to accumulate; Monday's has had
 * days. The last day of any window is therefore always understated, and a reader
 * who does not know that will read a healthy week as a collapsing one. `maturing`
 * names how many of the window's posts are younger than the maturity threshold,
 * so the UI can say so instead of drawing a cliff.
 *
 * ── Not a decision, so no `why` ────────────────────────────────────────────
 *
 * Invariant 4 attaches an `Explanation` to decisions the owner watches SPARK
 * make — trend selection, calendar placement, mix ratios. This is arithmetic over
 * measured rows: there is no alternative it rejected and no factor it weighed.
 * `basis` and `maturing` carry what a reader needs; an `Explanation` here would
 * be ceremony that made the output look more considered than it is.
 */

/** Below this age a post is still accumulating fast enough to understate its day. */
const MATURITY_HOURS = 48;

const DAY_MS = 86_400_000;

export const BrandSeriesInput = z.object({
  genomeId: z.string().min(1),
  /**
   * Days in the window. Seven matches the prototype's chart; the comparison
   * period is the same length immediately before it, which is why the read
   * covers twice this.
   */
  windowDays: z.number().int().min(1).max(90).default(7),
});

const Totals = z.object({
  posts: z.number().int(),
  impressions: z.number().int(),
  views: z.number().int(),
  /** Likes + comments + shares + saves — the interactions, as against the reach. */
  engagements: z.number().int(),
});

export const BrandSeriesOutput = z.object({
  windowDays: z.number().int(),
  /**
   * What the numbers are grouped by, said in the output rather than assumed by
   * the reader. Only one value today; a field rather than a constant because the
   * day a metrics history exists, this tool gains `measurement_date` and every
   * caller needs to be able to tell which it is looking at.
   */
  basis: z.literal('publication_date'),
  /** Oldest first, one entry per day in the window, including days with nothing. */
  days: z.array(
    z.object({
      /** `YYYY-MM-DD`, UTC. */
      date: z.string(),
      posts: z.number().int(),
      impressions: z.number().int(),
      engagements: z.number().int(),
    }),
  ),
  totals: Totals,
  /** The same length of time immediately before the window — the delta's denominator. */
  previous: Totals,
  /**
   * Percentage change in impressions against `previous`, rounded to a whole
   * number. Null when the previous period had no impressions at all: "up from
   * nothing" is not a percentage, and rendering it as +100% or ∞ would be the
   * kind of number people screenshot.
   */
  impressionsChangePct: z.number().nullable(),
  engagementsChangePct: z.number().nullable(),
  byPlatform: z.array(
    z.object({
      platform: z.string(),
      impressions: z.number().int(),
      /** Share of the window's measured impressions, 0–1 — the bar width. */
      share: z.number(),
    }),
  ),
  /**
   * Posts in the window younger than 48 hours, and therefore still climbing.
   * Non-zero means the most recent days are understated.
   */
  maturing: z.number().int(),
  /** Published posts in the window with no snapshot at all — measured as zero, honestly. */
  unmeasured: z.number().int(),
});

interface Row {
  contentItemId: string;
  publishedAt: Date;
  platform?: string;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  saves: number;
}

const engagementsOf = (r: Row) => r.likes + r.comments + r.shares + r.saves;

/** `YYYY-MM-DD` in UTC. One zone for everybody, so two readers never see two charts. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The aggregation, separated from the tool so it can be tested against a fixed
 * row set without a database. Pure: every date it needs is passed in.
 */
export function aggregateSeries(rows: Row[], windowDays: number, now: Date): z.infer<typeof BrandSeriesOutput> {
  const windowStart = new Date(now.getTime() - windowDays * DAY_MS);
  const inWindow = rows.filter((r) => r.publishedAt >= windowStart);
  const inPrevious = rows.filter(
    (r) => r.publishedAt < windowStart && r.publishedAt >= new Date(windowStart.getTime() - windowDays * DAY_MS),
  );

  /**
   * A post with two platform snapshots arrives as two rows, so summing rows
   * gives the right impressions and the wrong post count. Posts are counted by
   * distinct id and metrics by row — the two questions genuinely have different
   * denominators.
   */
  const totals = (set: Row[]): z.infer<typeof Totals> => ({
    posts: new Set(set.map((r) => r.contentItemId)).size,
    impressions: set.reduce((n, r) => n + r.impressions, 0),
    views: set.reduce((n, r) => n + r.views, 0),
    engagements: set.reduce((n, r) => n + engagementsOf(r), 0),
  });

  const windowTotals = totals(inWindow);
  const previousTotals = totals(inPrevious);

  const change = (current: number, before: number): number | null =>
    before > 0 ? Math.round(((current - before) / before) * 100) : null;

  // Every day in the window, not only the days something happened: a chart that
  // skips empty days compresses a quiet week into a busy-looking one.
  const buckets = new Map<string, { posts: Set<string>; impressions: number; engagements: number }>();
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    buckets.set(dayKey(new Date(now.getTime() - i * DAY_MS)), {
      posts: new Set(),
      impressions: 0,
      engagements: 0,
    });
  }
  for (const row of inWindow) {
    const bucket = buckets.get(dayKey(row.publishedAt));
    // A row can fall a few minutes outside the day range the loop above built
    // (a window boundary mid-day); dropping it from the chart while keeping it in
    // the totals is the lesser of the two inconsistencies, since the totals are
    // what the KPI row states.
    if (!bucket) continue;
    bucket.posts.add(row.contentItemId);
    bucket.impressions += row.impressions;
    bucket.engagements += engagementsOf(row);
  }

  const byPlatformMap = new Map<string, number>();
  for (const row of inWindow) {
    if (!row.platform) continue;
    byPlatformMap.set(row.platform, (byPlatformMap.get(row.platform) ?? 0) + row.impressions);
  }
  const platformTotal = [...byPlatformMap.values()].reduce((n, v) => n + v, 0);

  const maturityCutoff = new Date(now.getTime() - MATURITY_HOURS * 3_600_000);
  const maturing = new Set(inWindow.filter((r) => r.publishedAt > maturityCutoff).map((r) => r.contentItemId));
  const measured = new Set(inWindow.filter((r) => r.platform).map((r) => r.contentItemId));
  const allPosts = new Set(inWindow.map((r) => r.contentItemId));

  return {
    windowDays,
    basis: 'publication_date',
    days: [...buckets.entries()].map(([date, b]) => ({
      date,
      posts: b.posts.size,
      impressions: b.impressions,
      engagements: b.engagements,
    })),
    totals: windowTotals,
    previous: previousTotals,
    impressionsChangePct: change(windowTotals.impressions, previousTotals.impressions),
    engagementsChangePct: change(windowTotals.engagements, previousTotals.engagements),
    byPlatform: [...byPlatformMap.entries()]
      .map(([platform, impressions]) => ({
        platform,
        impressions,
        share: platformTotal > 0 ? Number((impressions / platformTotal).toFixed(4)) : 0,
      }))
      .sort((a, b) => b.impressions - a.impressions),
    maturing: maturing.size,
    unmeasured: [...allPosts].filter((id) => !measured.has(id)).length,
  };
}

export const analyticsBrandSeries = defineTool({
  name: 'analytics.brand_series',
  version: 1,

  summary:
    'How this brand did over a trailing window: impressions and engagements per day, the same window ' +
    'before it for comparison, and the split by platform. Grouped by publication date, not measurement ' +
    'date — content_metrics holds current values, not history. Free.',

  input: BrandSeriesInput,
  output: BrandSeriesOutput,

  effect: 'read',
  autonomy: 'auto',
  // Same as `analytics.campaign_report`: performance is what a client is shown,
  // so a client role reads it. Not `viewer`-only, and not owner-only either.
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,
  surfaces: ['DASH-B-01'],

  async handler(input, ctx) {
    if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
        claimed: input.genomeId,
        selected: ctx.genomeId,
      });
    }

    // Twice the window in one read: the comparison period is the same length
    // immediately before, and two reads of adjacent ranges would let a post
    // published between them be counted twice or not at all.
    const rows = await ctx.db.analytics.publishedInWindow(ctx.orgId, input.genomeId, input.windowDays * 2);
    return aggregateSeries(rows, input.windowDays, new Date());
  },
});
