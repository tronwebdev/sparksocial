/**
 * The client's view of `POST /v1/agent/runs`, mirroring `tools.ts`'s `invoke()`
 * shape so callers handle both the same way — but this hits the second proxy
 * (`src/app/api/agent/runs/route.ts`), not the tool one: starting a run isn't
 * a registry call. See CLAUDE.md's Frontend rules for why there are two.
 */

export interface AgentRunResult {
  runId: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  /** SPARK's reply — the chat turn's actual content. */
  text: string;
  toolCallIds: string[];
}

export type AgentRunOutcome =
  | { status: 'succeeded'; run: AgentRunResult }
  | { status: 'failed'; error: { code: string; message: string } };

interface ErrorBody {
  error: { code: string; message: string };
}

function hasError(body: unknown): body is ErrorBody {
  return typeof body === 'object' && body !== null && 'error' in body;
}

export async function startAgentRun(goal: string, agent?: string): Promise<AgentRunOutcome> {
  const res = await fetch('/api/agent/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal, ...(agent ? { agent } : {}) }),
  });

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok || !body || hasError(body)) {
    return {
      status: 'failed',
      error: hasError(body) ? body.error : { code: 'UNKNOWN', message: `Request failed (${res.status}).` },
    };
  }

  /**
   * `runAgent()` (`packages/spark/src/loop.ts`) answers HTTP 200 with a body
   * shaped like `RunResult` even when the run itself failed — a model
   * refusal, or an exception mid-loop — and that shape carries `status:
   * 'failed'`, not a top-level `error` key. `hasError` above only catches the
   * transport-level failure shape (`{error: {...}}`), so a semantically
   * failed run was passing through as `succeeded` with an empty `text`,
   * which is exactly what produced a silent "(no reply)" bubble instead of
   * an explanation. Check the run's own status too, not just the envelope.
   */
  const run = body as AgentRunResult;
  if (run.status !== 'succeeded') {
    return {
      status: 'failed',
      error: {
        code: run.status.toUpperCase(),
        message: run.text || `SPARK's run did not complete (status: ${run.status}).`,
      },
    };
  }

  return { status: 'succeeded', run };
}
