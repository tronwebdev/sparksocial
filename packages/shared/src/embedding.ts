/**
 * THE EMBEDDING DIMENSION. One constant, imported everywhere.
 *
 * This existed as the literal `1536` in four `schema.ts` column definitions and
 * as `EMBED_DIM = 8` in the development embedder, with nothing connecting them.
 * The result was a latent break rather than a wrong answer: every unit test
 * passed against the in-memory store, and the first `asset.ingest_url` after
 * setting `DATABASE_URL` would fail with `expected 1536 dimensions, not 8`.
 *
 * A mismatch here is not recoverable by a retry and not visible until the
 * moment persistence is switched on, so the fix is structural — there is now
 * one place to change it and both sides read from that place.
 *
 * ── Why 1536 ───────────────────────────────────────────────────────────────
 *
 * Engine spec §4.2 names `text-embedding-3-large` at 1536. The number outlives
 * that particular model: it is written into `vector(1536)` columns and their
 * indexes, so changing it is a migration plus a re-embed of every asset, not a
 * config change. Any replacement model must be able to produce 1536 dimensions
 * — most support a `dimensions` parameter for exactly this reason.
 */
export const EMBEDDING_DIM = 1536;

/**
 * Deterministic pseudo-embedding, at the real dimension.
 *
 * Shared by the development store and the development embed client, which
 * previously each had their own copy — and a retrieval test only means
 * something if the vectors being compared came from the same function.
 *
 * The values are a cheap PRNG seeded from the text. That is enough for the
 * property the dev environment needs (same text → same vector, different text →
 * different vector, so cosine similarity orders results stably) and is not
 * pretending to be semantic: `devEmbedClient` is a fake, and a fake that
 * produced plausible-looking similarity would be worse, because it would make
 * a broken retrieval ranking look like it worked.
 */
export function deterministicEmbedding(seed: string, dim: number = EMBEDDING_DIM): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;

  const out: number[] = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    out[i] = (h % 2000) / 1000 - 1; // [-1, 1)
  }
  return out;
}
