import { describe, expect, it, vi } from 'vitest';
import { createProductHuntTrendSource } from '../../src/sources/producthunt.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response;
}

function graphqlBody(posts: Array<Partial<{ id: string; name: string; tagline: string; votesCount: number; commentsCount: number; createdAt: string; url: string }>>) {
  return {
    data: {
      posts: {
        edges: posts.map((p) => ({
          node: {
            id: 'p1', name: 'Product', tagline: 'A tagline', votesCount: 50, commentsCount: 5,
            createdAt: new Date(Date.now() - 3_600_000).toISOString(), url: 'https://producthunt.com/posts/x',
            website: 'https://x.example', topics: { edges: [{ node: { name: 'productivity' } }] },
            ...p,
          },
        })),
      },
    },
  };
}

describe('createProductHuntTrendSource', () => {
  it('authenticates via OAuth then queries trending posts', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      if (String(url).includes('oauth/token')) return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      return jsonResponse(graphqlBody([{ id: 'p1', name: 'Cool Tool' }]));
    });
    const source = createProductHuntTrendSource({ clientId: 'id', clientSecret: 'secret', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.topic).toContain('Cool Tool');
    expect(out[0]!.source).toBe('producthunt');
    expect(calls[0]).toContain('oauth/token');
    expect(calls[1]).toContain('graphql');
  });

  it('surfaces a GraphQL error as a real error rather than an empty silent result', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('oauth/token')) return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      return jsonResponse({ errors: [{ message: 'rate limited' }] });
    });
    const source = createProductHuntTrendSource({ clientId: 'id', clientSecret: 'secret', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(source.fetch({ limit: 10 })).rejects.toThrow(/rate limited/);
  });

  it('caches the access token across calls', async () => {
    let tokenCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('oauth/token')) {
        tokenCalls++;
        return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      }
      return jsonResponse(graphqlBody([{ id: 'p1' }]));
    });
    const source = createProductHuntTrendSource({ clientId: 'id', clientSecret: 'secret', fetchImpl: fetchImpl as unknown as typeof fetch });
    await source.fetch({ limit: 5 });
    await source.fetch({ limit: 5 });
    expect(tokenCalls).toBe(1);
  });

  it('maps votes and topics into real metrics/tags, never fabricated growth', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('oauth/token')) return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      return jsonResponse(graphqlBody([{ id: 'p1', votesCount: 200, commentsCount: 30 }]));
    });
    const source = createProductHuntTrendSource({ clientId: 'id', clientSecret: 'secret', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 5 });
    expect(out[0]!.metrics.volume).toBe(230);
    expect(out[0]!.metrics.growth).toBe(0);
    expect(out[0]!.tags).toEqual(['productivity']);
  });
});
