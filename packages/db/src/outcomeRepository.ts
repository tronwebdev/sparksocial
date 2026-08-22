import type { Database } from './client.js';
import { findMetricsSyncDue, findOutcomeRecordDue, type OutcomeCandidateRow } from './scoped.js';

/**
 * The outcome loop's two reads — deliberately **not** part of `ScopedDb`.
 *
 * Same reasoning as `schedulerRepository.ts`, and it is worth restating because
 * this is the choice that keeps CLAUDE.md invariant 2 intact. Every `ScopedDb`
 * accessor is genome-scoped because a tool handler acts on behalf of exactly one
 * tenant. These two reads are cross-tenant by necessity — the caller is a clock,
 * and a clock has no session to be scoped to. Putting them on `ScopedDb` would
 * put a cross-tenant query within reach of every tool handler in the registry,
 * which is precisely the thing the scoped layer exists to prevent.
 *
 * Kept here instead, where only `apps/api/src/outcome-observer.ts` reaches for
 * it, the same shape as `schedulerRepository.ts` / `runReadRepository.ts` /
 * `toolCallReadRepository.ts`.
 *
 * Every row carries its own `orgId` and `genomeId`, and the observer is required
 * to use them: the work it triggers goes through `invokeTool` under that
 * tenant's own governance, exactly as a scheduled publish does.
 */
export interface OutcomeCandidateSource {
  /**
   * Published posts whose metrics have gone stale, on an age-widening cadence.
   * See {@link findMetricsSyncDue} for why the interval is not fixed.
   */
  findMetricsDue(args: { now: Date; limit: number; trackingDays?: number }): Promise<OutcomeCandidateRow[]>;
  /**
   * Published posts old enough to score, with at least one metrics snapshot and
   * no outcome recorded yet. See {@link findOutcomeRecordDue} for why the
   * maturation window is not optional.
   */
  findOutcomesDue(args: { now: Date; limit: number; maturationHours?: number }): Promise<OutcomeCandidateRow[]>;
}

export function createOutcomeCandidateSource(db: Database): OutcomeCandidateSource {
  return {
    findMetricsDue: (args) => findMetricsSyncDue(db, args),
    findOutcomesDue: (args) => findOutcomeRecordDue(db, args),
  };
}

export type { OutcomeCandidateRow };
