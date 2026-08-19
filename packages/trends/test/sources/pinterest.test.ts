import { describe, expect, it, vi } from 'vitest';
import { createPinterestTrendSource } from '../../src/sources/pinterest.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response;
}

describe('createPinterestTrendSource', () => {
  it('sends the bearer token and maps growing keywords into trends', async () => {
    let capturedHeaders: RequestInit['headers'];
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return jsonResponse({ trends: [{ keyword: 'cottagecore kitchen', pct_growth_wow: 40 }] });
    });
    const source = createPinterestTrendSource({ accessToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ topic: 'cottagecore kitchen', source: 'pinterest' });
    expect((capturedHeaders as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('uses the vendor\'s own real growth percentage rather than forcing it to 0', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ trends: [{ keyword: 'x', pct_growth_wow: 60 }] }));
    const source = createPinterestTrendSource({ accessToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out[0]!.metrics.growth).toBeCloseTo(0.6);
  });

  it('names the likely cause in its own error message on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 403));
    const source = createPinterestTrendSource({ accessToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(source.fetch({ limit: 10 })).rejects.toThrow(/Trends API access/);
  });

  it('reports volume as 0 rather than guessing at an absolute figure the endpoint does not provide', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ trends: [{ keyword: 'x', pct_growth_wow: 10 }] }));
    const source = createPinterestTrendSource({ accessToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out[0]!.metrics.volume).toBe(0);
  });
});
