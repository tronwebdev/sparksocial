import type { RunDetail, RunSummary, ScopedDb } from '@sparksocial/tools/defineTool';
import type { AgentRun, AgentStep, RunRecorder } from '@sparksocial/spark';

/**
 * In-memory `agent_runs` / `agent_steps` — the dev counterpart to
 * `packages/db/src/runRecorderRepository.ts`.
 *
 * Deliberately implements *both* sides against one set of arrays: the recorder
 * that the agent loop writes through, and the `ScopedDb['runs']` reader the
 * Timeline tools call. Splitting them across two fixtures is how you end up with
 * a dev timeline that renders runs nobody recorded.
 *
 * Scoping mirrors Postgres exactly — every read filters on `brandId`, and an
 * out-of-scope run reads as absent — so a scoping bug shows up in dev rather
 * than waiting for a real database to expose it.
 */
export interface DevRunStore {
  recorder: RunRecorder;
  reader: ScopedDb['runs'];
  /** Test/inspection hook. Not part of either interface. */
  size(): number;
}

export function createDevRunStore(): DevRunStore {
  const runs = new Map<string, AgentRun>();
  const steps = new Map<string, AgentStep[]>();

  return {
    size: () => runs.size,

    recorder: {
      async startRun(run) {
        runs.set(run.id, { ...run, status: 'running', costCents: 0, tokens: { input: 0, output: 0 } });
        steps.set(run.id, []);
      },

      async appendStep(step) {
        const list = steps.get(step.runId);
        // A step for an unknown run is dropped rather than creating one: a run
        // that was never started has no brand, so a synthesised row would be
        // unscoped — invisible to every reader at best, cross-brand at worst.
        if (list) list.push(step);
      },

      async finishRun(id, patch) {
        const run = runs.get(id);
        if (!run) return;
        Object.assign(run, patch);
      },
    },

    reader: {
      async list(brandId, limit) {
        return [...runs.values()]
          .filter((r) => r.brandId === brandId)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
          .slice(0, Math.min(Math.max(limit, 1), 100))
          .map(toSummary);
      },

      async get(runId, brandId) {
        const run = runs.get(runId);
        if (!run || run.brandId !== brandId) return undefined;
        const detail: RunDetail = {
          ...toSummary(run),
          tokens: run.tokens,
          ...(run.error ? { error: run.error } : {}),
          steps: [...(steps.get(runId) ?? [])]
            .sort((a, b) => a.idx - b.idx)
            .map((s) => ({ idx: s.idx, type: s.type, payload: s.payload, ms: s.ms, at: s.at })),
        };
        return detail;
      },
    },
  };
}

function toSummary(r: AgentRun): RunSummary {
  return {
    id: r.id,
    agent: r.agent,
    goal: r.goal,
    trigger: r.trigger,
    status: r.status,
    costCents: r.costCents,
    startedAt: r.startedAt,
    ...(r.endedAt ? { endedAt: r.endedAt } : {}),
    ...(r.parentRunId ? { parentRunId: r.parentRunId } : {}),
  };
}
