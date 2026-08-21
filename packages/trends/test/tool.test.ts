import { describe, expect, it } from 'vitest';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx, TrendWatchlistEntry } from '@sparksocial/tools';
import { createStubTrendSource } from '../src/trend.js';
import {
  makeTrendRank,
  makeTrendFetch,
  makeTrendDetail,
  makeTrendSafetyFilter,
  makeTrendRepurpose,
  makeTrendReshare,
  makeTrendWatchlist,
  makeTrendExplain,
  makeTrendObserve,
} from '../src/tool.js';

/**
 * The `trend.*` family beyond `trend.rank` — DISC-01/DISC-02, plan §12 P5.
 * `tr_rising` (craft) matches the barbershop genome; `tr_workflow` matches the
 * SaaS genome; `tr_unsafe` carries a `controversy` tag, which `assessSafety`
 * excludes for every genome regardless of compliance profile — the one
 * trend in the stub fixture that's safe to use as "the unsafe one" without
 * needing a regulated genome.
 */

const barber = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber')!.genome;
const saas = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!.genome;
const source = createStubTrendSource();

function watchlistStore() {
  const rows: (TrendWatchlistEntry & { genomeId: string })[] = [];
  return {
    rows,
    store: {
      async add({ genomeId, trendId, source: src, topic, note }: any) {
        const existing = rows.find((r) => r.genomeId === genomeId && r.trendId === trendId);
        if (existing) {
          if (note) existing.note = note;
          return existing;
        }
        const row = { id: `w_${rows.length}`, genomeId, trendId, source: src, topic, createdAt: new Date(), ...(note ? { note } : {}) };
        rows.push(row);
        return row;
      },
      async remove({ genomeId, trendId }: any) {
        const idx = rows.findIndex((r) => r.genomeId === genomeId && r.trendId === trendId);
        if (idx >= 0) rows.splice(idx, 1);
      },
      async list(genomeId: string) {
        return rows.filter((r) => r.genomeId === genomeId);
      },
    },
  };
}

/**
 * The §8.9 metric history, in memory. Buckets to the hour and lets the last
 * write in a bucket win, like both real implementations — a fake that recorded
 * every call would hide the fact that repeated `trend.rank` calls are supposed
 * to collapse into one chart point.
 */
function observationStore() {
  const rows = new Map<string, any>();
  return {
    rows,
    store: {
      async record(observations: any[]) {
        for (const o of observations) {
          const at = new Date(o.observedAt.getTime());
          at.setUTCMinutes(0, 0, 0);
          rows.set(JSON.stringify([o.source, o.trendId, at.toISOString()]), { ...o, observedAt: at });
        }
      },
      async series({ source: src, trendId, sinceDays }: any) {
        const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
        return [...rows.values()]
          .filter((o) => o.source === src && o.trendId === trendId && o.observedAt.getTime() >= since)
          .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
      },
    },
  };
}

function ctx(over: Partial<ToolCtx> = {}, observations = observationStore().store): ToolCtx {
  const { store } = watchlistStore();
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: { get: async (id: string) => (id === 'gen_barber' ? barber : id === 'gen_saas' ? saas : undefined) },
      assets: { inventory: async () => ({}) },
      content: { get: async () => undefined },
      trends: store,
      trendObservations: observations,
    } as unknown as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  } as unknown as ToolCtx;
}

describe('trend.fetch', () => {
  it('returns the raw feed, unranked', async () => {
    const tool = makeTrendFetch(source);
    const out = await tool.handler({ limit: 20 }, ctx());
    expect(out.trends.length).toBeGreaterThan(0);
    expect(out.source).toBe('stub');
  });

  it('is read, auto, and open to approvers too', () => {
    const tool = makeTrendFetch(source);
    expect(tool.effect).toBe('read');
    expect(tool.scopes).toContain('approver');
  });
});

