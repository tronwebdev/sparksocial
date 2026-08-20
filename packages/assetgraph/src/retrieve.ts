import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { AssetRole } from '@sparksocial/shared';

/**
 * `asset.retrieve` — engine spec §4.3.
 *
 * The Assemble pipeline calls this instead of a human hand-picking files:
 *
 *   GET /v1/assets/retrieve
 *   { workspace_id, intent, required_roles, constraints, k }
 *   → [{ asset_id, role, caption, embedding_score, usage_count, last_used_at, rights_status }]
 *
 * Ranking is similarity minus a recency penalty minus a usage penalty
 * (`packages/db/src/scoped.ts::buildRetrieveQuery`) — never raw cosine distance.
 * Without those penalties the same three photos surface every week and the
 * account reads as automated, which is the specific failure §4.3 calls out.
 *
 * The embedding for `intent` is produced by an injected client (real impl calls
 * the same `text-embedding-3-large` endpoint used at ingest), so this tool stays
 * unit-testable with a fake and never imports a vendor SDK at module scope.
 */

export const AssetRetrieveInput = z.object({
  genomeId: z.string(),
  intent: z.string().min(1),
  requiredRoles: z.array(AssetRole).optional(),
  constraints: z
    .object({
      minResolution: z.string().optional(),
      pairable: z.boolean().optional(),
    })
    .optional(),
  k: z.number().int().min(1).max(50).default(8),
});

const RetrievedAsset = z.object({
  assetId: z.string(),
  role: AssetRole,
  caption: z.string().nullable(),
  embeddingScore: z.number(),
  usageCount: z.number().int(),
  lastUsedAt: z.string().nullable(),
  rightsStatus: z.string(),
  folderId: z.string().nullable(),
  /**
   * Where the file actually is, and what kind it is.
   *
   * Both come back from the scoped query already (`ScopedDb.assets.retrieve`)
   * and were dropped by this schema, so every screen reading retrieval got a
   * list of assets it could describe and not show. `LIB-02`'s grid view is the
   * case that made it obvious: a media library whose thumbnails cannot be
   * rendered is a table with extra steps.
   */
  url: z.string(),
  mediaType: z.string(),
});

export const AssetRetrieveOutput = z.object({
  results: z.array(RetrievedAsset),
  why: z.object({
    summary: z.string(),
    factors: z.array(z.object({ label: z.string(), detail: z.string().optional() })),
    evidence: z.array(z.object({ kind: z.enum(['asset']), id: z.string(), note: z.string().optional() })).default([]),
    alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
  }),
});

export interface EmbedClient {
  embed(text: string): Promise<number[]>;
}

export function makeAssetRetrieve(deps: EmbedClient) {
  return defineTool({
    name: 'asset.retrieve',
    version: 1,

    summary:
      'Find the best assets for a described intent, e.g. "before and after of a kitchen renovation". ' +
      'Ranked by relevance minus recency and reuse penalties, so the same photos do not surface every ' +
      'week. Read-only, cheap.',

    input: AssetRetrieveInput,
    output: AssetRetrieveOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,
    // One embedding call to turn the query into a vector. Cheap individually;
    // this is the most-called tool in the product, which is exactly why it
    // should not be invisible in the ledger.
    estimateCents: () => 1,
    surfaces: ['LIB-01'],

    async handler(input, ctx) {
      const embedding = await deps.embed(input.intent);

      const results = await ctx.db.assets.retrieve({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        embedding,
        requiredRoles: input.requiredRoles,
        k: input.k,
      });

      ctx.logger.info('assets retrieved', { genomeId: input.genomeId, intent: input.intent, count: results.length });

      return {
        results: results.map((r) => ({
          assetId: r.assetId,
          role: r.role,
          caption: r.caption ?? null,
          embeddingScore: Number(r.score.toFixed(4)),
          usageCount: r.usageCount,
          lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
          rightsStatus: r.rightsStatus,
          folderId: r.folderId,
          url: r.url,
          mediaType: r.mediaType,
        })),
        why: {
          summary:
            results.length > 0
              ? `Found ${results.length} asset(s) matching "${input.intent}", ranked by relevance and freshness.`
              : `No cleared assets matched "${input.intent}".`,
          factors: [
            {
              label: 'ranking',
              detail: 'similarity minus recency penalty minus usage penalty — never raw similarity alone',
            },
            ...(input.requiredRoles?.length
              ? [{ label: 'role filter', detail: input.requiredRoles.join(', ') }]
              : []),
          ],
          evidence: results.slice(0, 5).map((r) => ({ kind: 'asset' as const, id: r.assetId, note: r.caption ?? undefined })),
          alternatives: [],
        },
      };
    },
  });
}
