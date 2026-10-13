import type { Database } from './client.js';
import { findUndraftedContentItems, type UndraftedContentItem } from './scoped.js';

/**
 * The draft queue's one read — deliberately not part of `ScopedDb`, for the same
 * reason `renderQueueRepository.ts` and `schedulerRepository.ts` are not: every
 * `ScopedDb` accessor is genome-scoped because a tool handler acts for one
 * tenant, and this is the system looking across all of them for work nobody has
 * done.
 *
 * Each row carries its own `orgId` and `genomeId`, and the work it triggers runs
 * through that tenant's own governance — the same contract the other two
 * cross-tenant sources keep.
 */
export interface UndraftedContentSource {
  /**
   * Slots due at or before `before` that still have no copy.
   *
   * The caller passes the lookahead horizon rather than this file owning one, so
   * the window is a deployment knob and not a constant buried in a repository.
   */
  findUndrafted(before: Date, limit: number): Promise<UndraftedContentItem[]>;
}

export function createUndraftedContentSource(db: Database): UndraftedContentSource {
  return {
    findUndrafted: (before, limit) => findUndraftedContentItems(db, { before, limit }),
  };
}

export type { UndraftedContentItem };
