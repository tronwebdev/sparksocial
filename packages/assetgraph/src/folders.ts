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

  summary:
    "This genome's asset folders, with when each was made and how much is in it — the folder picker and " +
    "LIB-01's folder list read the same call.",

  input: AssetFolderListInput,
  output: z.object({
    folders: z.array(
      z.object({
        folderId: z.string(),
        name: z.string(),
        // `LIB-01` asks the folder list for both. They were computed by the
        // query and dropped by this schema, so the screen had nothing to show.
        createdAt: z.string(),
        assetCount: z.number().int(),
      }),
    ),
  }),

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,

  async handler(input, ctx) {
    const folders = await ctx.db.assetFolders.list(input.genomeId, ctx.orgId);
    return {
      folders: folders.map((f) => ({
        folderId: f.id,
        name: f.name,
        createdAt: f.createdAt.toISOString(),
        assetCount: f.assetCount,
      })),
    };
  },
});

/* ── rename / delete — LIB-01's folder ⋯ menu ───────────────────────────── */

export const AssetFolderRenameInput = z.object({
  genomeId: z.string().min(1),
  folderId: z.string().min(1),
  name: z.string().min(1).max(120),
});

export const assetFolderRename = defineTool({
  name: 'asset.folder.rename',
  version: 1,

  summary: 'Rename an asset folder. Nothing inside it moves or changes. Free.',

  input: AssetFolderRenameInput,
  output: z.object({ folderId: z.string(), name: z.string() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  /* Setting the same name twice is the same state — no key needed. */
  idempotent: true,

  async handler(input, ctx) {
    const row = await ctx.db.assetFolders.rename({
      folderId: input.folderId,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      name: input.name,
    });
    if (!row) {
      throw new ToolError('NOT_FOUND', `No folder ${input.folderId} for this genome.`, { folderId: input.folderId });
    }
    ctx.logger.info('asset folder renamed', { genomeId: input.genomeId, folderId: row.id });
    return { folderId: row.id, name: row.name };
  },
});

export const AssetFolderDeleteInput = z.object({
  genomeId: z.string().min(1),
  folderId: z.string().min(1),
});

export const assetFolderDelete = defineTool({
  name: 'asset.folder.delete',
  version: 1,

  summary:
    'Delete an asset folder. The files in it are not deleted — they stay in the Asset Graph unfiled ' +
    'and keep working in posts that reference them. Use asset.archive to remove a file. Free.',

  input: AssetFolderDeleteInput,
  output: z.object({
    folderId: z.string(),
    /** How many assets came out of the folder and stayed in the graph. */
    unfiled: z.number().int(),
  }),

  effect: 'write',
  /**
   * `human_only`. Nothing about deleting a folder helps SPARK do its job, and
   * the one thing an autonomous agent could do with it is destroy a person's
   * filing while tidying up. The same posture `asset.rights.set` takes: the
   * agent may use the library, it does not get to reorganise it.
   */
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  /* Deleting a folder that is already gone is the state the caller asked for. */
  idempotent: true,

  async handler(input, ctx) {
    const row = await ctx.db.assetFolders.delete({
      folderId: input.folderId,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
    });
    if (!row) {
      throw new ToolError('NOT_FOUND', `No folder ${input.folderId} for this genome.`, { folderId: input.folderId });
    }
    ctx.logger.info('asset folder deleted', { genomeId: input.genomeId, folderId: row.id, unfiled: row.unfiled });
    return { folderId: row.id, unfiled: row.unfiled };
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

/**
 * `asset.unfiled` — the files that belong to no folder.
 *
 * Exists because `asset.folder.delete` unfiles rather than cascades: without a
 * way to list them, "the files are not deleted" would have been true of the
 * database and false of the product. Also catches assets that never had a
 * folder — the WhatsApp capture loop ingests without one.
 */
export const assetUnfiled = defineTool({
  name: 'asset.unfiled',
  version: 1,

  summary:
    'Assets that are in no folder — what is left after a folder is deleted, plus anything captured ' +
    'without being filed. Free.',

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
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,

  async handler(input, ctx) {
    const rows = await ctx.db.assets.unfiled(input.genomeId, ctx.orgId);
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

/* ── who is on a folder ─────────────────────────────────────────────────── */

/**
 * `asset.folder.members` / `asset.folder.member.set`.
 *
 * Assigning somebody to a folder records **who is looking after it**. It grants
 * nothing: retrieval is scoped by genome and never by folder, so every folder
 * stays visible to everybody who can reach the brand, and these rows do not
 * change that. Saying so out loud matters, because "assign a member" reads like
 * a permission and a UI that implied one would be promising a boundary the
 * query layer does not enforce.
 *
 * It equally does not touch brand membership. Who may reach a brand at all is
 * Clerk's org membership plus `brand_members`, written by `team.role.set`; this
 * writes `asset_folder_members` and nothing else, so a person can be added to
 * and removed from folders all day without a single brand permission moving.
 */
export const assetFolderMembers = defineTool({
  name: 'asset.folder.members',
  version: 1,

  summary: 'Who is assigned to an asset folder. A responsibility label, not an access grant. Free.',

  input: z.object({ genomeId: z.string().min(1), folderId: z.string().min(1) }),
  output: z.object({
    members: z.array(z.object({ userId: z.string(), assignedBy: z.string(), assignedAt: z.string() })),
  }),

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,

  async handler(input, ctx) {
    const rows = await ctx.db.assetFolders.members(input.folderId, ctx.orgId);
    return {
      members: rows.map((r) => ({
        userId: r.userId,
        assignedBy: r.assignedBy,
        assignedAt: r.createdAt.toISOString(),
      })),
    };
  },
});

export const AssetFolderMemberSetInput = z.object({
  genomeId: z.string().min(1),
  folderId: z.string().min(1),
  /** The complete list after the change — an empty array clears it. */
  userIds: z.array(z.string().min(1)).max(50),
});

export const assetFolderMemberSet = defineTool({
  name: 'asset.folder.member.set',
  version: 1,

  summary:
    "Set who is assigned to an asset folder. Replaces the folder's list; an empty list clears it. " +
    "Does not change anybody's access to the brand. Free.",

  input: AssetFolderMemberSetInput,
  output: z.object({ folderId: z.string(), userIds: z.array(z.string()) }),

  effect: 'write',
  /**
   * `human_only`. Deciding who is responsible for a body of work is a person's
   * call about people, the same posture `asset.rights.set` and
   * `asset.folder.delete` take — and an agent tidying up its own filing by
   * reassigning colleagues is the exact behaviour nobody asked for.
   */
  autonomy: 'human_only',
  scopes: ['owner', 'admin', 'editor'],
  /** Setting the same list twice is the same state. */
  idempotent: true,

  async handler(input, ctx) {
    const row = await ctx.db.assetFolders.setMembers({
      folderId: input.folderId,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      userIds: [...new Set(input.userIds)],
      assignedBy: ctx.userId ?? 'agent',
    });
    if (!row) {
      throw new ToolError('NOT_FOUND', `No folder ${input.folderId} for this genome.`, { folderId: input.folderId });
    }
    ctx.logger.info('asset folder members set', {
      genomeId: input.genomeId,
      folderId: row.folderId,
      count: row.userIds.length,
    });
    return row;
  },
});
