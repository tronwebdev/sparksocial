'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';

/**
 * THE AGENT TIMELINE (plan §4.5).
 *
 * The trust mechanism behind autopublish: if a user cannot see what SPARK did,
 * they have no basis to let it act unattended. So this renders every step —
 * including the refused tool calls and the failures — rather than a tidy summary.
 *
 * ── Why polling, not the SSE endpoint ──────────────────────────────────────
 * The API does expose `GET /v1/agent/runs/:id/events`, but its event bus is
 * in-process (`packages/spark/src/events.ts`): with more than one Container Apps
 * replica, a stream that lands on replica B never sees events published on
 * replica A. Building the primary read path on that would work in dev and go
 * quietly stale in production. Refetching a running run is correct at any
 * replica count, and stops the moment the run reaches a terminal state — so an
 * idle timeline costs nothing. When the bus is Redis-backed, this becomes a
 * subscription without the surrounding components changing.
 */

const POLL_MS = 2_000;

type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';
type StepType = 'think' | 'tool' | 'delegate' | 'wait';

interface RunSummary {
  runId: string;
  agent: string;
  goal: string;
  trigger: string;
  status: RunStatus;
  costCents: number;
  startedAt: string;
  endedAt?: string;
  durationMs: number | null;
}

interface RunStep {
  idx: number;
  type: StepType;
  payload: unknown;
  ms: number;
  at: string;
}

interface RunDetail extends RunSummary {
  tokens: { input: number; output: number };
  error?: { code: string; message: string };
  steps: RunStep[];
}

const STATUS_TONE: Record<RunStatus, string> = {
  running: 'bg-brand-purple/10 text-brand-purple',
  succeeded: 'bg-success/10 text-success',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-ink-muted/10 text-ink-muted',
};

const STEP_LABEL: Record<StepType, string> = {
  think: 'Thought',
  tool: 'Called a tool',
  delegate: 'Delegated',
  wait: 'Waited',
};

