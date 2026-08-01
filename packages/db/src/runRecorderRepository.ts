import { and, eq } from 'drizzle-orm';
import type { AgentRun, RunRecorder } from '@sparksocial/spark';
import type { Database } from './client.js';
import { agentRuns, agentSteps } from './schema.js';

/**
 * `agent_runs` / `agent_steps` backed by Postgres — the Agent Timeline's data
 * source (plan §4.5). Unlike `tool_calls`, a run is insert-then-update:
 * `startRun` writes `status: 'running'`, `finishRun` updates the same row.
 * Steps are append-only, never updated.
 */
export function createRunRecorder(db: Database): RunRecorder {
  return {
    async startRun(run) {
      await db.insert(agentRuns).values({
        id: run.id,
        brandId: run.brandId,
        agent: run.agent,
        goal: run.goal,
        trigger: run.trigger,
        status: 'running',
        costCents: 0,
        inputTokens: 0,
        outputTokens: 0,
        traceId: run.traceId ?? null,
        parentRunId: run.parentRunId ?? null,
        startedAt: run.startedAt,
      });
    },

    async appendStep(step) {
      await db.insert(agentSteps).values({
        runId: step.runId,
        idx: step.idx,
        type: step.type,
        payload: step.payload as object | null,
        ms: step.ms,
        at: step.at,
      });
    },

    async finishRun(id, patch) {
      const update: Partial<typeof agentRuns.$inferInsert> = { status: patch.status };
      if (patch.costCents !== undefined) update.costCents = patch.costCents;
      if (patch.tokens) {
        update.inputTokens = patch.tokens.input;
        update.outputTokens = patch.tokens.output;
      }
      if (patch.endedAt) update.endedAt = patch.endedAt;
      if (patch.error) update.error = patch.error;
      await db.update(agentRuns).set(update).where(eq(agentRuns.id, id));
    },
  };
}

/** Read-side helper the Agent Timeline UI will call — not part of `RunRecorder`. */
export async function getRun(db: Database, id: string, brandId: string): Promise<AgentRun | undefined> {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, id), eq(agentRuns.brandId, brandId)))
    .limit(1);
  if (!row) return undefined;
  return {
    id: row.id,
    brandId: row.brandId,
    agent: row.agent as AgentRun['agent'],
    goal: row.goal,
    trigger: row.trigger as AgentRun['trigger'],
    status: row.status as AgentRun['status'],
    costCents: row.costCents,
    tokens: { input: row.inputTokens, output: row.outputTokens },
    ...(row.traceId ? { traceId: row.traceId } : {}),
    ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
    startedAt: row.startedAt,
    ...(row.endedAt ? { endedAt: row.endedAt } : {}),
    ...(row.error ? { error: row.error as AgentRun['error'] } : {}),
  };
}