describe('trend.detail', () => {
  it('returns the full breakdown for a known trend', async () => {
    const tool = makeTrendDetail(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising', seriesDays: 14 }, ctx());
    expect(out.trend.id).toBe('tr_rising');
    expect(out.safety.safe).toBe(true);
    expect(out.score).toBeGreaterThan(0);
    expect(out.why.summary).toBeTruthy();
  });

  it('404s for an unknown trend', async () => {
    const tool = makeTrendDetail(source);
    await expect(tool.handler({ genomeId: 'gen_barber', trendId: 'nope', seriesDays: 14 }, ctx())).rejects.toThrow(ToolError);
  });

  it('404s for an unknown genome', async () => {
    const tool = makeTrendDetail(source);
    await expect(tool.handler({ genomeId: 'gen_ghost', trendId: 'tr_rising', seriesDays: 14 }, ctx())).rejects.toThrow(ToolError);
  });
});

describe('trend.detail — §8.9 time series', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  it('records what it just read, so opening the screen puts today on the chart', async () => {
    const obs = observationStore();
    const tool = makeTrendDetail(source);
    await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising', seriesDays: 14 }, ctx({}, obs.store));
    expect(obs.rows.size).toBe(1);
  });

  it('returns no trajectory from a single observation', async () => {
    // The trap this guards: a one-point series charted as a flat line reads as
    // "stable", when the truth is "we have never seen this before".
    const obs = observationStore();
    const tool = makeTrendDetail(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising', seriesDays: 14 }, ctx({}, obs.store));
    expect(out.series).toHaveLength(1);
    expect(out.trajectory).toBeNull();
  });

  it('returns the history oldest first', async () => {
    const obs = observationStore();
    await obs.store.record([
      { source: 'tiktok', trendId: 'tr_rising', topic: 'x', observedAt: hoursAgo(48), volume: 10, velocity: 0.5, saturation: 0.1, growth: 1 },
      { source: 'tiktok', trendId: 'tr_rising', topic: 'x', observedAt: hoursAgo(24), volume: 20, velocity: 0.5, saturation: 0.2, growth: 1 },
    ]);
    const tool = makeTrendDetail(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising', seriesDays: 14 }, ctx({}, obs.store));
    const times = out.series.map((point) => Date.parse(point.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  /**
   * These fixtures seed the *past* only. `trend.detail` records the live metrics
   * as part of the call, so the stub's own numbers are always the newest point —
   * a fixture that also seeds a recent point contradicting them would be
   * measuring the fixture rather than the code. `tr_rising` sits at saturation
   * 0.18, so seeding below it means cooling and above it means climbing.
   */
  const seed = (saturation: number, volume: number, hours = 72) =>
    [{ source: 'tiktok', trendId: 'tr_rising', topic: 'x', observedAt: hoursAgo(hours), volume, velocity: 0.8, saturation, growth: 2 }];

  it('calls a trend with rising saturation closing, whatever its volume is doing', async () => {
    // Volume is the tempting signal and the wrong one — a trend can keep growing
    // in reach right up to the point where there is nothing left to say, which
    // is exactly the trap §8.9's problem statement describes. Here volume grows
    // 1200× and the verdict is still "closing".
    const obs = observationStore();
    await obs.store.record(seed(0.05, 100));
    const tool = makeTrendDetail(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising', seriesDays: 14 }, ctx({}, obs.store));
    expect(out.trajectory!.direction).toBe('cooling');
    expect(out.trajectory!.volumeChange).toBeGreaterThan(1);
  });

  it('calls falling saturation still opening', async () => {
    const obs = observationStore();
    await obs.store.record(seed(0.6, 100));
    const tool = makeTrendDetail(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising', seriesDays: 14 }, ctx({}, obs.store));
    expect(out.trajectory!.direction).toBe('climbing');
  });

  it('does not call a small wobble a direction', async () => {
    const obs = observationStore();
    // 0.19 against the stub's live 0.18 — inside the noise band.
    await obs.store.record(seed(0.19, 100));
    const tool = makeTrendDetail(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising', seriesDays: 14 }, ctx({}, obs.store));
    expect(out.trajectory!.direction).toBe('flat');
  });

  it('puts the trajectory in the why, ahead of the score', async () => {
    // §7.3 requires the trend decision to carry a visible reason. Once history
    // exists, "cooling" is the most decision-relevant part of it.
    const obs = observationStore();
    await obs.store.record(seed(0.05, 100));
    const tool = makeTrendDetail(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising', seriesDays: 14 }, ctx({}, obs.store));
    expect(out.why.factors[0]!.label).toBe('trajectory');
    expect(out.why.summary).toMatch(/closing/i);
  });

  it('still returns the trend when the history store is unavailable', async () => {
    // Losing the chart is a degraded detail screen. Losing the screen because
    // the chart is unavailable is a worse trade than not having the chart.
    const broken = {
      record: async () => {
        throw new Error('history down');
      },
      series: async () => {
        throw new Error('history down');
      },
    };
    const tool = makeTrendDetail(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising', seriesDays: 14 }, ctx({}, broken as never));
    expect(out.trend.id).toBe('tr_rising');
    expect(out.series).toEqual([]);
    expect(out.trajectory).toBeNull();
  });
});

describe('trend.rank — sampling', () => {
  it('records every trend it fetched, including the ones it excluded', async () => {
    // A trend this brand cannot touch is still a trend whose history another
    // brand's detail screen will want.
    const obs = observationStore();
    const tool = makeTrendRank(source);
    const out = await tool.handler({ genomeId: 'gen_barber', limit: 2 }, ctx({}, obs.store));
    expect(out.excluded.length).toBeGreaterThan(0);
    expect(obs.rows.size).toBe(6); // every trend in the stub source
  });

  it('collapses repeated calls within the hour into one point per trend', async () => {
    const obs = observationStore();
    const tool = makeTrendRank(source);
    const c = ctx({}, obs.store);
    await tool.handler({ genomeId: 'gen_barber', limit: 2 }, c);
    await tool.handler({ genomeId: 'gen_barber', limit: 2 }, c);
    await tool.handler({ genomeId: 'gen_barber', limit: 2 }, c);
    expect(obs.rows.size).toBe(6);
  });

  it('still ranks when recording fails', async () => {
    const broken = {
      record: async () => {
        throw new Error('history down');
      },
      series: async () => [],
    };
    const tool = makeTrendRank(source);
    const out = await tool.handler({ genomeId: 'gen_barber', limit: 2 }, ctx({}, broken as never));
    expect(out.trends.length).toBeGreaterThan(0);
  });
});

describe('trend.observe', () => {
  it('samples the source without a genome, because the rows are shared', async () => {
    const obs = observationStore();
    const tool = makeTrendObserve(source);
    const out = await tool.handler({ limit: 50 }, ctx({}, obs.store));
    expect(out.observed).toBe(6);
    expect(obs.rows.size).toBe(6);
    expect(Object.keys(tool.input.parse({ limit: 50 }))).not.toContain('genomeId');
  });

  it('is idempotent across a repeat within the hour', async () => {
    const obs = observationStore();
    const tool = makeTrendObserve(source);
    await tool.handler({ limit: 50 }, ctx({}, obs.store));
    await tool.handler({ limit: 50 }, ctx({}, obs.store));
    expect(obs.rows.size).toBe(6);
    expect(tool.idempotent).toBe(true);
  });

  it('fails loudly when the history store is unavailable', async () => {
    // Unlike the read paths, a scheduled sampler that swallowed a write failure
    // would report success while the series quietly stopped growing.
    const broken = {
      record: async () => {
        throw new Error('history down');
      },
      series: async () => [],
    };
    const tool = makeTrendObserve(source);
    await expect(tool.handler({ limit: 50 }, ctx({}, broken as never))).rejects.toThrow('history down');
  });

  it('is not on any screen', () => {
    expect(makeTrendObserve(source).surfaces ?? []).toEqual([]);
  });
});

describe('trend.safety_filter', () => {
  it('flags a trend already known to be unsafe, by id', async () => {
    const tool = makeTrendSafetyFilter(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trends: [{ trendId: 'tr_unsafe', tags: [] }] }, ctx());
    expect(out.results[0]!.safe).toBe(false);
  });

  it('checks an ad-hoc topic not in the feed', async () => {
    const tool = makeTrendSafetyFilter(source);
    const out = await tool.handler(
      { genomeId: 'gen_barber', trends: [{ topic: 'a tragedy in the news', tags: ['tragedy'] }] },
      ctx(),
    );
    expect(out.results[0]!.safe).toBe(false);
    expect(out.results[0]!.topic).toBe('a tragedy in the news');
  });

  it('refuses an entry with neither a resolvable trendId nor a topic', async () => {
    const tool = makeTrendSafetyFilter(source);
    await expect(
      tool.handler({ genomeId: 'gen_barber', trends: [{ trendId: 'nope', tags: [] }] }, ctx()),
    ).rejects.toThrow(ToolError);
  });
});

describe('trend.repurpose', () => {
  it('suggests an available playbook for a relevant, safe trend', async () => {
    const tool = makeTrendRepurpose(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising' }, ctx());
    expect(out.suggestion).not.toBeNull();
    expect(out.suggestion!.intent).toContain('Before-and-after in one continuous shot');
    expect(out.suggestion!.playbookId).toBeTruthy();
    expect(out.why.evidence[0]).toMatchObject({ kind: 'trend', id: 'tr_rising' });
  });

  it('refuses to suggest anything for an unsafe trend — a null suggestion, not a thrown error', async () => {
    const tool = makeTrendRepurpose(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_unsafe' }, ctx());
    expect(out.suggestion).toBeNull();
    expect(out.why.summary).toMatch(/not safe/i);
  });

  it('404s for an unknown trend', async () => {
    const tool = makeTrendRepurpose(source);
    await expect(tool.handler({ genomeId: 'gen_barber', trendId: 'nope' }, ctx())).rejects.toThrow(ToolError);
  });
});

describe('trend.reshare', () => {
  const itemCtx = () =>
    ctx({
      db: {
        genomes: { get: async () => barber },
        content: {
          get: async (id: string) =>
            id === 'item_1'
              ? {
                  id: 'item_1',
                  genomeId: 'gen_barber',
                  mode: 'assemble' as const,
                  playbookId: 'pb_before_after',
                  status: 'published',
                  createdAt: new Date(),
                  copy: [
                    { kind: 'asset', beatId: 'b1', assetId: 'asset_1', role: 'transformation', caption: null },
                    { kind: 'text', beatId: 'b2', text: 'caption' },
                  ],
                }
              : undefined,
        },
      } as unknown as ToolCtx['db'],
    });

  it('pulls referenced assets from the existing item and suggests reuse', async () => {
    const tool = makeTrendReshare(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising', contentItemId: 'item_1' }, itemCtx());
    expect(out.suggestion).toEqual({
      playbookId: 'pb_before_after',
      referencedAssetIds: ['asset_1'],
      intent: expect.stringContaining('Before-and-after'),
    });
  });

  it('404s for a missing or out-of-scope content item', async () => {
    const tool = makeTrendReshare(source);
    await expect(
      tool.handler({ genomeId: 'gen_barber', trendId: 'tr_rising', contentItemId: 'ghost' }, itemCtx()),
    ).rejects.toThrow(ToolError);
  });
});

describe('trend.watchlist', () => {
  it('adds, lists, then removes a trend', async () => {
    const { store } = watchlistStore();
    const c = ctx({ db: { genomes: { get: async () => barber }, trends: store } as unknown as ToolCtx['db'] });
    const tool = makeTrendWatchlist(source);

    const afterAdd = await tool.handler({ genomeId: 'gen_barber', action: 'add', trendId: 'tr_rising' }, c);
    expect(afterAdd.watchlist).toHaveLength(1);
    expect(afterAdd.watchlist[0]!.topic).toBe('Before-and-after in one continuous shot');
    expect(afterAdd.watchlist[0]!.source).toBe('tiktok');

    const afterList = await tool.handler({ genomeId: 'gen_barber', action: 'list' }, c);
    expect(afterList.watchlist).toHaveLength(1);

    const afterRemove = await tool.handler({ genomeId: 'gen_barber', action: 'remove', trendId: 'tr_rising' }, c);
    expect(afterRemove.watchlist).toHaveLength(0);
  });

  it('watches a topic the source does not recognise, given an explicit topic', async () => {
    const { store } = watchlistStore();
    const c = ctx({ db: { genomes: { get: async () => barber }, trends: store } as unknown as ToolCtx['db'] });
    const tool = makeTrendWatchlist(source);
    const out = await tool.handler({ genomeId: 'gen_barber', action: 'add', trendId: 'not_in_feed', topic: 'my own topic' }, c);
    expect(out.watchlist[0]!.topic).toBe('my own topic');
    expect(out.watchlist[0]!.source).toBe('manual');
  });

  it('refuses to add a trend the source does not know with no topic given', async () => {
    const { store } = watchlistStore();
    const c = ctx({ db: { genomes: { get: async () => barber }, trends: store } as unknown as ToolCtx['db'] });
    const tool = makeTrendWatchlist(source);
    await expect(tool.handler({ genomeId: 'gen_barber', action: 'add', trendId: 'not_in_feed' }, c)).rejects.toThrow(ToolError);
  });

  it('is a write tool, not open to viewers', () => {
    const tool = makeTrendWatchlist(source);
    expect(tool.effect).toBe('write');
    expect(tool.scopes).not.toContain('viewer');
  });
});

describe('trend.explain', () => {
  it('explains why a trend ranked where it did', async () => {
    const tool = makeTrendExplain(source);
    const out = await tool.handler({ genomeId: 'gen_saas', trendId: 'tr_workflow' }, ctx());
    expect(out.why.summary).toContain('Showing one workflow end to end, no narration');
    expect(out.why.evidence[0]).toMatchObject({ id: 'tr_workflow' });
  });

  it('explains a safety exclusion in plain terms', async () => {
    const tool = makeTrendExplain(source);
    const out = await tool.handler({ genomeId: 'gen_barber', trendId: 'tr_unsafe' }, ctx());
    expect(out.why.summary).toMatch(/not safe/i);
  });
});

describe('trend.rank — registered alongside the rest of the family', () => {
  it('still ranks, unaffected by the new tools', async () => {
    const tool = makeTrendRank(source);
    const out = await tool.handler({ genomeId: 'gen_barber', limit: 5 }, ctx());
    expect(out.trends.length).toBeGreaterThan(0);
  });
});
