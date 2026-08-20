import type { EngagementMessage, EngagementStore } from '@sparksocial/tools/defineTool';
import type { Explanation } from '@sparksocial/shared';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/**
 * `ScopedDb['engagement']` backed by Postgres. Never touches
 * `engagement_messages` directly; delegates to `scoped.ts`, the only module
 * the isolation test permits to import scoped tables.
 */
export function createEngagementRepository(db: Database): EngagementStore {
  return {
    async ingest({ genomeId, orgId, ...args }) {
      const row = await scoped.ingestEngagementMessage(db, { orgId, brandId: orgId, genomeId }, args);
      return toMessage(row);
    },

    async get(id, genomeId, orgId) {
      const row = await scoped.getEngagementMessage(db, { orgId, brandId: orgId, genomeId }, id);
      return row ? toMessage(row) : undefined;
    },

    async classify({ genomeId, orgId, ...args }) {
      const row = await scoped.classifyEngagementMessage(db, { orgId, brandId: orgId, genomeId }, args);
      return row ? toMessage(row) : undefined;
    },

    async list(genomeId, orgId, args) {
      const rows = await scoped.listEngagementMessages(db, { orgId, brandId: orgId, genomeId }, args);
      return rows.map(toMessage);
    },

    async audit(genomeId, orgId, args) {
      const rows = await scoped.auditEngagementMessages(db, { orgId, brandId: orgId, genomeId }, args);
      return rows.map(toMessage);
    },

    async markReplied({ id, genomeId, orgId }) {
      const row = await scoped.markEngagementMessageReplied(db, { orgId, brandId: orgId, genomeId }, { id });
      return row ? toMessage(row) : undefined;
    },

    async markAutoHandled({ id, genomeId, orgId }) {
      const row = await scoped.markEngagementMessageAutoHandled(db, { orgId, brandId: orgId, genomeId }, { id });
      return row ? toMessage(row) : undefined;
    },

    async markEscalated({ id, genomeId, orgId }) {
      const row = await scoped.markEngagementMessageEscalated(db, { orgId, brandId: orgId, genomeId }, { id });
      return row ? toMessage(row) : undefined;
    },
  };
}

function toMessage(row: scoped.EngagementMessageRow): EngagementMessage {
  return {
    id: row.id,
    genomeId: row.genomeId,
    platform: row.platform,
    externalId: row.externalId,
    kind: row.kind,
    authorHandle: row.authorHandle,
    ...(row.authorName ? { authorName: row.authorName } : {}),
    text: row.text,
    ...(row.contentItemId ? { contentItemId: row.contentItemId } : {}),
    receivedAt: row.receivedAt,
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt } : {}),
    status: row.status,
    ...(row.category ? { category: row.category } : {}),
    ...(row.intentScore !== null ? { intentScore: row.intentScore } : {}),
    ...(row.suggestedReply ? { suggestedReply: row.suggestedReply } : {}),
    ...(row.why !== null ? { why: row.why as Explanation } : {}),
    createdAt: row.createdAt,
  };
}
