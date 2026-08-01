import type { ScopedDb } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/**
 * `ScopedDb['content']` backed by Postgres — the guardrail layer's only reader
 * of publishing history (§10's `avatar_saturation` and `duplicate` checks).
 *
 * This module never touches `content_items` directly; both operations delegate
 * to `scoped.ts`, the only module the isolation test (`test/isolation.test.ts`)
 * permits to import scoped tables.
 */
export function createContentRepository(db: Database): ScopedDb['content'] {
  return {
    async recent(genomeId, orgId, windowDays) {
      return scoped.recentContent(db, { orgId, brandId: orgId, genomeId }, windowDays);
    },
  };
}

/** Marks a content item published, with its copy's embedding — the write side of `recent()`. */
export async function markPublished(
  db: Database,
  args: { id: string; orgId: string; embedding: number[]; publishedAt?: Date },
): Promise<void> {
  return scoped.markContentPublished(db, { orgId: args.orgId }, args);
}
