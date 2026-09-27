import type { Database } from './client.js';
import { findUnrenderedContentItems, type UnrenderedContentItem } from './scoped.js';

/**
 * The render queue's one read — deliberately not part of `ScopedDb`, for the
 * same reason `schedulerRepository.ts` is not: every `ScopedDb` accessor is
 * genome-scoped because a tool handler acts for one tenant, and this is the
 * system looking across all of them for work nobody has done.
 */
export interface UnrenderedContentSource {
  /**
   * `excludePlaybookIds` keeps formats with no pixels out of the batch at the
   * query — see the note in `findUnrenderedContentItems` about the
   * head-of-line block that skipping them in the caller caused.
   */
  findUnrendered(limit: number, excludePlaybookIds?: string[]): Promise<UnrenderedContentItem[]>;
}

export function createUnrenderedContentSource(db: Database): UnrenderedContentSource {
  return {
    findUnrendered: (limit, excludePlaybookIds) =>
      findUnrenderedContentItems(db, { limit, ...(excludePlaybookIds ? { excludePlaybookIds } : {}) }),
  };
}

export type { UnrenderedContentItem };
