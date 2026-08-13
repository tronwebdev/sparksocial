import { and, eq } from 'drizzle-orm';
import type { Explanation } from '@sparksocial/shared/types';
import type { RecordedCall, ScopedDb } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { toolCalls } from './schema.js';

/**
 * Read side of `tool_calls`, for `agent.explain` — plan §7.3.
 *
 * Deliberately a separate module from `auditRepository.ts` even though both
 * touch one table. That file implements `InvokeDeps` and is INSERT-only by
 * design; this one is SELECT-only and reaches handlers through `ScopedDb`. A
 * single repository exposing both would put an update path one keystroke away
 * from the code that records what the agent did, and the Timeline is only worth
 * trusting because nothing can rewrite it.
 *
 * **Returns a projection, never the row.** `input` and `output` are not
 * selected: they hold genome drafts, recipient phone numbers, draft captions.
 * `agent.explain` answers "why did you do that", and the difference between
 * that and "show me everything you were holding" is the difference between an
 * explainability feature and an exfiltration one.
 */
export function createToolCallReadRepository(db: Database): ScopedDb['toolCalls'] {
  return {
    async get(callId, orgId) {
      const [row] = await db
        .select({
          id: toolCalls.id,
          tool: toolCalls.tool,
          caller: toolCalls.caller,
          decision: toolCalls.decision,
          status: toolCalls.status,
          ruleId: toolCalls.ruleId,
          reason: toolCalls.reason,
          costCents: toolCalls.costCents,
          at: toolCalls.at,
          runId: toolCalls.runId,
          why: toolCalls.why,
        })
        .from(toolCalls)
        // The org predicate is the isolation boundary. Out of scope returns
        // undefined rather than throwing, so probing ids leaks nothing —
        // the same rule as `genomes.get`.
        .where(and(eq(toolCalls.id, callId), eq(toolCalls.orgId, orgId)))
        .limit(1);

      if (!row) return undefined;

      const call: RecordedCall = {
        id: row.id,
        tool: row.tool,
        caller: row.caller === 'agent' ? 'agent' : 'user',
        decision: row.decision,
        status: row.status,
        costCents: row.costCents,
        at: row.at,
        ...(row.ruleId ? { ruleId: row.ruleId } : {}),
        ...(row.reason ? { reason: row.reason } : {}),
        ...(row.runId ? { runId: row.runId } : {}),
        ...(row.why ? { why: row.why as Explanation } : {}),
      };
      return call;
    },
  };
}
