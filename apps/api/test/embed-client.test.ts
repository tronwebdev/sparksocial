import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { EMBEDDING_DIM, deterministicEmbedding } from '@sparksocial/shared/embedding';
import { createEmbedClient } from '../src/embed-client.js';

/**
 * The embedding client, and the dimension contract it exists to hold.
 *
 * The bug this closes was not a wrong answer — it was a *shape* disagreement.
 * The dev embedder produced 8 dimensions while `schema.ts` declared 1536, and
 * nothing compared them, so every test passed and the first insert against real
 * Postgres would have failed. Half these tests are about the number.
 */

const vector = (n: number) => Array.from({ length: n }, (_, i) => i / n);

// Typed with the parameters `fetch` actually receives, so `mock.calls[0]` is
// a real tuple rather than `[]` — otherwise asserting on the request body is a
// type error dressed up as a tuple-index error.
const respond = (body: unknown, status = 200) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const client = (fetchImpl: typeof fetch) =>
  createEmbedClient({ apiKey: 'k', fetchImpl });

describe('the dimension contract', () => {
  it('returns the vector when the model honours the requested size', async () => {
    const f = respond({ data: [{ embedding: vector(EMBEDDING_DIM) }] });
    const out = await client(f as unknown as typeof fetch).embed('a fade, close up');

    expect(out).toHaveLength(EMBEDDING_DIM);
  });

  it('asks the provider for exactly the stored dimension', async () => {
    // `text-embedding-3-*` truncates to a requested size, which is what lets a
    // 3072-dim model serve a 1536-dim column. Not asking is how you get 3072.
    const f = respond({ data: [{ embedding: vector(EMBEDDING_DIM) }] });
    await client(f as unknown as typeof fetch).embed('x');

    const body = JSON.parse(f.mock.calls[0]![1]!.body as string);
    expect(body.dimensions).toBe(EMBEDDING_DIM);
  });

  it('refuses a vector of the wrong length', async () => {
    /**
     * The load-bearing test. Without it a provider that ignores `dimensions`
     * fails at the INSERT instead — after the caption has been generated and
     * paid for, with an error naming a database column rather than the model
     * that caused it.
     */
    const f = respond({ data: [{ embedding: vector(3_072) }] });

    await expect(client(f as unknown as typeof fetch).embed('x')).rejects.toThrow(ToolError);
    await expect(client(f as unknown as typeof fetch).embed('x')).rejects.toThrow(/3072 dimensions/);
  });

  it('refuses a response with no vector at all', async () => {
    const f = respond({ data: [] });
    await expect(client(f as unknown as typeof fetch).embed('x')).rejects.toThrow(/no vector/i);
  });
});

describe('transport', () => {
  it('reports an upstream failure rather than returning nothing', async () => {
    const f = vi.fn(async () => new Response('rate limited', { status: 429 }));
    await expect(client(f as unknown as typeof fetch).embed('x')).rejects.toThrow(/429/);
  });

  it('does not echo the whole provider error back', async () => {
    // Provider errors sometimes quote the input, and the input here is a
    // caption describing someone's private media.
    const f = vi.fn(async () => new Response('x'.repeat(5_000), { status: 400 }));

    await client(f as unknown as typeof fetch)
      .embed('secret')
      .catch((e: ToolError & { meta?: { detail?: string } }) => {
        expect((e.meta?.detail ?? '').length).toBeLessThanOrEqual(200);
      });
  });

  it('does not double the slash when the base URL has a trailing one', async () => {
    const f = respond({ data: [{ embedding: vector(EMBEDDING_DIM) }] });
    await createEmbedClient({ apiKey: 'k', baseUrl: 'https://x.example/v1/', fetchImpl: f as unknown as typeof fetch })
      .embed('x');

    expect(f.mock.calls[0]![0]).toBe('https://x.example/v1/embeddings');
  });
});

describe('the deterministic fallback', () => {
  it('produces vectors of the same length as the real client', async () => {
    // The property that was violated: the fake and the schema must agree about
    // shape, or switching on DATABASE_URL breaks every insert.
    expect(deterministicEmbedding('anything')).toHaveLength(EMBEDDING_DIM);
  });

  it('is stable for the same text and different for different text', async () => {
    // Enough for retrieval to order results reproducibly in development.
    // Deliberately not semantic — a fake that looked semantic would let a
    // broken ranking pass for one that worked.
    expect(deterministicEmbedding('a fade')).toEqual(deterministicEmbedding('a fade'));
    expect(deterministicEmbedding('a fade')).not.toEqual(deterministicEmbedding('a beard trim'));
  });

  it('stays inside the range a cosine comparison expects', async () => {
    const v = deterministicEmbedding('x');
    expect(Math.min(...v)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...v)).toBeLessThan(1);
  });
});
