import { and, desc, eq } from 'drizzle-orm';
import { ToolError } from '@sparksocial/shared';
import type { ApprovalStore, PendingApproval } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { approvals, toolCalls } from './schema.js';

/**
 * The Review queue, backed by Postgres — PRD §7.5, plan §4.4.
 *
 * Two tables, on purpose. `approvals` holds the lifecycle (pending → decided);
 * `tool_calls` holds what was actually called. Reads join back to `tool_calls`
 * for the tool, the input and the scope, so the queue can never drift from the
 * call it is gating — there is one copy of that data and it is the audit row.
 */
export function createApprovalRepository(db: Database): ApprovalStore {
  return {
    async enqueue({ callId, orgId, brandId, tool, ruleId, reason }) {
      await db
        .insert(approvals)
        .values({
          callId,
          orgId,
          brandId: brandId ?? null,
          tool,
          ruleId: ruleId ?? null,
          reason: reason ?? null,
          status: 'pending',
        })
        // A retried call that gates again must not enqueue a second review item
        // for the same decision — the reviewer would see the same post twice
        // and approving one would leave the other stranded.
        .onConflictDoNothing({ target: approvals.callId });
    },

    async pending(orgId, brandId, limit) {
      const rows = await db
        .select({
          id: approvals.id,
          callId: approvals.callId,
          tool: approvals.tool,
          ruleId: approvals.ruleId,
          reason: approvals.reason,
          requestedAt: approvals.requestedAt,
          input: toolCalls.input,
          genomeId: toolCalls.genomeId,
          userId: toolCalls.userId,
        })
        .from(approvals)
        .leftJoin(toolCalls, eq(approvals.callId, toolCalls.id))
        .where(
          and(
            eq(approvals.orgId, orgId),
            eq(approvals.status, 'pending'),
            brandId ? eq(approvals.brandId, brandId) : undefined,
          ),
        )
        .orderBy(desc(approvals.requestedAt))
        .limit(Math.min(Math.max(limit, 1), 100));

      return rows.map(toPending);
    },

    async get(callId, orgId) {
      const [row] = await db
        .select({
          id: approvals.id,
          callId: approvals.callId,
          tool: approvals.tool,
          ruleId: approvals.ruleId,
          reason: approvals.reason,
          requestedAt: approvals.requestedAt,
          status: approvals.status,
          brandId: approvals.brandId,
          input: toolCalls.input,
          genomeId: toolCalls.genomeId,
          userId: toolCalls.userId,
        })
        .from(approvals)
        .leftJoin(toolCalls, eq(approvals.callId, toolCalls.id))
        // Scoped on org, so an approval id from another tenant reads as absent
        // rather than forbidden — probing ids confirms nothing.
        .where(and(eq(approvals.callId, callId), eq(approvals.orgId, orgId)))
        .limit(1);

      if (!row) return undefined;
      return { ...toPending(row), status: row.status, brandId: row.brandId ?? undefined };
    },

    async resolve(callId, orgId, outcome, decidedBy) {
      const updated = await db
        .update(approvals)
        .set({ status: outcome, decidedBy, decidedAt: new Date() })
        .where(
          and(
            eq(approvals.callId, callId),
            eq(approvals.orgId, orgId),
            // Only a *pending* item can be decided. Without this, two reviewers
            // clicking at once would both believe they made the call, and an
            // approve could silently overwrite a reject.
            eq(approvals.status, 'pending'),
          ),
        )
        .returning({ id: approvals.id });

      if (updated.length === 0) {
        throw new ToolError('NOT_FOUND', 'That approval is not pending.', { callId });
      }
    },
  };
}

function toPending(row: {
  id: string;
  callId: string;
  tool: string;
  ruleId: string | null;
  reason: string | null;
  requestedAt: Date;
  input: unknown;
  genomeId: string | null;
  userId: string | null;
}): PendingApproval {
  return {
    id: row.id,
    callId: row.callId,
    tool: row.tool,
    input: row.input,
    requestedAt: row.requestedAt,
    ...(row.ruleId ? { ruleId: row.ruleId } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.genomeId ? { genomeId: row.genomeId } : {}),
    ...(row.userId ? { requestedBy: row.userId } : {}),
  };
}
