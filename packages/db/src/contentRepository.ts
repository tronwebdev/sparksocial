import type { ContentDraft, RenderRecord, ScopedDb } from '@sparksocial/tools/defineTool';
import type { Explanation } from '@sparksocial/shared';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/**
 * `ScopedDb['content']` backed by Postgres.
 *
 * This module never touches `content_items` directly; every operation
 * delegates to `scoped.ts`, the only module the isolation test
 * (`test/isolation.test.ts`) permits to import scoped tables.
 */
export function createContentRepository(db: Database): ScopedDb['content'] {
  return {
    async recent(genomeId, orgId, windowDays) {
      return scoped.recentContent(db, { orgId, brandId: orgId, genomeId }, windowDays);
    },

    async createDraft({ genomeId, orgId, playbookId, mode, pillar, copy, why, campaignId, recipeId, intent, sourceTrendId, scheduledAt }) {
      const row = await scoped.createContentDraft(
        db,
        { orgId, brandId: orgId, genomeId },
        {
          playbookId,
          mode,
          ...(pillar ? { pillar } : {}),
          copy,
          why,
          ...(campaignId ? { campaignId } : {}),
          ...(recipeId ? { recipeId } : {}),
          ...(intent ? { intent } : {}),
          ...(sourceTrendId ? { sourceTrendId } : {}),
          ...(scheduledAt ? { scheduledAt } : {}),
        },
      );
      return toDraft(row);
    },

    async get(id, genomeId, orgId) {
      const row = await scoped.getContentItem(db, { orgId, brandId: orgId, genomeId }, id);
      return row ? toDraft(row) : undefined;
    },

    async updateDraft({ id, genomeId, orgId, copy, why }) {
      const row = await scoped.updateContentDraft(db, { orgId, brandId: orgId, genomeId }, { id, copy, why });
      return row ? toDraft(row) : undefined;
    },

    async list(genomeId, orgId, args) {
      const rows = await scoped.listContentForGenome(db, { orgId, brandId: orgId, genomeId }, args);
      return rows.map(toDraft);
    },

    async schedule({ id, genomeId, orgId, scheduledAt }) {
      const row = await scoped.scheduleContentItem(db, { orgId, brandId: orgId, genomeId }, { id, scheduledAt });
      return row ? toDraft(row) : undefined;
    },

    async markPublished(args) {
      await scoped.markContentPublished(db, { orgId: args.orgId }, args);
    },

    async markRolledBack(args) {
      await scoped.markContentRolledBack(db, { orgId: args.orgId }, { id: args.id });
    },

    async markBlocked(args) {
      await scoped.markContentBlocked(db, { orgId: args.orgId }, { id: args.id, reason: args.reason });
    },

    async markNeedsReview(args) {
      await scoped.markContentNeedsReview(db, { orgId: args.orgId }, { id: args.id, reason: args.reason });
    },

    async markApproved(args) {
      await scoped.markContentApproved(db, { orgId: args.orgId }, { id: args.id });
    },

    async markRejected(args) {
      await scoped.markContentRejected(db, { orgId: args.orgId }, { id: args.id, reason: args.reason });
    },

    async publishOrigin({ id, genomeId, orgId }) {
      return scoped.contentPublishOrigin(db, { orgId, brandId: orgId, genomeId }, id);
    },

    async pendingReviewCount(genomeId, orgId) {
      return scoped.countPendingReview(db, { orgId, brandId: orgId, genomeId });
    },

    async recordRender(args) {
      const row = await scoped.recordRender(
        db,
        { orgId: args.orgId, brandId: args.orgId, genomeId: args.genomeId },
        args,
      );
      return toRender(row);
    },

    async listRenders(contentItemId, genomeId, orgId) {
      const rows = await scoped.listRenders(db, { orgId, brandId: orgId, genomeId }, contentItemId);
      return rows.map(toRender);
    },
  };
}

function toRender(row: scoped.RenderRow): RenderRecord {
  return {
    id: row.id,
    contentItemId: row.contentItemId,
    aspect: row.aspect,
    storageUrl: row.storageUrl,
    engine: row.engine,
    costCents: row.costCents,
    createdAt: row.createdAt,
  };
}

function toDraft(row: scoped.ContentDraftRow): ContentDraft {
  return {
    id: row.id,
    genomeId: row.genomeId,
    mode: (row.mode === 'synthesize' || row.mode === 'assemble' ? row.mode : 'direct_finish'),
    playbookId: row.playbookId ?? '',
    status: row.status,
    createdAt: row.createdAt,
    ...(row.campaignId ? { campaignId: row.campaignId } : {}),
    ...(row.pillar ? { pillar: row.pillar } : {}),
    ...(row.platform ? { platform: row.platform } : {}),
    ...(row.externalId ? { externalId: row.externalId } : {}),
    ...(row.publishVia ? { via: row.publishVia } : {}),
    ...(row.publishUrl ? { url: row.publishUrl } : {}),
    ...(row.blockedReason ? { blockedReason: row.blockedReason } : {}),
    ...(row.copy !== null ? { copy: row.copy } : {}),
    ...(row.why !== null ? { why: row.why as Explanation } : {}),
    ...(row.scheduledAt ? { scheduledAt: row.scheduledAt } : {}),
    ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
  };
}

/** Marks a content item published, with its copy's embedding — the write side of `recent()`. */
export async function markPublished(
  db: Database,
  args: {
    id: string;
    orgId: string;
    embedding: number[];
    platform?: string;
    externalId?: string;
    via?: string;
    publishedAt?: Date;
  },
): Promise<void> {
  return scoped.markContentPublished(db, { orgId: args.orgId }, {
    ...args,
    platform: args.platform ?? 'instagram',
    externalId: args.externalId ?? 'test',
    via: args.via ?? 'test',
  });
}
