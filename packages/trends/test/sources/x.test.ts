import { describe, expect, it, vi } from 'vitest';
import { createXTrendSource, woeidFor, WOEID_BY_REGION } from '../../src/sources/x.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response;
}

const BODY = {
  data: [
    { trend_name: '#BudgetSpeech', tweet_count: 412_000 },
    { trend_name: 'Load shedding', tweet_count: 88_000 },
    { trend_name: '#SmallBusiness', tweet_count: 4_100 },
  ],
};

describe('woeidFor', () => {
  it('translates an ISO code, and falls back to the configured default for one it cannot name', () => {
    expect(woeidFor('za', 1)).toBe(WOEID_BY_REGION.ZA);
    expect(woeidFor('NG', 1)).toBe(WOEID_BY_REGION.NG);
    // Worldwide is the honest superset of "a region we cannot name", not an error.
    expect(woeidFor('atlantis', 1)).toBe(1);
    expect(woeidFor(undefined, 23424977)).toBe(23424977);
  });
});

describe('createXTrendSource', () => {
  it('calls the woeid endpoint with the bearer token and maps tweet_count to volume', async () => {
    let url = '';
    let auth = '';
    const fetchImpl = vi.fn(async (u: string | URL, init?: RequestInit) => {
      url = String(u);
      auth = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '');
      return jsonResponse(BODY);
    });

    const source = createXTrendSource({ bearerToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10, region: 'ZA' });

    expect(url).toContain(`/2/trends/by/woeid/${WOEID_BY_REGION.ZA}`);
    expect(auth).toBe('Bearer tok');
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ source: 'x', topic: '#BudgetSpeech' });
    expect(out[0]!.metrics.volume).toBe(412_000);
    expect(out[0]!.regions).toEqual([{ code: 'ZA', volume: 412_000 }]);
  });

  it('derives velocity from position and saturation from count — never one from the other', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(BODY));
    const source = createXTrendSource({ bearerToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });

    // Velocity follows the response order.
    expect(out[0]!.metrics.velocity).toBeGreaterThan(out[1]!.metrics.velocity);
    expect(out[1]!.metrics.velocity).toBeGreaterThan(out[2]!.metrics.velocity);
    // Saturation follows the count: 412k posts is a done topic, 4.1k is not.
    expect(out[0]!.metrics.saturation).toBeGreaterThan(out[2]!.metrics.saturation);
    // And growth stays "no signal" — a single read cannot see a change.
    expect(out.every((t) => t.metrics.growth === 0)).toBe(true);
  });

  it('records no region for a worldwide fetch, rather than inventing a country', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(BODY));
    const source = createXTrendSource({ bearerToken: 'tok', woeid: 1, fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out[0]!.regions).toEqual([]);
    expect(out[0]!.region).toBeUndefined();
  });

  it('turns a hashtag into a tag, which is what relevance is scored on', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(BODY));
    const source = createXTrendSource({ bearerToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out[0]!.tags).toEqual(['BudgetSpeech']);
    expect(out[1]!.tags).toEqual([]);
  });

  it('explains a 403 as the access tier rather than a bad token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 403));
    const source = createXTrendSource({ bearerToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(source.fetch({ limit: 5 })).rejects.toThrow(/access tier/i);
  });

  it('surfaces a body-level error instead of returning an empty feed', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: [{ detail: 'Unsupported woeid' }] }));
    const source = createXTrendSource({ bearerToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(source.fetch({ limit: 5 })).rejects.toThrow(/Unsupported woeid/);
  });
});
