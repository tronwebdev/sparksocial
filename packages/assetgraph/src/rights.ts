import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `asset.rights.set` — the retroactive half of rights clearance.
 *
 * Every upload path (`asset.upload_url`, `asset.ingest_url`) takes a
 * self-attested `rightsStatus` at ingest time, and retrieval (`retrieveAssets`)
 * only ever returns `'cleared'` rows — so an asset uploaded as `'pending'` sat
 * invisible to the resolver forever, with no way to clear it after the fact.
 * This is that way back in (and the way to pull a `'cleared'` asset back out
 * of rotation if a rights concern surfaces after upload).
 *
 * `human_only`: a rights determination is a person's call about what they're
 * legally allowed to use, the same posture `genome.consent.grant/.revoke`
 * takes — SPARK proposing its own footage is clear would be exactly backwards.
 */

export const AssetRightsSetInput = z.object({
  genomeId: z.string().min(1),
  assetId: z.string().min(1),
  rightsStatus: z.enum(['cleared', 'pending', 'restricted']),
});

export const assetRightsSet = defineTool({
  name: 'asset.rights.set',
  version: 1,

  summary:
    "Set an asset's rights status after upload — clear a pending asset so the resolver can use it, or " +
    'pull a cleared one out of rotation if a rights concern comes up later.',

  input: AssetRightsSetInput,
  output: z.object({ assetId: z.string(), rightsStatus: z.string() }),

  effect: 'write',
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: true,

  async handler(input, ctx) {
    const row = await ctx.db.assets.setRights({
      id: input.assetId,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      rightsStatus: input.rightsStatus,
    });
    if (!row) {
      throw new ToolError('NOT_FOUND', `No asset ${input.assetId} for this genome.`, { assetId: input.assetId });
    }
    ctx.logger.info('asset rights set', { genomeId: input.genomeId, assetId: input.assetId, rightsStatus: input.rightsStatus });
    return { assetId: row.id, rightsStatus: row.rightsStatus };
  },
});
