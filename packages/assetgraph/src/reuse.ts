import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `asset.reuse` — records that an asset was just used, the only writer of
 * `usageCount`/`lastUsedAt`.
 *
 * Both columns have existed on `assets` since ingest, and are read in two
 * places — `retrieveAssets`'s recency/usage penalty (favors fresher assets)
 * and `guard.duplicate`'s reuse-cooldown check (blocks reusing the same asset
 * within `DEFAULT_COOLDOWN_DAYS`) — but nothing ever wrote them, so both reads
 * were silently scoring against permanent defaults. `publish.now` now calls
 * this automatically for every `referencedAssetIds` entry on a successful
 * publish (see that tool's own comment), which closes the gap for the normal
 * path. This tool exists standalone for the uses outside publish — an
 * Assemble render, or reserving an asset before a draft is finalized.
 */

export const AssetReuseInput = z.object({
  genomeId: z.string().min(1),
  assetId: z.string().min(1),
});

export const assetReuse = defineTool({
  name: 'asset.reuse',
  version: 1,

  summary: "Record that an asset was just used — updates its usage count and last-used time for the resolver's recency scoring and the reuse-cooldown guardrail.",

  input: AssetReuseInput,
  output: z.object({ assetId: z.string(), usageCount: z.number(), lastUsedAt: z.string().nullable() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Each call is a genuine, distinct usage event — replaying it would
  // silently inflate the count and misrepresent how often the asset was
  // actually used.
  idempotent: false,

  async handler(input, ctx) {
    const row = await ctx.db.assets.recordUsage({ id: input.assetId, genomeId: input.genomeId, orgId: ctx.orgId });
    if (!row) {
      throw new ToolError('NOT_FOUND', `No asset ${input.assetId} for this genome.`, { assetId: input.assetId });
    }
    return { assetId: row.id, usageCount: row.usageCount, lastUsedAt: row.lastUsedAt?.toISOString() ?? null };
  },
});
