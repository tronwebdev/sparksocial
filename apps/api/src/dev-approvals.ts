import { randomUUID } from 'node:crypto';
import { ToolError } from '@sparksocial/shared';
import type { ApprovalStore, PendingApproval } from '@sparksocial/tools/defineTool';
import type { ToolCallRecord } from '@sparksocial/tools';

/**
 * In-memory Review queue — the dev counterpart to
 * `packages/db/src/approvalRepository.ts`.
 *
 * `lookupCall` is injected rather than the input being copied in at enqueue
 * time, for the same reason the Postgres version joins back to `tool_calls`:
 * the audit row is the single record of what was called, and a second copy in
 * the queue is a second thing that can be wrong about what a reviewer is
 * approving.
 */
export function createDevApprovalStore(lookupCall: (callId: string) => ToolCallRecord | undefined): ApprovalStore {
  interface Row {
    id: string;
    callId: string;
    orgId: string;
    brandId?: string;
    tool: string;
    ruleId?: string;
    reason?: string;
    status: 'pending' | 'approved' | 'rejected';
    requestedAt: Date;
  }
  const rows = new Map<string, Row>(); // keyed by callId

  const toPending = (r: Row): PendingApproval => {
    const call = lookupCall(r.callId);
    return {
      id: r.id,
      callId: r.callId,
      tool: r.tool,
      input: call?.input,
      requestedAt: r.requestedAt,
      status: r.status,
      ...(r.ruleId ? { ruleId: r.ruleId } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.brandId ? { brandId: r.brandId } : {}),
      ...(call?.genomeId ? { genomeId: call.genomeId } : {}),
      ...(call?.userId ? { requestedBy: call.userId } : {}),
    };
  };

  return {
    async enqueue({ callId, orgId, brandId, tool, ruleId, reason }) {
      // Idempotent on callId, matching the unique index in Postgres.
      if (rows.has(callId)) return;
      rows.set(callId, {
        id: randomUUID(),
        callId,
        orgId,
        status: 'pending',
        requestedAt: new Date(),
        tool,
        ...(brandId ? { brandId } : {}),
        ...(ruleId ? { ruleId } : {}),
        ...(reason ? { reason } : {}),
      });
    },

    async pending(orgId, brandId, limit) {
      return [...rows.values()]
        .filter(
          (r) => r.orgId === orgId && r.status === 'pending' && (brandId === undefined || r.brandId === brandId),
        )
        .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())
        .slice(0, Math.min(Math.max(limit, 1), 100))
        .map(toPending);
    },

    async get(callId, orgId) {
      const r = rows.get(callId);
      // Out of scope reads as absent, never as forbidden.
      return r && r.orgId === orgId ? toPending(r) : undefined;
    },

    async resolve(callId, orgId, outcome, decidedBy) {
      const r = rows.get(callId);
      if (!r || r.orgId !== orgId || r.status !== 'pending') {
        throw new ToolError('NOT_FOUND', 'That approval is not pending.', { callId });
      }
      r.status = outcome;
      void decidedBy;
    },
  };
}
