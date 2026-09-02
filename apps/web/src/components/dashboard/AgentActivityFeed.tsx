'use client';

import { Badge } from '@/components/ui/badge';
import { EmptyCard } from '@/components/common/EmptyCard';
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

/**
 * Four. The card is 361px tall and the prototype fills it with exactly four
 * rows on an 80/105px pitch - a fifth would either overflow it or shrink the
 * rows. Anything past four is the Timeline's job.
 */
const VISIBLE = 4;

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
      <section>
        <SectionHeading />
        <div className="mt-[9px] rounded-lg bg-white">
          <EmptyCard body={<>Create your first campaign to get started and view agent activities</>} />
        </div>
      </section>
    );
  }

  return (
    /*
      The heading sits *outside* the card - "Agent Activity" at 18px/600
      `#838383` on the canvas, then 41px down to a plain white card at radius 15
      with no border. I had it as a bordered card with the title in a header row
      inside it, which reads as a panel rather than a titled list.

      Row type: 20px/600 ink for the goal, 16px/400 `#838383` for the meta, and
      `rgba(131,131,131,0.3)` hairlines that run the full width of the card
      rather than being inset with the text.
    */
    <section>
      <SectionHeading />

      <div className="mt-[9px] rounded-lg bg-white">
        <ul>
          {runs.slice(0, VISIBLE).map((run, i) => {
            const status = STATUS[run.status] ?? { label: run.status, variant: 'neutral' as const };
            return (
              <li
                key={run.runId}
                className={i < Math.min(runs.length, VISIBLE) - 1 ? 'border-b' : undefined}
                style={i < Math.min(runs.length, VISIBLE) - 1 ? { borderColor: 'rgba(131,131,131,0.3)' } : undefined}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-[17px] py-[22px]">
                  <p className="min-w-0 flex-1 text-20 font-semibold leading-[1.28] text-ink">{run.goal}</p>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <span className="text-16 tabular-nums text-ink-muted">{relativeTime(run.startedAt)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/**
 * The canvas-level heading, with the prototype's 18px info glyph beside it and
 * the route to the full timeline where the prototype has only the label - four
 * rows is a preview, and there has to be a way to the rest.
 */
function SectionHeading() {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-18 font-semibold leading-[1.28] text-ink-muted">Agent Activity</h2>
      <span
        title="Every piece of work your agent does, newest first. Each row can be replayed step by step."
        className="flex h-[18px] w-[18px] cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
        style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
      >
        i
      </span>
      {/*
        "Full timeline" is not in the design. It was mine, on the argument that
        four rows is a preview and there has to be a way to the rest - which is
        true, and the way is the Command Center button on the banner directly
        above this card. A second link to the same place, in a colour nothing
        else in this header uses, is one more thing to read.
      */}
    </div>
  );
}
