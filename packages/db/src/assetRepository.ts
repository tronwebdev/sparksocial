import type { ScopedDb } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import * as scoped from './scoped.js';
import type { Scope } from './scoped.js';

/**
 * `ScopedDb['assets']` backed by Postgres — engine spec §4.
 *
 * This module never touches the `assets` table directly; every read and write
 * is a function in `scoped.ts`, the only module the isolation test
 * (`test/isolation.test.ts`) permits to import scoped tables. This file just
 * adapts `scoped.ts`'s scope-shaped signatures to the positional-args shape
 * `ScopedDb['assets']` (defineTool.ts) expects.
 */
export function createAssetRepository(db: Database): ScopedDb['assets'] {
  return {
    async inventory(genomeId, orgId) {
      return scoped.assetInventory(db, { orgId, brandId: orgId, genomeId });
    },

    async retrieve({ genomeId, orgId, embedding, requiredRoles, k }) {
      // `ScopedDb.assets.retrieve` (defineTool.ts) has no `brandId` parameter —
      // asset tools are only ever handed `genomeId`/`orgId` from `ToolCtx` — and
      // `scopePredicate` never reads `brandId` for these tables (none of the four
      // scoped tables has a brand_id column; see schema.ts). `assertScope` still
      // requires it as a defensive contract against a *future* scoped table that
      // does key on brand, so it's satisfied here with `orgId` as a non-semantic
      // placeholder rather than widening the public `ScopedDb` interface for a
      // value nothing downstream of this call reads. Threading a real `brandId`
      // through end-to-end is a reasonable follow-up, not required for this call
      // to be correct today.
      const scope: Scope = { orgId, brandId: orgId, genomeId };
      return scoped.retrieveAssets(db, scope, { intent: '', embedding, requiredRoles, k });
    },

    async create({ genomeId, orgId, url, assetRole, mediaType, rightsStatus, caption, embedding, source }) {
      return scoped.createAsset(
        db,
        { orgId, brandId: orgId, genomeId },
        { url, assetRole, mediaType, rightsStatus, caption, embedding, source },
      );
    },

    async captionsByRole(genomeId, orgId, roles) {
      return scoped.assetCaptionsByRole(db, { orgId, brandId: orgId, genomeId }, roles);
    },

    async info(ids, genomeId, orgId) {
      return scoped.assetInfo(db, { orgId, brandId: orgId, genomeId }, ids);
    },
  };
}
