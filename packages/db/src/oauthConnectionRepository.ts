import type { OAuthConnectionStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/** `oauth_connections` backed by Postgres — a brand's own connected third-party accounts (Canva). Genome-scoped through `scoped.ts`. */
export function createOAuthConnectionRepository(db: Database): OAuthConnectionStore {
  return {
    async get(genomeId, orgId, provider) {
      const row = await scoped.getOAuthConnection(db, { orgId, brandId: orgId, genomeId }, provider);
      return row ? toConnection(row) : undefined;
    },

    async save({ genomeId, orgId, provider, accessToken, refreshToken, expiresAt, connectedBy, scopes, accountLabel }) {
      const row = await scoped.saveOAuthConnection(
        db,
        { orgId, brandId: orgId, genomeId },
        {
          provider,
          accessToken,
          connectedBy,
          ...(refreshToken ? { refreshToken } : {}),
          ...(expiresAt ? { expiresAt } : {}),
          ...(scopes ? { scopes } : {}),
          ...(accountLabel ? { accountLabel } : {}),
        },
      );
      return toConnection(row);
    },

    async remove(genomeId, orgId, provider) {
      await scoped.removeOAuthConnection(db, { orgId, brandId: orgId, genomeId }, provider);
    },

    /**
     * The one read on this store that is not inside a tenant — see the
     * `findExpiringOAuthConnections` comment in `scoped.ts` for why a clock has
     * no genome to be scoped to, and why every row still carries its own.
     */
    async findExpiring({ before, limit }) {
      const rows = await scoped.findExpiringOAuthConnections(db, { before, limit });
      return rows.map((row) => ({ ...toConnection(row), orgId: row.orgId }));
    },

    async markExpiryNotified({ id, orgId, at }) {
      await scoped.markOAuthExpiryNotified(db, { orgId }, { id, at });
    },
  };
}

function toConnection(row: scoped.OAuthConnectionRow) {
  return {
    id: row.id,
    genomeId: row.genomeId,
    provider: row.provider,
    accessToken: row.accessToken,
    connectedBy: row.connectedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.refreshToken ? { refreshToken: row.refreshToken } : {}),
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
    ...(row.scopes ? { scopes: row.scopes } : {}),
    ...(row.accountLabel ? { accountLabel: row.accountLabel } : {}),
    ...(row.expiryNotifiedAt ? { expiryNotifiedAt: row.expiryNotifiedAt } : {}),
  };
}
