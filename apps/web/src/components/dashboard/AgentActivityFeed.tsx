'use client';

import { EmptyCard } from '@/components/common/EmptyCard';
import { relativeTime } from '@/lib/relativeTime';
import { humaniseGoal, runKind, type RunKind } from '@/lib/runGoal';
import { cn } from '@/lib/utils';
import type { AgentRun } from './types';

/**
 * AGENT ACTIVITY — the cockpit's feed (`DASH-B-01`, M1), to
 * `SparkSocial Dashboard.dc.html`'s own row anatomy.
 *
 *   heading   356,492   18px/600 `#838383` on the canvas, with the 21.6px info
 *             glyph at 488 — outside the card, not in a header row inside it
 *   card      356,533 · 846x361, radius 15, plain white, no border
 *   row       a coloured glyph at left 0..23, the title at +33 in 20px/600 ink,
 *             an optional second line at +41 in 16px/400 `#838383`, the time
 *             right-aligned in 16px/400, and a chevron on rows that open
 *             something
 *   rule      full-width `rgba(131,131,131,0.3)`, not inset with the text
 *
 * The design's four rows alternate one-line (28px tall, 75px pitch) and
 * two-line (61px tall, 105px pitch), which is what an optional second line
 * produces rather than something to hard-code.
 *
 * ── What the rows say, against what the build knows ──────────────────────
 *
 * The prototype's rows are semantic headlines — "Trending topic detected 'AI
 * Automation'", "Scheduled 7 posts for next week", "6 intent leads flagged" —
 * with "Confidence: High" under each. There is no event table behind that.
 * What exists is `agent_runs`: every SPARK run, its goal, whether it finished,
 * what it cost, how long it took. That is the same information one level less
 * polished — the *work*, rather than a headline written about the work — and
 * `agent.run.get` can replay any row step by step, so the goal is a link into
 * what actually happened where a headline would be a claim nothing could check.
 *
 * Three things changed here to close the gap with the design:
 *
 *   **The glyph.** The design indexes rows by kind and the feed had none, so
 *   four rows of dense 20px text read as a wall. `runKind` reads the kind off
 *   the goal — the only place that information exists — and an unmatched goal
 *   gets the neutral spark rather than being forced into a category.
 *
 *   **The second line.** "Confidence: High" is not renderable: a run has a
 *   status, not a confidence, and no number behind that phrase exists anywhere
 *   in the build. The line carries what a run does have — whether it finished,
 *   how long it took, what it spent — which is the same *shape* (a quiet grey
 *   qualifier under the headline) filled with something true.
 *
 *   **The goal.** It was printed raw, which meant rows reading "Edit content
 *   item e7c14d12-… in genome 9bcf18fc-…. Now: make this less pushy Use the
 *   content.* tools…" — two UUIDs and a model instruction around the six words
 *   someone typed. `humaniseGoal` keeps the request and names the post.
 *
 * Failures stay in the feed. A run that failed is the most useful row on the
 * list and the one a screenshot-friendly feed would quietly drop;
 * `packages/spark`'s own timeline header makes the same argument.
 */

/**
 * Four. The card is 361px tall and the prototype fills it with exactly four
 * rows on a 75/105px pitch — a fifth would either overflow it or shrink the
 * rows. Anything past four is the Timeline's job.
 */
const VISIBLE = 4;

const STATUS_LINE: Record<string, string> = {
  succeeded: 'Finished',
  failed: 'Failed',
  running: 'Working now',
  awaiting_human: 'Waiting on you',
  cancelled: 'Cancelled',
};

