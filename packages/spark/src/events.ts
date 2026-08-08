import type { AgentRun, AgentStep, RunRecorder } from './run.js';

/**
 * RUN EVENT BUS — the substrate under the Agent Timeline's live view (plan §2.1,
 * "SSE (agent + job stream)").
 *
 * The Timeline has to be watchable *while* a run is happening, not only after it
 * finishes. Polling `agent.run.get` would work and would also mean every open
 * timeline hammers Postgres on a timer for runs that mostly aren't changing. So
 * the recorder — which already sits on the exact write path — publishes, and the
 * SSE transport subscribes.
 *
 * ── Scope limit, stated plainly ────────────────────────────────────────────
 * This bus is **in-process**. With more than one Container Apps replica, a
 * client whose SSE connection landed on replica B will not see events published
 * on replica A; it still converges, because the transport replays from the
 * database on connect and the client can refetch on reconnect, but live updates
 * are per-replica until this is backed by Redis pub/sub (Azure Cache for Redis
 * is already in the stack for idempotency keys and rate limits — the swap is
 * this interface, unchanged, over a Redis channel per run).
 *
 * Until then: correctness does not depend on the bus. Every event it carries is
 * also durably in `agent_runs` / `agent_steps`, so a missed event costs
 * freshness, never truth.
 */

export type RunEvent =
  | { kind: 'started'; runId: string; agent: string; goal: string; startedAt: string }
  | { kind: 'step'; runId: string; idx: number; type: AgentStep['type']; payload: unknown; ms: number; at: string }
  | { kind: 'finished'; runId: string; status: AgentRun['status']; costCents?: number; endedAt?: string };

export type RunEventListener = (event: RunEvent) => void;

export interface RunEventBus {
  publish(event: RunEvent): void;
  /** Returns an unsubscribe function. Always call it — see the leak note below. */
  subscribe(runId: string, listener: RunEventListener): () => void;
  /** Live subscriber count, for the health endpoint and for tests. */
  subscriberCount(): number;
  /**
   * Number of runs currently tracked. Distinct from `subscriberCount` on
   * purpose: the leak this bus can develop is *empty* per-run entries that are
   * never reclaimed, which leaves the subscriber count at zero while the Map
   * grows without bound. Only this number makes that visible.
   */
  trackedRunCount(): number;
}

/**
 * In-process bus.
 *
 * The listener set is deleted when it empties rather than left as an empty Set:
 * a long-lived server that opened one timeline per run would otherwise
 * accumulate a Map entry per run forever, which is a slow leak that only shows
 * up in production after weeks of uptime.
 */
export function memoryRunEventBus(): RunEventBus {
  const listeners = new Map<string, Set<RunEventListener>>();

  return {
    publish(event) {
      const set = listeners.get(event.runId);
      if (!set) return;
      // Iterate a snapshot. A live Set would also hand this loop any listener
      // *added* during delivery — a subscriber that resubscribes on an event
      // would then be re-entered within the same publish, and in the worst case
      // never terminate. A snapshot fixes the recipient list to exactly those
      // subscribed when the event was published.
      for (const listener of [...set]) {
        try {
          listener(event);
        } catch {
          // One broken subscriber must not stop the others, and must never
          // propagate into the agent loop that published the event.
        }
      }
    },

    subscribe(runId, listener) {
      let set = listeners.get(runId);
      if (!set) {
        set = new Set();
        listeners.set(runId, set);
      }
      set.add(listener);

      let released = false;
      return () => {
        if (released) return; // idempotent: SSE cleanup can fire twice
        released = true;
        const current = listeners.get(runId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) listeners.delete(runId);
      };
    },

    subscriberCount() {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },

    trackedRunCount: () => listeners.size,
  };
}

/**
 * Decorates any `RunRecorder` so writes also publish to the bus.
 *
 * A decorator rather than an option on each recorder: the Postgres recorder and
 * the in-memory one then stream identically, and the agent loop stays unaware
 * that anyone is watching. Publishing happens *after* the durable write, so a
 * client can never be told about a step that failed to persist.
 */
export function broadcastingRecorder(recorder: RunRecorder, bus: RunEventBus): RunRecorder {
  return {
    async startRun(run) {
      await recorder.startRun(run);
      bus.publish({
        kind: 'started',
        runId: run.id,
        agent: run.agent,
        goal: run.goal,
        startedAt: run.startedAt.toISOString(),
      });
    },

    async appendStep(step) {
      await recorder.appendStep(step);
      bus.publish({
        kind: 'step',
        runId: step.runId,
        idx: step.idx,
        type: step.type,
        payload: step.payload,
        ms: step.ms,
        at: step.at.toISOString(),
      });
    },

    async finishRun(id, patch) {
      await recorder.finishRun(id, patch);
      bus.publish({
        kind: 'finished',
        runId: id,
        status: patch.status,
        ...(patch.costCents !== undefined ? { costCents: patch.costCents } : {}),
        ...(patch.endedAt ? { endedAt: patch.endedAt.toISOString() } : {}),
      });
    },
  };
}
