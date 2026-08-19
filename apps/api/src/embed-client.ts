import { EMBEDDING_DIM, deterministicEmbedding } from '@sparksocial/shared/embedding';
import { ToolError } from '@sparksocial/shared';
import { envSet, envStr } from './env.js';

/**
 * Production text embeddings — engine spec §4.2.
 *
 * Written against the **OpenAI-compatible `/v1/embeddings` shape** rather than a
 * vendor SDK. That shape is implemented by OpenAI, Azure OpenAI, Voyage,
 * Together, and every local server worth using, so choosing a provider is a
 * base URL and a model name rather than a rewrite. It also keeps `apps/api`
 * free of a fifth vendor SDK for one HTTP call with four fields.
 *
 * ── The dimension is not negotiable ────────────────────────────────────────
 *
 * `assets.embedding` is `vector(EMBEDDING_DIM)`, and Postgres rejects anything
 * else. So the request asks for that many dimensions explicitly and the
 * response is checked before it can reach a row. A model that quietly returns
 * 3072 must fail here, loudly, rather than at the insert — by then the caption
 * has been generated and paid for, and the error names a column instead of the
 * model that caused it.
 */

export interface EmbedClient {
  embed(text: string): Promise<number[]>;
}

/** Anything speaking the OpenAI embeddings shape. Default suits OpenAI itself. */
export interface EmbedClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'text-embedding-3-large';

export function createEmbedClient(opts: EmbedClientOptions): EmbedClient {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = opts.model ?? DEFAULT_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    async embed(text: string): Promise<number[]> {
      const response = await doFetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: text,
          // `text-embedding-3-*` supports truncation to a requested size, which
          // is what lets a 3072-dim model serve a 1536-dim column. Providers
          // that ignore the field are caught by the length check below.
          dimensions: EMBEDDING_DIM,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ToolError('UPSTREAM_FAILED', `Embedding request failed (${response.status}).`, {
          status: response.status,
          // Truncated: provider errors sometimes echo the input back, and the
          // input here is a caption that may describe someone's private media.
          detail: detail.slice(0, 200),
        });
      }

      const body = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
      const vector = body.data?.[0]?.embedding;

      if (!Array.isArray(vector)) {
        throw new ToolError('UPSTREAM_FAILED', 'Embedding response had no vector.', { model });
      }

      if (vector.length !== EMBEDDING_DIM) {
        // The check that turns a silent corruption into a stopped pipeline.
        throw new ToolError(
          'UPSTREAM_FAILED',
          `Embedding model returned ${vector.length} dimensions; the schema stores ${EMBEDDING_DIM}.`,
          { model, got: vector.length, expected: EMBEDDING_DIM },
        );
      }

      return vector;
    },
  };
}

/**
 * The real client when a key is configured, the deterministic fake otherwise.
 *
 * Chosen on the credential like every other seam here. The warning is worth its
 * noise: with the fake, `asset.retrieve` still *ranks* — it just ranks by a
 * hash of the caption, so results look ordered and mean nothing. That is a
 * failure mode you can demo for weeks without noticing.
 */
let memo: EmbedClient | undefined;

/**
 * Memoised, so every caller gets the *same* client.
 *
 * Not an optimisation. `guard.duplicate` compares a draft against the
 * embeddings stored at ingest, and two clients configured differently — or one
 * real and one fake — compare vectors from unrelated spaces. The result is a
 * similarity score that is arithmetically valid and semantically meaningless,
 * which is the worst kind: the guardrail keeps reporting `pass`.
 *
 * It also means the "no key configured" warning prints once rather than four
 * times, which is the difference between a warning being read and being scrolled
 * past.
 */
export function embedClient(): EmbedClient {
  return (memo ??= buildEmbedClient());
}

function buildEmbedClient(): EmbedClient {
  const apiKey = envStr('EMBEDDINGS_API_KEY', envStr('OPENAI_API_KEY', ''));

  if (!apiKey) {
    console.warn(
      '[warn] EMBEDDINGS_API_KEY unset — using deterministic pseudo-embeddings. Asset retrieval will ' +
        'return a stable ranking with no semantic meaning. Correct dimension, wrong vectors.',
    );
    return { async embed(text) { return deterministicEmbedding(text); } };
  }

  return createEmbedClient({
    apiKey,
    ...(envSet('EMBEDDINGS_BASE_URL') ? { baseUrl: envStr('EMBEDDINGS_BASE_URL', '') } : {}),
    ...(envSet('EMBEDDINGS_MODEL') ? { model: envStr('EMBEDDINGS_MODEL', '') } : {}),
  });
}
