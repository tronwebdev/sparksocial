import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { toolFamily } from '@sparksocial/tools/defineTool';
import { aggregateSeries, analyticsBrandSeries } from '../src/brandSeries.js';

/**
 * `analytics.brand_series` — the cockpit's KPI row and Performance Insights panel.
 *
 * The aggregation is the part worth testing hard, because every number on the
 * dashboard is one of its fields and each has a specific way of being wrong: a
 * post with two platform snapshots double-counted as two posts, an empty day
 * omitted so a quiet week looks busy, a percentage against a zero baseline, or a
 * chart that quietly excludes what it could not measure.
 */

const NOW = new Date('2026-08-24T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function row(over: Partial<Parameters<typeof aggregateSeries>[0][number]> = {}) {
  return {
    contentItemId: 'c1',
    publishedAt: ago(1),
    impressions: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    views: 0,
    saves: 0,
    ...over,
  };
}

describe('aggregateSeries', () => {
  it('counts posts by distinct id and metrics by row', () => {
    // One post, two platform snapshots. Summing rows would report two posts.
    const out = aggregateSeries(
      [
        row({ contentItemId: 'c1', platform: 'instagram', impressions: 100, likes: 5 }),
        row({ contentItemId: 'c1', platform: 'facebook', impressions: 40, likes: 2 }),
      ],
      7,
      NOW,
    );

    expect(out.totals.posts).toBe(1);
    expect(out.totals.impressions).toBe(140);
    expect(out.totals.engagements).toBe(7);
  });

  it('counts engagements as interactions, not reach', () => {
    const out = aggregateSeries(
      [row({ platform: 'instagram', impressions: 900, views: 500, likes: 4, comments: 3, shares: 2, saves: 1 })],
      7,
      NOW,
    );
    // Views and impressions are reach; the four interaction columns are not.
    expect(out.totals.engagements).toBe(10);
    expect(out.totals.views).toBe(500);
  });

  it('returns every day in the window, including the empty ones', () => {
    const out = aggregateSeries([row({ publishedAt: ago(2), platform: 'instagram', impressions: 10 })], 7, NOW);

    // A chart that skipped empty days would compress a quiet week into a busy
    // one — seven days asked for, seven days returned.
    expect(out.days).toHaveLength(7);
    expect(out.days.filter((d) => d.posts > 0)).toHaveLength(1);
    expect(out.days.map((d) => d.date)).toEqual([...out.days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => d.date));
  });

  it('compares against the same length of time immediately before', () => {
    const out = aggregateSeries(
      [
        row({ contentItemId: 'now', publishedAt: ago(2), platform: 'instagram', impressions: 150 }),
        row({ contentItemId: 'before', publishedAt: ago(9), platform: 'instagram', impressions: 100 }),
      ],
      7,
      NOW,
    );

    expect(out.totals.impressions).toBe(150);
    expect(out.previous.impressions).toBe(100);
    expect(out.impressionsChangePct).toBe(50);
  });

  it('refuses to express growth from nothing as a percentage', () => {
    // "+100%" or "∞" against a zero baseline is the kind of number people
    // screenshot. Null says the comparison does not exist.
    const out = aggregateSeries([row({ platform: 'instagram', impressions: 500 })], 7, NOW);
    expect(out.previous.impressions).toBe(0);
    expect(out.impressionsChangePct).toBeNull();
    expect(out.engagementsChangePct).toBeNull();
  });

  it('reports a fall as a negative, not an absolute', () => {
    const out = aggregateSeries(
      [
        row({ contentItemId: 'now', publishedAt: ago(1), platform: 'instagram', impressions: 50 }),
        row({ contentItemId: 'before', publishedAt: ago(8), platform: 'instagram', impressions: 100 }),
      ],
      7,
      NOW,
    );
    expect(out.impressionsChangePct).toBe(-50);
  });

  it('splits by platform with shares that sum to one', () => {
    const out = aggregateSeries(
      [
        row({ contentItemId: 'a', platform: 'instagram', impressions: 750 }),
        row({ contentItemId: 'b', platform: 'facebook', impressions: 250 }),
      ],
      7,
      NOW,
    );

    expect(out.byPlatform).toEqual([
      { platform: 'instagram', impressions: 750, share: 0.75 },
      { platform: 'facebook', impressions: 250, share: 0.25 },
    ]);
  });

  it('flags posts still too young to have accumulated', () => {
    // The last day of any window is always understated. A reader who does not
    // know that reads a healthy week as a collapsing one.
    const out = aggregateSeries(
      [
        row({ contentItemId: 'fresh', publishedAt: new Date(NOW.getTime() - 3_600_000), platform: 'instagram', impressions: 5 }),
        row({ contentItemId: 'settled', publishedAt: ago(5), platform: 'instagram', impressions: 900 }),
      ],
      7,
      NOW,
    );
    expect(out.maturing).toBe(1);
  });

  it('keeps an unmeasured post in the total and says how many there are', () => {
    // Dropping it would make a published post indistinguishable from a day
    // nothing was published, which is the more misleading of the two readings.
    const out = aggregateSeries(
      [
        row({ contentItemId: 'measured', platform: 'instagram', impressions: 200 }),
        row({ contentItemId: 'unmeasured', publishedAt: ago(3) }),
      ],
      7,
      NOW,
    );

    expect(out.totals.posts).toBe(2);
    expect(out.unmeasured).toBe(1);
    // Not attributed to any platform, because none reported it.
    expect(out.byPlatform).toHaveLength(1);
  });

  it('names what it is grouped by', () => {
    // `content_metrics` is a current value, not a history — so this is grouped by
    // publication date, and says so rather than letting a caller assume a chart
    // of impressions over time.
    expect(aggregateSeries([], 7, NOW).basis).toBe('publication_date');
  });

  it('survives an empty brand', () => {
    const out = aggregateSeries([], 7, NOW);
    expect(out.totals).toEqual({ posts: 0, impressions: 0, views: 0, engagements: 0 });
    expect(out.days).toHaveLength(7);
    expect(out.byPlatform).toEqual([]);
    expect(out.maturing).toBe(0);
  });
});

describe('analytics.brand_series', () => {
  function ctx(over: { genomeId?: string; captured?: unknown[] } = {}): ToolCtx {
    const captured = over.captured ?? [];
    return {
      orgId: 'org_1',
      ...(over.genomeId ? { genomeId: over.genomeId } : {}),
      role: 'owner',
      approvalMode: 'autopublish',
      budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
      db: {
        analytics: {
          publishedInWindow: async (...args: unknown[]) => {
            captured.push(args);
            return [];
          },
        },
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    } as unknown as ToolCtx;
  }

  it('reads twice the window in one call, so no post falls between the periods', async () => {
    const captured: unknown[] = [];
    await analyticsBrandSeries.handler({ genomeId: 'gen_1', windowDays: 7 }, ctx({ captured }));
    expect(captured[0]).toEqual(['org_1', 'gen_1', 14]);
  });

  it('refuses a genome other than the one selected', async () => {
    const err = await analyticsBrandSeries
      .handler({ genomeId: 'gen_evil', windowDays: 7 }, ctx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is a free read, family analytics', () => {
    expect(analyticsBrandSeries.effect).toBe('read');
    expect(analyticsBrandSeries.autonomy).toBe('auto');
    expect(analyticsBrandSeries.idempotent).toBe(true);
    expect(toolFamily(analyticsBrandSeries.name)).toBe('analytics');
    // A client is shown performance; this is not owner-only.
    expect(analyticsBrandSeries.scopes).toContain('client');
  });
});
