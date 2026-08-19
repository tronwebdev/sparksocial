import type { AssetFolderStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
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
  };
}
