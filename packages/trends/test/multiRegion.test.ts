import { describe, expect, it, vi } from 'vitest';
import { createMultiRegionTrendSource } from '../src/multiRegion.js';
import type { Trend, TrendSource } from '../src/trend.js';

/**
 * THE REGION BREAKDOWN — `DISC-02`'s Geo & Audience panel.
 *
 * The panel used to say "no source returns a per-country breakdown", which was
 * true of every vendor and false of the product: a breakdown is something this
 * package composes by asking each region separately. These are the properties
 * that make the composed answer trustworthy — that a volume is summed only when
 * the vendor reported it *per region*, that rates are never combined, that one
 * region's failure does not empty the feed, and that a single-region deployment
 * pays nothing for the feature.
 */

const trend = (over: Partial<Trend> & { id: string }): Trend => ({
  source: 'youtube',
  topic: 'a topic',
  tags: [],
  metrics: { volume: 1000, velocity: 0.6, saturation: 0.3, growth: 0 },
  samples: [],
  regions: [],
  language: 'en',
  ...over,
});

function sourceReturning(byRegion: Record<string, Trend[]>): TrendSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: 'fake',
    calls,
    async fetch({ region }) {
      calls.push(region ?? 'none');
      const out = byRegion[region ?? 'none'];
      if (!out) throw new Error(`no fixture for ${region}`);
      return out;
    },
  };
}

describe('createMultiRegionTrendSource', () => {
  it('does not wrap anything for a single region — the feature costs nothing when unused', async () => {
    const source = sourceReturning({ US: [trend({ id: 'a' })] });
    expect(createMultiRegionTrendSource(source, { regions: ['US'] })).toBe(source);
    expect(createMultiRegionTrendSource(source, { regions: [] })).toBe(source);
  });

  it('sums only the volumes the adapter attributed to a region', async () => {
    /*
     * The attributing case: Google Trends reports `approx_traffic` per geo, so
     * its adapter sets `regions: [{ code, volume }]` itself and 20k US + 7k UK
     * genuinely is 27k.
     */
    const source = sourceReturning({
      US: [
        trend({
          id: 'a',
          source: 'google',
          topic: 'taxes',
          metrics: { volume: 20_000, velocity: 0.6, saturation: 0.3, growth: 0 },
          regions: [{ code: 'US', volume: 20_000 }],
        }),
      ],
      GB: [
        trend({
          id: 'a',
          source: 'google',
          topic: 'taxes',
          metrics: { volume: 7_000, velocity: 0.9, saturation: 0.1, growth: 0 },
          regions: [{ code: 'GB', volume: 7_000 }],
        }),
      ],
    });

    const out = await createMultiRegionTrendSource(source, { regions: ['US', 'GB'] }).fetch({ limit: 10 });

    expect(source.calls).toEqual(['US', 'GB']);
    expect(out).toHaveLength(1);
    expect(out[0]!.metrics.volume).toBe(27_000);
    // Rates are not combined — adding 0–1 rates is meaningless, so the primary
    // region's reading stands.
    expect(out[0]!.metrics.velocity).toBe(0.6);
    expect(out[0]!.metrics.saturation).toBe(0.3);
    // And the split that produced the sum is recorded, largest first.
    expect(out[0]!.regions).toEqual([
      { code: 'US', volume: 20_000 },
      { code: 'GB', volume: 7_000 },
    ]);
  });

  /**
   * The bug this rule exists to prevent. YouTube's `viewCount` is global: the
   * US chart and the UK chart return the same video with the same number, and
   * the first version of this merger added them — reporting 129M views for a
   * 64.6M-view video. An adapter that cannot attribute its volume says so by
   * leaving `regions` empty, and then the merge records *where* without
   * claiming *how much*.
   */
  it('does not sum a global volume reported once per region', async () => {
    const global = { volume: 64_610_622, velocity: 0.6, saturation: 0.3, growth: 0 };
    const source = sourceReturning({
      US: [trend({ id: 'a', metrics: global })],
      GB: [trend({ id: 'a', metrics: global })],
    });

    const out = await createMultiRegionTrendSource(source, { regions: ['US', 'GB'] }).fetch({ limit: 10 });

    expect(out).toHaveLength(1);
    expect(out[0]!.metrics.volume).toBe(64_610_622);
    expect(out[0]!.regions).toEqual([{ code: 'US' }, { code: 'GB' }]);
  });

  it('keeps a trend that only exists in one region, with only that region', async () => {
    const source = sourceReturning({
      US: [trend({ id: 'a' })],
      NG: [trend({ id: 'b', metrics: { volume: 400, velocity: 0.5, saturation: 0.2, growth: 0 } })],
    });
    const out = await createMultiRegionTrendSource(source, { regions: ['US', 'NG'] }).fetch({ limit: 10 });

    expect(out.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(out.find((t) => t.id === 'b')!.regions).toEqual([{ code: 'NG' }]);
  });

  it('merges Google’s per-geo ids on the topic, since its ids embed the geo', async () => {
    const source = sourceReturning({
      US: [trend({ id: 'google::US::taxes', source: 'google', topic: 'taxes' })],
      GB: [trend({ id: 'google::GB::taxes', source: 'google', topic: 'taxes' })],
    });
    const out = await createMultiRegionTrendSource(source, { regions: ['US', 'GB'] }).fetch({ limit: 10 });

    expect(out).toHaveLength(1);
    expect(out[0]!.regions.map((r) => r.code).sort()).toEqual(['GB', 'US']);
  });

  it('one region failing degrades to the others rather than emptying the feed', async () => {
    const onRegionError = vi.fn();
    const source: TrendSource = {
      name: 'flaky',
      async fetch({ region }) {
        if (region === 'GB') throw new Error('429 from the vendor');
        return [trend({ id: 'a' })];
      },
    };

    const out = await createMultiRegionTrendSource(source, { regions: ['US', 'GB'], onRegionError }).fetch({ limit: 10 });

    expect(out).toHaveLength(1);
    expect(out[0]!.regions).toEqual([{ code: 'US' }]);
    expect(onRegionError).toHaveBeenCalledWith('GB', expect.any(Error));
  });

  it('fills a missing thumbnail from a later region instead of overwriting a present one', async () => {
    const source = sourceReturning({
      US: [trend({ id: 'a' })],
      GB: [trend({ id: 'a', media: { url: 'https://img.example/one.jpg', kind: 'image' } })],
    });
    const out = await createMultiRegionTrendSource(source, { regions: ['US', 'GB'] }).fetch({ limit: 10 });
    expect(out[0]!.media).toEqual({ url: 'https://img.example/one.jpg', kind: 'image' });
  });

  it('deduplicates and normalises the configured region list', async () => {
    const source = sourceReturning({ US: [trend({ id: 'a' })], GB: [trend({ id: 'a' })] });
    const wrapped = createMultiRegionTrendSource(source, { regions: ['us', 'US', ' gb '] });
    await wrapped.fetch({ limit: 10 });
    expect(source.calls).toEqual(['US', 'GB']);
    expect(wrapped.name).toBe('fake@US+GB');
  });
});
