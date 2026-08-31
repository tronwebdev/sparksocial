'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/relativeTime';
import type { AgentRun } from './types';

/**
 * AGENT ACTIVITY — the cockpit's feed (`DASH-B-01`, M1).
 *
 * ── What the prototype shows, and what the build actually knows ────────────
 *
 * The prototype's rows are semantic events: "Trending topic detected 'AI
 * Automation'", "Scheduled 7 posts for next week", "6 intent leads flagged",
 * each with "Confidence: High". There is no event table behind that. What exists
 * is `agent_runs` — every SPARK run, with the goal it was given, whether it
 * finished, what it cost and how long it took — which is the same information one
 * level less polished: the *work*, rather than a headline written about the work.
 *
 * Rendering the run's own goal rather than a generated headline is the honest
 * choice and, on reflection, the better one. `agent.run.get` can replay any row
 * step by step, so a goal here is a link into what the agent actually did; a
 * headline would be a sentence about it that nothing could verify.
 *
 * "Confidence: High" is absent for the same reason. A run has a status, not a
 * confidence, and there is no number behind that phrase anywhere in the build —
 * it would be decoration that reads as a measurement.
 *
 * ── Failures stay in the feed ─────────────────────────────────────────────
 *
 * A run that failed is the most useful row on this list, and the one a
 * screenshot-friendly feed would quietly drop. `packages/spark`'s own timeline
 * header makes the argument: the point is to show what happened, including the
 * parts that failed.
 */

/** The prototype shows four rows before the fold; anything more is the Timeline's job. */
const VISIBLE = 5;

const STATUS: Record<string, { label: string; variant: 'success' | 'warn' | 'destructive' | 'neutral' }> = {
  succeeded: { label: 'Done', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  running: { label: 'Working', variant: 'neutral' },
  awaiting_human: { label: 'Waiting on you', variant: 'warn' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

export function AgentActivityFeed({ runs }: { runs: AgentRun[] }) {
  if (runs.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-[14px] font-medium text-ink">Agent activity</h2>
        <p className="mt-2 text-[13px] text-ink-muted">
          Nothing yet. Once a campaign is running, every piece of work SPARK does shows up here — and
          each row can be replayed step by step.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-[14px] font-medium text-ink">Agent activity</h2>
        <Link
          href="/agents"
          className="text-[13px] font-medium text-brand-purple underline underline-offset-2"
        >
          Full timeline
        </Link>
      </header>

      <ul>
        {runs.slice(0, VISIBLE).map((run) => {
          const status = STATUS[run.status] ?? { label: run.status, variant: 'neutral' as const };
          return (
            <li key={run.runId} className="border-b border-border last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3.5">
                <p className="min-w-0 flex-1 text-[14px] font-medium text-ink">{run.goal}</p>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant={status.variant}>{status.label}</Badge>
                  <span className="text-[12.5px] tabular-nums text-ink-muted">
                    {relativeTime(run.startedAt)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
