import { describe, expect, it, vi } from 'vitest';
import { createRedditTrendSource } from '../../src/sources/reddit.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response;
}

function tokenBody() {
  return { access_token: 'tok_abc', expires_in: 3600 };
}

function listingBody(posts: Array<Partial<{ id: string; title: string; score: number; num_comments: number; created_utc: number; permalink: string; stickied: boolean; over_18: boolean; link_flair_text: string | null }>>) {
  return {
    data: {
      children: posts.map((p) => ({
        data: {
          id: 'p1',
          title: 'A post',
          score: 100,
          num_comments: 10,
          created_utc: Date.now() / 1000 - 3600,
          permalink: '/r/test/comments/p1',
          stickied: false,
          over_18: false,
          link_flair_text: null,
          ...p,
        },
      })),
    },
  };
}

describe('createRedditTrendSource', () => {
  it('authenticates then fetches configured subreddits, mapping posts to trends', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('access_token')) return jsonResponse(tokenBody());
      return jsonResponse(listingBody([{ id: 'abc', title: 'Rising thing' }]));
    });

    const source = createRedditTrendSource({
      clientId: 'id',
      clientSecret: 'secret',
      userAgent: 'test-agent/1.0',
      subreddits: ['marketing'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const out = await source.fetch({ limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'abc', source: 'reddit', topic: 'Rising thing' });
    expect(out[0]!.samples[0]!.url).toBe('https://reddit.com/r/test/comments/p1');
    expect(calls.some((c) => c.includes('access_token'))).toBe(true);
    expect(calls.some((c) => c.includes('/r/marketing/hot'))).toBe(true);
  });

  it('filters out stickied and over-18 posts', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('access_token')) return jsonResponse(tokenBody());
      return jsonResponse(
        listingBody([
          { id: 'pinned', title: 'Pinned', stickied: true },
          { id: 'nsfw', title: 'NSFW', over_18: true },
          { id: 'real', title: 'Real trend' },
        ]),
      );
    });
    const source = createRedditTrendSource({
      clientId: 'id', clientSecret: 'secret', userAgent: 'ua', subreddits: ['x'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await source.fetch({ limit: 10 });
    expect(out.map((t) => t.id)).toEqual(['real']);
  });

  it('one failing subreddit does not take down the others', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('access_token')) return jsonResponse(tokenBody());
      if (u.includes('/r/bad/')) return jsonResponse({}, false, 403);
      return jsonResponse(listingBody([{ id: 'ok1', title: 'Fine' }]));
    });
    const source = createRedditTrendSource({
      clientId: 'id', clientSecret: 'secret', userAgent: 'ua', subreddits: ['bad', 'good'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await source.fetch({ limit: 10 });
    expect(out.map((t) => t.id)).toEqual(['ok1']);
  });

  it('caches the OAuth token across calls instead of re-authenticating every time', async () => {
    let tokenCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('access_token')) {
        tokenCalls++;
        return jsonResponse(tokenBody());
      }
      return jsonResponse(listingBody([{ id: 'x', title: 'x' }]));
    });
    const source = createRedditTrendSource({
      clientId: 'id', clientSecret: 'secret', userAgent: 'ua', subreddits: ['a'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await source.fetch({ limit: 5 });
    await source.fetch({ limit: 5 });
    expect(tokenCalls).toBe(1);
  });
});
