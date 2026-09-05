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

/**
 * `asset.rights.pending` — the list `asset.rights.set` acts on.
 *
 * Without it, clearing an asset after upload required knowing its id, and the
 * only screen that shows ids is the one that cannot show these assets at all:
 * `asset.retrieve` returns `'cleared'` rows and nothing else, so a `'pending'`
 * upload was invisible everywhere in the product while still counting toward
 * its folder's file count. The Assets Library reads this to say what is being
 * held back and offer to clear it.
 *
 * `read`, so it is never gated — seeing what you uploaded is not a decision.
 * Setting the status still is (`asset.rights.set` is `human_only`).
 */
export const assetRightsPending = defineTool({
  name: 'asset.rights.pending',
  version: 1,

  summary:
    'List the assets that retrieval is holding back because their rights are not cleared — ' +
    'uploads marked pending, and anything pulled out of rotation as restricted. Free.',

  input: z.object({ genomeId: z.string().min(1) }),
  output: z.object({
    assets: z.array(
      z.object({
        assetId: z.string(),
        role: z.string(),
        rightsStatus: z.string(),
        caption: z.string().nullable(),
        url: z.string(),
        mediaType: z.string(),
        folderId: z.string().nullable(),
        filename: z.string().nullable(),
        sizeBytes: z.number().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,

  async handler(input, ctx) {
    const rows = await ctx.db.assets.awaitingRights(input.genomeId, ctx.orgId);
    return {
      assets: rows.map((r) => ({
        assetId: r.assetId,
        role: r.role as string,
        rightsStatus: r.rightsStatus,
        caption: r.caption,
        url: r.url,
        mediaType: r.mediaType as string,
        folderId: r.folderId,
        filename: r.filename,
        sizeBytes: r.sizeBytes,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  },
});
