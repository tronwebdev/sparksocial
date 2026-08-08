import { and, asc, desc, eq } from 'drizzle-orm';
import type { AgentRun, RunRecorder } from '@sparksocial/spark';
import type { RunDetail, RunSummary, ScopedDb } from '@sparksocial/tools/defineTool';
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

/**
 * `ScopedDb['runs']` — the Agent Timeline's read side (plan §4.5), deliberately
 * separate from `RunRecorder` above: that interface writes, this one only reads.
 *
 * Both scope on `brand_id`, which is indexed (`agent_runs_brand_idx`), and both
 * return `undefined`/`[]` rather than throwing when nothing matches, so a caller
 * probing run ids learns nothing about another brand's runs.
 */
export function createRunReadRepository(db: Database): ScopedDb['runs'] {
  return {
    async list(brandId, limit) {
      const rows = await db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.brandId, brandId))
        .orderBy(desc(agentRuns.startedAt))
        // `limit` is validated to 1..100 by the tool's schema, but it is bound
        // here too: the store is reachable from SPARK as well as the UI, and an
        // unbounded ORDER BY over a brand's whole history is the query that
        // takes the API down first.
        .limit(Math.min(Math.max(limit, 1), 100));
      return rows.map(toSummary);
    },

    async get(runId, brandId) {
      const [row] = await db
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.brandId, brandId)))
        .limit(1);
      if (!row) return undefined;

      // Two queries rather than a join: a join would repeat every run column
      // once per step, and a long run has hundreds of steps. The scope check
      // already happened on the run row above, so steps are safe to fetch by
      // `run_id` alone — they carry no brand of their own.
      const steps = await db
        .select()
        .from(agentSteps)
        .where(eq(agentSteps.runId, runId))
        .orderBy(asc(agentSteps.idx));

      const detail: RunDetail = {
        ...toSummary(row),
        tokens: { input: row.inputTokens, output: row.outputTokens },
        ...(row.error ? { error: row.error as RunDetail['error'] } : {}),
        steps: steps.map((s) => ({
          idx: s.idx,
          type: s.type as RunDetail['steps'][number]['type'],
          payload: s.payload,
          ms: s.ms,
          at: s.at,
        })),
      };
      return detail;
    },
  };
}

function toSummary(row: typeof agentRuns.$inferSelect): RunSummary {
  return {
    id: row.id,
    agent: row.agent,
    goal: row.goal,
    trigger: row.trigger as RunSummary['trigger'],
    status: row.status as RunSummary['status'],
    costCents: row.costCents,
    startedAt: row.startedAt,
    ...(row.endedAt ? { endedAt: row.endedAt } : {}),
    ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
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