/** The design's four glyph colours, plus the neutral fallback. */
const KIND: Record<RunKind, { tint: string; stroke: string; icon: React.ReactNode }> = {
  trend: {
    tint: 'rgba(245,107,255,0.2)',
    stroke: '#F56BFF',
    icon: (
      <>
        <path
          d="M11 1.5c.2 2.6-.9 4.4-2.8 6.5C6.2 10.2 3.6 12.4 2.4 15.5a9.3 9.3 0 0 0 5.2 11.9 9.6 9.6 0 0 0 12-4.2c1.5-3 .8-6.5-.8-9.3-1.2-2-2.8-3.7-3.6-5.9-.5-1.4-.7-3-.4-4.9"
          fill="rgba(245,107,255,0.2)"
          stroke="#F56BFF"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M8.6 20.3c-.5 2 .6 4.1 2.5 4.8 2 .7 4.2-.2 5-2.1.7-1.6.2-3.4-.9-4.8-.8-1-1.9-1.9-2.3-3.1-.9 1.9-3.7 3-4.3 5.2Z" fill="#F56BFF" />
      </>
    ),
  },
  calendar: {
    tint: 'rgba(94,100,244,0.3)',
    stroke: '#5E64F4',
    icon: (
      <>
        <path d="M3 6.5A3.5 3.5 0 0 1 6.5 3h11A3.5 3.5 0 0 1 21 6.5v-.4c.1.9.2 1.9.3 2.9H2.7c.1-1 .2-2 .3-2.9Z" fill="rgba(94,100,244,0.3)" />
        <rect x="2.7" y="4.1" width="18.6" height="18.4" rx="4" stroke="#5E64F4" strokeWidth="1.9" />
        <path d="M2.9 9.9h18.2" stroke="#5E64F4" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M8.1 1.9v3.8M18.5 1.9v3.8" stroke="#5E64F4" strokeWidth="1.9" strokeLinecap="round" />
      </>
    ),
  },
  engagement: {
    tint: 'rgba(163,65,255,0.2)',
    stroke: '#A341FF',
    icon: (
      <>
        <rect x="1" y="1" width="19" height="16" rx="4" fill="rgba(163,65,255,0.2)" stroke="#A341FF" strokeWidth="1.7" />
        <path d="m5.5 17 .1 2.6a.6.6 0 0 0 1 .5L10 17" stroke="#A341FF" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M5.7 6.6h9.6M5.7 11h6.2" stroke="#A341FF" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
  leads: {
    tint: 'rgba(243,85,37,0.25)',
    stroke: '#F35525',
    icon: (
      <>
        <path d="M2 1.5v23" stroke="#F35525" strokeWidth="2.2" strokeLinecap="round" />
        <path
          d="M2.5 3.2c4.6-2.4 8.2 2.2 12.6.4 1.2-.5 2.3.4 2.3 1.6v7.2c0 .9-.6 1.7-1.5 1.9-4.9 1.3-8.4-3-13.4-.6"
          fill="#F35525"
          fillOpacity="0.25"
          stroke="#F35525"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  content: {
    tint: 'rgba(108,232,255,0.3)',
    stroke: '#35B7D4',
    icon: (
      <>
        <rect x="2" y="2" width="18" height="18" rx="4.5" fill="rgba(108,232,255,0.3)" stroke="#35B7D4" strokeWidth="1.8" />
        <path d="M6.5 8.5h9M6.5 12.5h6" stroke="#35B7D4" strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
  spark: {
    tint: 'rgba(131,131,131,0.2)',
    stroke: '#838383',
    icon: (
      <>
        <circle cx="11" cy="11" r="9.4" fill="rgba(131,131,131,0.15)" stroke="#838383" strokeWidth="1.7" />
        <path d="M7 11.5h8M11 7.5v8" stroke="#838383" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
};

export function AgentActivityFeed({
  runs,
  titles,
}: {
  runs: AgentRun[];
  /** contentItemId → summary, so a goal can name the post instead of its id. */
  titles?: Map<string, string>;
}) {
  if (runs.length === 0) {
    return (
      <section>
        <SectionHeading />
        <div className="mt-dash-label-gap rounded-lg bg-white">
          <EmptyCard body={<>Create your first campaign to get started and view agent activities</>} />
        </div>
      </section>
    );
  }

  const names = titles ?? new Map<string, string>();

  return (
    <section>
      <SectionHeading />

      <div className="mt-dash-label-gap rounded-lg bg-white">
        <ul>
          {runs.slice(0, VISIBLE).map((run, i) => {
            const kind = KIND[runKind(run.goal, run.agent)];
            const last = i >= Math.min(runs.length, VISIBLE) - 1;
            const seconds = run.durationMs === null ? null : Math.max(1, Math.round(run.durationMs / 1000));
            /* The design's quiet second line, filled with what a run has:
               whether it finished, how long it took, what it spent. */
            const meta = [
              STATUS_LINE[run.status] ?? run.status,
              seconds !== null ? (seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`) : null,
              run.costCents > 0 ? `$${(run.costCents / 100).toFixed(2)}` : null,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <li
                key={run.runId}
                className={cn(!last && 'border-b')}
                style={!last ? { borderColor: 'rgba(131,131,131,0.3)' } : undefined}
              >
                <div className="flex items-start gap-[12px] px-[17px] py-[22px]">
                  <svg
                    width="23"
                    height="26"
                    viewBox="0 0 24 25"
                    fill="none"
                    aria-hidden
                    className="mt-[2px] shrink-0"
                  >
                    {kind.icon}
                  </svg>

                  <div className="min-w-0 flex-1">
                    {/* `break-words`, not `nowrap`: the design's goals are
                        short headlines and a real one can be a paragraph. */}
                    <p className="text-20 font-semibold leading-[1.28] text-ink">
                      {humaniseGoal(run.goal, names)}
                    </p>
                    <p className="mt-[15px] text-16 font-normal text-ink-muted">{meta}</p>
                  </div>

                  <span className="shrink-0 whitespace-nowrap pt-[3px] text-16 font-normal tabular-nums text-ink-muted">
                    {relativeTime(run.startedAt)}
                  </span>
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
 * The canvas-level heading, with the prototype's 18px info glyph beside it.
 *
 * "Full timeline" is not in the design. It was mine, on the argument that four
 * rows is a preview and there has to be a way to the rest — which is true, and
 * the way is the Command Center button on the banner directly above this card.
 * A second link to the same place, in a colour nothing else in this header
 * uses, is one more thing to read.
 */
function SectionHeading() {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-18 font-semibold leading-[1.28] text-ink-muted">Agent Activity</h2>
      <span
        title="Every piece of work your agent does, newest first. Each row can be replayed step by step from the Timeline."
        className="flex h-[18px] w-[18px] cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
        style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
      >
        i
      </span>
    </div>
  );
}
