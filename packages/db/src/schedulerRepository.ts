import type { Database } from './client.js';
import { findDueContentItems, type DueContentItem } from './scoped.js';

/**
 * The scheduler's one read — deliberately not part of `ScopedDb`. Every
 * `ScopedDb` accessor is genome-scoped because a tool handler acts on behalf
 * of one tenant; `apps/api/src/scheduler.ts` is not a tool handler, it is the
 * system looking for whatever is due across every tenant. Kept as its own
 * tiny repository, same pattern as `runReadRepository.ts`/
 * `toolCallReadRepository.ts` for the other reads that don't belong on
 * `ScopedDb` either.
 */
export interface DueContentSource {
  findDue(before: Date, limit: number): Promise<DueContentItem[]>;
}

export function createDueContentSource(db: Database): DueContentSource {
  return {
    findDue: (before, limit) => findDueContentItems(db, { before, limit }),
  };
}

export type { DueContentItem };
