import type { Langfuse } from 'langfuse';
import type { AgentStep, RunRecorder } from '@sparksocial/spark';
import { maskValue } from './langfuse-mask.js';

/**
 * LANGFUSE TRACING FOR AGENT RUNS — plan §2.2, §11.
 *
 * Wraps `RunRecorder` the same way `broadcastingRecorder` wraps it for SSE: the
 * recorder already sits on the exact write path for everything the agent does,
 * so decorating it captures thinking, tool calls, delegation and waits without
 * the loop knowing anyone is watching.
 *
 * ── Why this exists on top of the tool-call tracing ────────────────────────
 * `telemetry.ts` traces `tool_calls`, which is what the *governance* layer
 * sees. That is not what Langfuse is for. A trace made only of tool calls has a
 * hole exactly where the reasoning was: it shows that `playbook.resolve` ran
 * and not why the model chose it, and it contains no model, no tokens and no
 * cost — the three things the product is billed on.
 *
 * ── Observation types, per Langfuse's instrumentation guidance ─────────────
 *   `think`    → **generation**. It is an LLM call, so it carries `model` and
 *                token usage and is priced as one. Typing it as a plain span
 *                is the specific mistake that makes cost attribution
 *                impossible.
 *   `delegate` → **agent**. Their guidance is explicit that subagent dispatch
 *                is typed `agent` rather than `tool`/`span`, because that is
 *                what renders the Agent Graph — and SPARK's whole topology is
 *                an orchestrator plus nine subagents (§4.1).
 *   `tool`     → **span**, named for the tool.
 *   `wait`     → **span**. Time parked on a human is real latency and belongs
 *                on the trace; the capture loop can wait days.
 *
 * Names are derived from the agent and tool rather than left generic, so two
 * nodes in a graph are distinguishable — also from their guidance.
 *
 * Nothing here may throw into the agent loop. A tracing outage that failed a
 * run would trade the product for its telemetry.
 */
export function langfuseRecorder(inner: RunRecorder, langfuse: Langfuse): RunRecorder {
  return {
    async startRun(run) {
      await inner.startRun(run);
      try {
        langfuse.trace({
          id: run.id,
          // Descriptive, not `trace-1`: the agent that ran is the first thing
          // you filter on when something looks wrong.
          name: `spark.${run.agent}`,
          // The brand is the tenant boundary, so it is what cost and quality
          // get segmented by.
          userId: run.brandId,
          // Groups a delegated subagent run with the orchestrator run that
          // spawned it; a standalone run is its own session.
          sessionId: run.parentRunId ?? run.id,
          input: { goal: run.goal },
          tags: [`agent:${run.agent}`, `trigger:${run.trigger}`],
          metadata: { trigger: run.trigger, parentRunId: run.parentRunId },
        });
      } catch {
        /* tracing is never load-bearing */
      }
    },

    async appendStep(step) {
      await inner.appendStep(step);
      try {
        emitObservation(langfuse, step);
      } catch {
        /* tracing is never load-bearing */
      }
    },

    async finishRun(id, patch) {
      await inner.finishRun(id, patch);
      try {
        langfuse.trace({
          id,
          output: { status: patch.status },
          metadata: {
            status: patch.status,
            costCents: patch.costCents,
            ...(patch.error ? { errorCode: patch.error.code } : {}),
          },
        });
      } catch {
        /* tracing is never load-bearing */
      }
    },
  };
}

function emitObservation(langfuse: Langfuse, step: AgentStep): void {
  const trace = langfuse.trace({ id: step.runId });
  const payload = (step.payload ?? {}) as Record<string, unknown>;
  const endTime = step.at;
  const startTime = new Date(step.at.getTime() - step.ms);

  switch (step.type) {
    case 'think': {
      const usage = payload.usage as { input?: number; output?: number } | undefined;
      trace.generation({
        name: 'turn',
        // Explicit, because a manual trace has no integration to infer it.
        model: typeof payload.model === 'string' ? payload.model : undefined,
        startTime,
        endTime,
        // Masked: assistant text is free-form and may restate anything it read.
        output: maskValue({ text: payload.text, toolCalls: payload.toolCalls }),
        ...(usage ? { usage: { input: usage.input, output: usage.output } } : {}),
      });
      return;
    }

    case 'delegate': {
      const to = typeof payload.agent === 'string' ? payload.agent : 'subagent';
      trace.span({
        name: `delegate:${to}`,
        startTime,
        endTime,
        input: maskValue(payload),
        // Typed `agent` so the Agent Graph renders the topology rather than a
        // flat list of indistinguishable spans.
        metadata: { observationType: 'agent', agent: to },
      });
      return;
    }

    case 'tool': {
      const name = typeof payload.tool === 'string' ? payload.tool : 'tool';
      trace.span({
        name,
        startTime,
        endTime,
        input: maskValue(payload),
        // A refusal is the most interesting thing a trace can contain — it is
        // scope enforcement declining something the model asked for.
        ...(payload.refused ? { level: 'WARNING' as const, statusMessage: String(payload.refused) } : {}),
      });
      return;
    }

    case 'wait': {
      trace.span({ name: 'wait', startTime, endTime, input: maskValue(payload) });
      return;
    }
  }
}
