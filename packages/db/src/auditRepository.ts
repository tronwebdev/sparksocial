import { desc, eq } from 'drizzle-orm';
import type { InvokeDeps, ToolCallRecord } from '@sparksocial/tools';
import type { Database } from './client.js';
import { toolCalls } from './schema.js';

/**
 * `tool_calls` backed by Postgres — master plan §5, the P1 acceptance test's
 * artifact. `invokeTool` (`invoke.ts`) writes exactly one row per invocation and
 * never updates it afterward, so this is INSERT-only.
 *
 * Only `writeToolCall` and `lookupIdempotent` are provided — `recordCost`,
 * `runGuardrails`, and `emit` are separate concerns (credit ledger, the
 * guardrails package, queue fan-out) that don't belong to "how audit rows are
 * persisted" and are wired in at the application layer, not here.
 */
export function createAuditRepository(db: Database): Pick<InvokeDeps, 'writeToolCall' | 'lookupIdempotent'> {
  return {
    async writeToolCall(record) {
      await db.insert(toolCalls).values(toRow(record));
    },

    async lookupIdempotent(key) {
      const [row] = await db
        .select()
        .from(toolCalls)
        .where(eq(toolCalls.idempotencyKey, key))
        .orderBy(desc(toolCalls.at))
        .limit(1);
      return row ? fromRow(row) : undefined;
    },
  };
}

function toRow(r: ToolCallRecord) {
  return {
    id: r.id,
    runId: r.runId ?? null,
    userId: r.userId ?? null,
    tool: r.tool,
    version: r.version,
    caller: r.caller,
    orgId: r.orgId,
    brandId: r.brandId ?? null,
    genomeId: r.genomeId ?? null,
    role: r.role,
    input: r.input ?? null,
    output: r.output ?? null,
    effect: r.effect,
    decision: r.decision,
    ruleId: r.ruleId ?? null,
    reason: r.reason ?? null,
    costCents: r.costCents,
    idempotencyKey: r.idempotencyKey ?? null,
    status: r.status,
    error: r.error ?? null,
    why: r.why ?? null,
    at: r.at,
  };
}

function fromRow(row: typeof toolCalls.$inferSelect): ToolCallRecord {
  return {
    id: row.id,
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.userId ? { userId: row.userId } : {}),
    tool: row.tool,
    version: row.version,
    caller: row.caller as ToolCallRecord['caller'],
    orgId: row.orgId,
    ...(row.brandId ? { brandId: row.brandId } : {}),
    ...(row.genomeId ? { genomeId: row.genomeId } : {}),
    role: row.role as ToolCallRecord['role'],
    input: row.input,
    ...(row.output !== null ? { output: row.output } : {}),
    effect: row.effect as ToolCallRecord['effect'],
    decision: row.decision as ToolCallRecord['decision'],
    ...(row.ruleId ? { ruleId: row.ruleId } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    costCents: row.costCents,
    ...(row.idempotencyKey ? { idempotencyKey: row.idempotencyKey } : {}),
    status: row.status as ToolCallRecord['status'],
    ...(row.error ? { error: row.error as ToolCallRecord['error'] } : {}),
    ...(row.why ? { why: row.why as ToolCallRecord['why'] } : {}),
    at: row.at,
  };
}
