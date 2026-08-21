import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { ScopedDb } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { toolCalls } from './schema.js';
import { readSuccessMetrics } from './scoped.js';

/**
 * `ScopedDb['metrics']` — PRD §5's success metrics, read-only.
 *
 * Two halves, because they read two different kinds of thing:
 *
 *  - `successMetrics` is genome-scoped domain data (content, inbox,
 *    opportunities, recipes, connections) and delegates to `scoped.ts`, the only
 *    module permitted to touch those tables.
 *  - `toolActivity` reads `tool_calls`, which is deliberately outside
 *    `SCOPED_TABLES` — it is the audit log, not tenant content — and is queried
 *    here directly, filtered by `orgId` and `genomeId` like every other read.
 *
 * SELECT-only, like `toolCallReadRepository`, and for the same reason: nothing
 * that computes a metric should be one keystroke away from being able to change
 * the rows the metric is computed from.
 */
export function createMetricsRepository(db: Database): ScopedDb['metrics'] {
  return {
    async successMetrics(genomeId, orgId, since) {
      return readSuccessMetrics(db, { orgId, brandId: orgId, genomeId }, since);
    },

    /**
     * One grouped pass over the window rather than six counts.
     *
     * Grouped by `(tool, decision, status)` because that triple is what every
     * number here is a slice of: publish attempts are every row for
     * `publish.now`, holds are the ones whose decision was `approval`, blocks are
     * the ones that failed. Counting them separately would be six scans of the
     * same index for one dashboard.
     */
    async toolActivity(orgId, genomeId, since) {
      const rows = await db
        .select({
          tool: toolCalls.tool,
          decision: toolCalls.decision,
          status: toolCalls.status,
          n: sql<string>`count(*)`,
        })
        .from(toolCalls)
        .where(
          and(
            eq(toolCalls.orgId, orgId),
            eq(toolCalls.genomeId, genomeId),
            gte(toolCalls.at, since),
            inArray(toolCalls.tool, ['publish.now', 'content.draft', 'trend.rank', 'trend.repurpose']),
          ),
        )
        .groupBy(toolCalls.tool, toolCalls.decision, toolCalls.status);

      const sum = (predicate: (r: (typeof rows)[number]) => boolean) =>
        rows.filter(predicate).reduce((acc, r) => acc + Number(r.n), 0);

      return {
        // Every row for `publish.now` is an attempt, whatever became of it —
        // §5's denominator is "attempts", so a refusal counts as one.
        publishAttempts: sum((r) => r.tool === 'publish.now'),
        publishBlocked: sum((r) => r.tool === 'publish.now' && r.status === 'failed'),
        publishHeld: sum((r) => r.tool === 'publish.now' && r.decision === 'approval'),
        // Succeeded only: a refused draft did no drafting, and counting it would
        // inflate "draft edits per post" with work that never happened.
        draftCalls: sum((r) => r.tool === 'content.draft' && r.status === 'succeeded'),
        trendsRanked: sum((r) => r.tool === 'trend.rank' && r.status === 'succeeded'),
        repurposeCalls: sum((r) => r.tool === 'trend.repurpose' && r.status === 'succeeded'),
      };
    },
  };
}
