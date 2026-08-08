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

/**
 * Synthetic run history for local development — the Timeline equivalent of the
 * golden-set seeding in `dev-store.ts`. Covers the three states the UI has to
 * render differently (succeeded, failed, still running) plus a refused tool
 * call, which is the step people most need to see and the one that never shows
 * up in a happy-path demo.
 *
 * Fire-and-forget: the store's writes are synchronous under the hood, and a
 * seeding failure must not stop the API from booting.
 */
export function seedDevRuns(store: DevRunStore, brandIds: string[]): void {
  const brandId = brandIds[0];
  if (!brandId) return;

  const base = Date.now() - 45 * 60_000;
  const at = (offsetMs: number) => new Date(base + offsetMs);

  void (async () => {
    await store.recorder.startRun({
      id: 'run_dev_succeeded', brandId, agent: 'spark',
      goal: 'Plan this week’s capture session', trigger: 'user', startedAt: at(0),
    });
    await store.recorder.appendStep({
      runId: 'run_dev_succeeded', idx: 0, type: 'think',
      payload: { text: 'Checking which playbooks this genome can actually make.' }, ms: 820, at: at(100),
    });
    await store.recorder.appendStep({
      runId: 'run_dev_succeeded', idx: 1, type: 'tool',
      payload: { tool: 'playbook.resolve', status: 'succeeded' }, ms: 140, at: at(1_000),
    });
    await store.recorder.appendStep({
      runId: 'run_dev_succeeded', idx: 2, type: 'tool',
      payload: { tool: 'direct.session.batch', status: 'succeeded' }, ms: 310, at: at(1_200),
    });
    await store.recorder.finishRun('run_dev_succeeded', {
      status: 'succeeded', costCents: 7, tokens: { input: 4_120, output: 880 }, endedAt: at(2_400),
    });

    await store.recorder.startRun({
      id: 'run_dev_failed', brandId, agent: 'producer',
      goal: 'Publish the approved clip', trigger: 'schedule', startedAt: at(600_000),
    });
    await store.recorder.appendStep({
      runId: 'run_dev_failed', idx: 0, type: 'tool',
      // The refusal path: scope enforcement declining a call the model asked
      // for. Showing this is most of why the Timeline exists.
      payload: { tool: 'publish.now', refused: 'out of scope for this agent' }, ms: 12, at: at(600_100),
    });
    await store.recorder.finishRun('run_dev_failed', {
      status: 'failed', costCents: 1, tokens: { input: 900, output: 60 }, endedAt: at(601_000),
      error: { code: 'FORBIDDEN', message: 'No publishing adapter is configured yet.' },
    });

    await store.recorder.startRun({
      id: 'run_dev_running', brandId, agent: 'analyst',
      goal: 'Summarise last week’s posts', trigger: 'user', startedAt: new Date(Date.now() - 4_000),
    });
    await store.recorder.appendStep({
      runId: 'run_dev_running', idx: 0, type: 'think',
      payload: { text: 'Gathering published items in the trailing window.' }, ms: 640,
      at: new Date(Date.now() - 3_500),
    });
  })();
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
