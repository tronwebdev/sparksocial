import { describe, expect, it, vi } from 'vitest';
import { createTikTokTrendSource, seriesGrowth } from '../../src/sources/tiktok.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response;
}

function listBody(items: unknown[]) {
  return { code: 0, msg: 'OK', data: { list: items } };
}

describe('seriesGrowth', () => {
  it('measures the change across the reported series', () => {
    expect(seriesGrowth([{ value: 100 }, { value: 150 }])).toBeCloseTo(0.5);
    expect(seriesGrowth([{ value: 200 }, { value: 100 }])).toBeCloseTo(-0.5);
  });

  it('returns null — not 0 — when there is nothing to compare, because those render differently', () => {
    expect(seriesGrowth(undefined)).toBeNull();
    expect(seriesGrowth([])).toBeNull();
    expect(seriesGrowth([{ value: 10 }])).toBeNull();
  });
});

describe('createTikTokTrendSource', () => {
  it('reads the hashtag leaderboard for a country and maps publish_cnt to volume', async () => {
    let url = '';
    const fetchImpl = vi.fn(async (u: string | URL) => {
      url = String(u);
      return jsonResponse(
        listBody([
          {
            hashtag_id: '1',
            hashtag_name: 'smallbusiness',
            publish_cnt: 480_000,
            video_views: 9_000_000,
            trend: [{ value: 100 }, { value: 260 }],
            industry_info: { value: 'Business Services' },
          },
        ]),
      );
    });

    const source = createTikTokTrendSource({ accessToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10, region: 'ng' });

    expect(url).toContain('country_code=NG');
    expect(out[0]).toMatchObject({ source: 'tiktok', topic: '#smallbusiness' });
    expect(out[0]!.metrics.volume).toBe(480_000);
    expect(out[0]!.regions).toEqual([{ code: 'NG', volume: 480_000 }]);
    expect(out[0]!.tags).toEqual(['smallbusiness', 'Business Services']);
  });

  /**
   * The claim worth a test of its own: this is one of two sources in the
   * package whose `growth` is a measurement rather than a zero, which is what
   * makes the card's accel arrow mean something for TikTok trends.
   */
  it('reports a real growth figure when the series is there, and 0 when it is not', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        listBody([
          { hashtag_name: 'measured', publish_cnt: 100, trend: [{ value: 50 }, { value: 125 }] },
          { hashtag_name: 'unmeasured', publish_cnt: 100 },
        ]),
      ),
    );
    const source = createTikTokTrendSource({ accessToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });

    expect(out.find((t) => t.topic === '#measured')!.metrics.growth).toBeCloseTo(1.5);
    expect(out.find((t) => t.topic === '#unmeasured')!.metrics.growth).toBe(0);
  });

  it('prefers the measured series over the rank proxy for velocity', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        listBody([
          // Top of the leaderboard, but the series says it is halving.
          { hashtag_name: 'falling', publish_cnt: 100, trend: [{ value: 200 }, { value: 100 }] },
          { hashtag_name: 'rising', publish_cnt: 100, trend: [{ value: 100 }, { value: 200 }] },
        ]),
      ),
    );
    const source = createTikTokTrendSource({ accessToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });

    /*
     * The property is that the measurement decides, so it is asserted against
     * the rank curve rather than against the sibling: position 0 would read 1.0
     * on rank alone and position 1 would read 0.15, and both items here land on
     * their series' value instead — the falling one well under its rank, the
     * rising one well over.
     */
    expect(out[0]!.metrics.velocity).toBeCloseTo(0.25);
    expect(out[0]!.metrics.velocity).toBeLessThan(1);
    expect(out[1]!.metrics.velocity).toBeCloseTo(1);
    expect(out[1]!.metrics.velocity).toBeGreaterThan(0.15);
  });

  it('says an auth failure here usually means an expired session, not a wrong secret', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 401));
    const source = createTikTokTrendSource({ accessToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(source.fetch({ limit: 5 })).rejects.toThrow(/expired/i);
  });

  it('surfaces a non-zero body code rather than reading an empty list as "no trends"', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 40100, msg: 'invalid session' }));
    const source = createTikTokTrendSource({ accessToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(source.fetch({ limit: 5 })).rejects.toThrow(/40100/);
  });
});