export function RunTimeline() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const res = await invoke<{ runs: RunSummary[] }>('agent.run.list', { limit: 25 });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      setRuns([]);
      return;
    }
    setError(null);
    setRuns(res.output.runs);
    // Select the newest run on first load so the panel is never empty when
    // there is something to show.
    setSelected((current) => current ?? res.output.runs[0]?.runId ?? null);
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  if (error) {
    return (
      <p className="rounded border border-border bg-surface p-4 text-[14px] text-ink-muted">
        Could not load runs: {error}
      </p>
    );
  }

  if (runs === null) {
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded" />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="rounded border border-border bg-surface p-8 text-center">
        <p className="text-[16px] font-medium text-ink">No runs yet</p>
        <p className="mt-1 text-[14px] text-ink-muted">
          When SPARK does something, every step it takes will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <ul className="grid gap-2" aria-label="Agent runs">
        {runs.map((run) => (
          <li key={run.runId}>
            <button
              type="button"
              onClick={() => setSelected(run.runId)}
              aria-current={run.runId === selected}
              className={cn(
                'w-full rounded border p-3 text-left transition-colors',
                run.runId === selected
                  ? 'border-brand-purple bg-brand-purple/5'
                  : 'border-border bg-surface hover:bg-surface-muted',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[14px] font-medium text-ink">{run.goal}</span>
                <StatusBadge status={run.status} />
              </div>
              <p className="mt-1 text-[12px] text-ink-muted">
                {run.agent} · {formatDuration(run.durationMs)} · {formatCost(run.costCents)}
              </p>
            </button>
          </li>
        ))}
      </ul>

      {selected ? (
        <RunDetailPanel runId={selected} detail={detail} setDetail={setDetail} onTerminal={loadRuns} />
      ) : null}
    </div>
  );
}

function RunDetailPanel({
  runId,
  detail,
  setDetail,
  onTerminal,
}: {
  runId: string;
  detail: RunDetail | null;
  setDetail: (d: RunDetail | null) => void;
  onTerminal: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // Held in a ref so the polling effect doesn't re-subscribe every time the
  // parent re-renders — a new interval per render is how a 2s poll silently
  // becomes a request storm.
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const res = await invoke<RunDetail>('agent.run.get', { runId });
      if (cancelled) return;

      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
        return;
      }
      setError(null);
      setDetail(res.output);

      if (res.output.status === 'running') {
        timer = setTimeout(() => void tick(), POLL_MS);
      } else {
        // Refresh the list once, so its status chip and duration stop
        // disagreeing with the panel next to it.
        onTerminalRef.current();
      }
    };

    setDetail(null);
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, setDetail]);

  if (error) {
    return (
      <div className="rounded border border-border bg-surface p-4 text-[14px] text-ink-muted">
        Could not load this run: {error}
      </div>
    );
  }

  if (!detail) return <Skeleton className="h-64 w-full rounded" />;

  return (
    <div className="rounded border border-border bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-[16px] font-medium text-ink">{detail.goal}</p>
          <p className="mt-1 text-[12px] text-ink-muted">
            {detail.agent} · triggered by {detail.trigger} · {formatDuration(detail.durationMs)} ·{' '}
            {formatCost(detail.costCents)} · {detail.tokens.input + detail.tokens.output} tokens
          </p>
        </div>
        <StatusBadge status={detail.status} />
      </header>

      {detail.error ? (
        <p className="mt-4 rounded bg-destructive/10 p-3 text-[13px] text-destructive">
          {detail.error.code}: {detail.error.message}
        </p>
      ) : null}

      <ol className="mt-4 grid gap-0" aria-label="Run steps">
        {detail.steps.map((step, i) => (
          <li key={step.idx} className="relative grid grid-cols-[16px_1fr] gap-3 pb-4">
            <div className="flex flex-col items-center">
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', dotFor(step.type))} />
              {i < detail.steps.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">
                {STEP_LABEL[step.type]}
                <span className="ml-2 font-normal text-ink-muted">{step.ms}ms</span>
              </p>
              <StepPayload payload={step.payload} />
            </div>
          </li>
        ))}
        {detail.status === 'running' ? (
          <li className="grid grid-cols-[16px_1fr] gap-3">
            <span className="mt-1.5 h-2 w-2 animate-pulse rounded-full bg-brand-purple" />
            <p className="text-[13px] text-ink-muted">Working…</p>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  return <Badge className={cn('shrink-0 capitalize', STATUS_TONE[status])}>{status}</Badge>;
}

/**
 * Step payloads are shaped by the step type (`{ tool, status }`, `{ text }`, …)
 * and are written by the loop, not by a schema. Rendering the few known fields
 * and falling back to JSON keeps a new step type visible instead of blank —
 * an invisible step is worse than an ugly one on a surface whose whole purpose
 * is showing what happened.
 */
function StepPayload({ payload }: { payload: unknown }) {
  if (payload === null || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  if (typeof p.tool === 'string') {
    return (
      <p className="mt-0.5 truncate text-[13px] text-ink-muted">
        <code className="rounded bg-surface-muted px-1 py-0.5 text-[12px]">{p.tool}</code>
        {typeof p.refused === 'string' ? (
          <span className="ml-2 text-destructive">refused — {p.refused}</span>
        ) : typeof p.status === 'string' ? (
          <span className="ml-2">{p.status}</span>
        ) : null}
      </p>
    );
  }

  if (typeof p.text === 'string' && p.text.trim()) {
    return <p className="mt-0.5 line-clamp-3 text-[13px] text-ink-muted">{p.text}</p>;
  }

  return (
    <pre className="mt-0.5 overflow-x-auto rounded bg-surface-muted p-2 text-[12px] text-ink-muted">
      {JSON.stringify(payload)}
    </pre>
  );
}

function dotFor(type: StepType): string {
  switch (type) {
    case 'tool':
      return 'bg-brand-purple';
    case 'delegate':
      return 'bg-brand-cyan';
    case 'wait':
      return 'bg-warn';
    default:
      return 'bg-ink-muted';
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return 'running';
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** Sub-cent costs are common and rounding them to "$0.00" reads as free. */
function formatCost(cents: number): string {
  if (cents === 0) return 'no cost';
  if (cents < 100) return `${cents}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}
