import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { createAyrshareAnalyticsClient, normalizeAyrshareMetrics } from '../src/ayrshare.js';

/**
 * There is no live Ayrshare account to pin the exact response shape against
 * (see `ayrshare.ts`'s header comment), so what matters here is: the request
 * is well-formed, a bad response fails loudly, and the normalizer picks up
 * whichever alias a platform happens to use rather than defaulting silently
 * to zero when the vendor's field name differs from the first guess.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('request shape', () => {
  it('posts the post id and platform, authorized with a bearer token', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ instagram: {} }));
    const client = createAyrshareAnalyticsClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await client.fetchMetrics({ platform: 'instagram', externalId: 'post_123' });

    expect(f.mock.calls[0]![0]).toBe('https://api.ayrshare.com/api/analytics/post');
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ id: 'post_123', platforms: ['instagram'] });
  });
});

describe('transport', () => {
  it('reports an upstream failure on a non-2xx response', async () => {
    const f = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const client = createAyrshareAnalyticsClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    await expect(client.fetchMetrics({ platform: 'instagram', externalId: 'p1' })).rejects.toThrow(ToolError);
  });
});

describe('normalizeAyrshareMetrics', () => {
  it('reads metrics from a per-platform block keyed by platform name', () => {
    const body = { instagram: { likeCount: 12, commentsCount: 3, shareCount: 1, viewCount: 500, impressionsCount: 900 } };
    expect(normalizeAyrshareMetrics(body, 'instagram')).toMatchObject({
      likes: 12,
      comments: 3,
      shares: 1,
      views: 500,
      impressions: 900,
      raw: body,
    });
  });

  it('falls back to the root object when there is no per-platform block', () => {
    const body = { likes: 5, comments: 2, shares: 0, views: 40, impressions: 60 };
    expect(normalizeAyrshareMetrics(body, 'x')).toMatchObject({ likes: 5, comments: 2, shares: 0, views: 40, impressions: 60 });
  });

  it('tries the documented aliases for each metric before giving up', () => {
    // A different platform naming its counts differently must not read as zero.
    const body = { tiktok: { favoriteCount: 7, commentCount: 4, repostCount: 2, playCount: 1000, impressionCount: 1500 } };
    expect(normalizeAyrshareMetrics(body, 'tiktok')).toMatchObject({
      likes: 7,
      comments: 4,
      shares: 2,
      views: 1000,
      impressions: 1500,
    });
  });

  it('defaults an unrecognized field to zero rather than throwing', () => {
    expect(normalizeAyrshareMetrics({}, 'instagram')).toEqual({
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
      impressions: 0,
      saves: 0,
      raw: {},
    });
  });

  it('survives a response that is not an object', () => {
    expect(normalizeAyrshareMetrics(null, 'instagram')).toMatchObject({ likes: 0, comments: 0, raw: null });
    expect(normalizeAyrshareMetrics('unexpected', 'instagram')).toMatchObject({ likes: 0, raw: 'unexpected' });
  });
});
