import type { RunStatus, RunTrigger, StepType } from '@sparksocial/shared/types';
import type { AgentName } from './agents.js';

/**
 * AGENT RUN RECORDING — master plan §5 (`agent_runs`, `agent_steps`) and §4.5.
 *
 * The Agent Timeline is "the trust mechanism that makes autopublish acceptable,
 * and it is a Phase-1 deliverable, not polish". These are the rows it renders.
 *
 * Deliberately separate from `tool_calls`: a tool call is one invocation with its
 * own governance decision; a *step* is what the agent did, including the parts
 * that were never a tool call — thinking, delegating, waiting on a human. A
 * timeline built only from `tool_calls` cannot answer "why is this here?",
 * because the reasoning between the calls is exactly what's missing.
 */

/**
 * Re-exported rather than redeclared: `ScopedDb.runs` (the Timeline's read side)
 * is typed against the same three unions from `@sparksocial/shared`, and a
 * second declaration here would let the writer and the reader drift apart.
 */
export type { RunTrigger, RunStatus, StepType };

export interface AgentRun {
  id: string;
  brandId: string;
  agent: AgentName;
  goal: string;
  trigger: RunTrigger;
  status: RunStatus;
  costCents: number;
  tokens: { input: number; output: number };
  traceId?: string;
  /** Set on a delegated subagent run, pointing at the orchestrator's run. */
  parentRunId?: string;
  startedAt: Date;
  endedAt?: Date;
  error?: { code: string; message: string };
}

export interface AgentStep {
  runId: string;
  /** Monotonic within the run, so the timeline renders in order without sorting on time. */
  idx: number;
  type: StepType;
  payload: unknown;
  ms: number;
  at: Date;
}

export interface RunRecorder {
  startRun(run: Omit<AgentRun, 'status' | 'costCents' | 'tokens'>): Promise<void>;
  appendStep(step: AgentStep): Promise<void>;
  finishRun(
    id: string,
    patch: Pick<AgentRun, 'status'> & Partial<Pick<AgentRun, 'costCents' | 'tokens' | 'endedAt' | 'error'>>,
  ): Promise<void>;
}

/** In-memory recorder for dev and tests. Production writes `agent_runs` / `agent_steps`. */
export function memoryRunRecorder(): RunRecorder & { runs: AgentRun[]; steps: AgentStep[] } {
  const runs: AgentRun[] = [];
  const steps: AgentStep[] = [];
  return {
    runs,
    steps,
    async startRun(run) {
      runs.push({ ...run, status: 'running', costCents: 0, tokens: { input: 0, output: 0 } });
    },
    async appendStep(step) {
      steps.push(step);
    },
    async finishRun(id, patch) {
      const run = runs.find((r) => r.id === id);
      if (run) Object.assign(run, patch);
    },
  };
}

/**
 * Tracks step ordering for one run. Kept as a tiny class rather than an index the
 * caller passes around because an off-by-one on `idx` silently reorders a
 * timeline, and the timeline is the artefact people use to decide whether to
 * trust the agent.
 */
export class StepSequence {
  private idx = 0;
  constructor(
    private readonly runId: string,
    private readonly recorder: RunRecorder,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(type: StepType, payload: unknown, ms: number): Promise<void> {
    await this.recorder.appendStep({ runId: this.runId, idx: this.idx++, type, payload, ms, at: this.now() });
  }
}
