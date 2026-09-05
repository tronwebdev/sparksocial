import { and, eq } from 'drizzle-orm';
import type { AssetFolderStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { assetFolderMembers } from './schema.js';
import * as scoped from './scoped.js';

/** `ScopedDb['assetFolders']` backed by Postgres — see `asset_folders`'s own comment in schema.ts. */
export function createAssetFolderRepository(db: Database): AssetFolderStore {
  return {
    async create({ genomeId, orgId, name }) {
      return scoped.createAssetFolder(db, { orgId, brandId: orgId, genomeId }, { name });
    },

    async list(genomeId, orgId) {
      return scoped.listAssetFolders(db, { orgId, brandId: orgId, genomeId });
    },

    /**
     * Folder membership — a responsibility marker, never an access grant, and
     * never a write to `brand_members`. See `asset_folder_members` in
     * `schema.ts` for why those two are kept apart.
     */
    async members(folderId, orgId) {
      const rows = await db
        .select({ userId: assetFolderMembers.userId, assignedBy: assetFolderMembers.assignedBy, createdAt: assetFolderMembers.createdAt })
        .from(assetFolderMembers)
        .where(and(eq(assetFolderMembers.orgId, orgId), eq(assetFolderMembers.folderId, folderId)));
      return rows;
    },

    async setMembers({ folderId, genomeId, orgId, userIds, assignedBy }) {
      /* Confirm the folder is this genome's before writing rows against it —
         `folderId` arrives from a caller and nothing else here checks it. */
      const folders = await scoped.listAssetFolders(db, { orgId, brandId: orgId, genomeId });
      if (!folders.some((f) => f.id === folderId)) return undefined;

      return db.transaction(async (tx) => {
        await tx
          .delete(assetFolderMembers)
          .where(and(eq(assetFolderMembers.orgId, orgId), eq(assetFolderMembers.folderId, folderId)));
        if (userIds.length > 0) {
          await tx.insert(assetFolderMembers).values(
            userIds.map((userId) => ({ orgId, folderId, userId, assignedBy })),
          );
        }
        return { folderId, userIds };
      });
    },

    async rename({ folderId, genomeId, orgId, name }) {
      return scoped.renameAssetFolder(db, { orgId, brandId: orgId, genomeId }, { folderId, name });
    },

    async delete({ folderId, genomeId, orgId }) {
      return scoped.deleteAssetFolder(db, { orgId, brandId: orgId, genomeId }, { folderId });
    },
  };
}
