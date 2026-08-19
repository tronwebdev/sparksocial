import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `asset.folder.create` / `asset.folder.move` — organizing the Asset Graph
 * into named groupings. `assets.folder_id` has existed on the schema since
 * before either of these tools, or the `asset_folders` table itself, did —
 * nothing ever created a folder it could point at. This closes both halves.
 */

export const AssetFolderCreateInput = z.object({
  genomeId: z.string().min(1),
  name: z.string().min(1).max(80),
});

export const assetFolderCreate = defineTool({
  name: 'asset.folder.create',
  version: 1,

  summary: 'Create a named folder to group assets under — "B-roll", "Testimonials" — for browsing, not for retrieval (the resolver ranks by intent, not folder).',

  input: AssetFolderCreateInput,
  output: z.object({ folderId: z.string(), name: z.string() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: false,

  async handler(input, ctx) {
    const folder = await ctx.db.assetFolders.create({ genomeId: input.genomeId, orgId: ctx.orgId, name: input.name });
    ctx.logger.info('asset folder created', { genomeId: input.genomeId, folderId: folder.id });
    return { folderId: folder.id, name: folder.name };
  },
});

export const AssetFolderListInput = z.object({ genomeId: z.string().min(1) });

export const assetFolderList = defineTool({
  name: 'asset.folder.list',
  version: 1,

  summary: "This genome's asset folders, for a folder picker — `db.assetFolders.list` has existed since `asset.folder.create` was built but nothing exposed it as a tool.",

  input: AssetFolderListInput,
  output: z.object({ folders: z.array(z.object({ folderId: z.string(), name: z.string() })) }),

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,

  async handler(input, ctx) {
    const folders = await ctx.db.assetFolders.list(input.genomeId, ctx.orgId);
    return { folders: folders.map((f) => ({ folderId: f.id, name: f.name })) };
  },
});

export const AssetFolderMoveInput = z.object({
  genomeId: z.string().min(1),
  assetId: z.string().min(1),
  /** `null` moves the asset back out of any folder. */
  folderId: z.string().min(1).nullable(),
});

export const assetFolderMove = defineTool({
  name: 'asset.folder.move',
  version: 1,

  summary: "Move an asset into a folder, or back out of one (folderId: null) — organizational only, never changes the asset's rights, retrieval eligibility, or usage history.",

  input: AssetFolderMoveInput,
  output: z.object({ assetId: z.string(), folderId: z.string().nullable() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,

  async handler(input, ctx) {
    const row = await ctx.db.assets.moveToFolder({
      id: input.assetId,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      folderId: input.folderId,
    });
    if (!row) {
      throw new ToolError(
        'NOT_FOUND',
        input.folderId
          ? `Asset ${input.assetId} or folder ${input.folderId} not found for this genome.`
          : `No asset ${input.assetId} for this genome.`,
        { assetId: input.assetId, folderId: input.folderId },
      );
    }
    return { assetId: row.id, folderId: row.folderId };
  },
});
