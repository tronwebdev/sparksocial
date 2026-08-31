'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { platformLabel } from '@/lib/platforms';
import { cn } from '@/lib/utils';

/**
 * §7.5's **Plan** queue — the fourth of the four the PRD makes first-class.
 *
 *   *"Queues are first-class: Plan, Review, Automation, Engagement — each
 *   visible and actionable."*
 *
 * Review had `ReviewQueueList`, Automation had the recipe output list, and
 * Engagement had its own screen. The plan existed as the *calendar*, which is a
 * different thing and was the reason this looked covered: a calendar answers
 * "what does the month look like", and a queue answers "what happens next, and
 * then what". Those are the same rows sorted for opposite questions, and only
 * one of them tells you whether tomorrow morning is about to go out empty.
 *
 * ── Not the Draft List either ─────────────────────────────────────────────
 *
 * `DraftList` (CC-03) is everything in flight across every status, newest
 * first — the right shape for finding a post you were working on. This is
 * scheduled work only, soonest first. Same tool, opposite ordering, because
 * "most recently created" and "next to happen" almost never agree.
 *
 * ── Why the undrafted count leads ─────────────────────────────────────────
 *
 * `calendar.generate` writes empty slots — playbook, pillar and date, no copy —
 * and the scheduler drafts each one when it comes due. That is by design and it
 * is also the single most confusing thing about the product to look at: the
 * calendar shows a full week, and none of it is written yet. Saying so up front
 * turns "why are all my posts blank" into "SPARK writes them the morning they go
 * out", which is what actually happens.
 *
 * Filtering and sorting are client-side: `content.list` already returns the
 * whole set in one read, and a queue that went back to the server to re-sort
 * would spend a round trip on rows the browser has.
 */

interface PlanItem {
  contentItemId: string;
  playbookId: string;
  playbookName: string;
  mediaType?: 'video' | 'image' | 'carousel' | 'text';
  /** Absent on a slot with no account chosen yet — a real state, not a gap. */
  platform?: string;
  status: string;
  summary: string;
  scheduledAt?: string;
  createdAt: string;
  /** Why it stopped — `content.list` carries this as of `5.5`. */
  blockedReason?: string;
  publishAttempts?: number;
}

/** `content.list`'s own placeholder for a slot with no written beats yet. */
const NO_COPY = '(no copy yet)';

/**
 * The channel filter's "everything" value.
 *
 * A sentinel rather than `undefined` so the `<select>` has a real option to be
 * on — a select whose cleared state is an empty string renders as blank, which
 * reads as broken rather than as "no filter".
 */
const ALL = '__all__';

/** How many upcoming posts is a queue, past which it is a calendar. */
const SHOWN = 8;

export function PlanQueue({
  genomeId,
  onOpen,
}: {
  genomeId: string | undefined;
  /**
   * Opens one post in the Draft Panel.
   *
   * Added for `5.5`. The held count used to be a `<Link href="#review">`,
   * and that anchor goes to `ReviewQueueList`, which reads `queue.review.list`
   * — the `approvals` table. That is a *different entity* from a content item
   * with `status = 'needs_review'`: this panel counted one thing and linked to
   * another, so a post held for review was counted here and appeared nowhere
   * the link went. `StallNotice` has existed in `DraftPanel` since P2 and was
   * unreachable for exactly this reason.
   */
  onOpen: (contentItemId: string) => void;
}) {
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [held, setHeld] = useState<PlanItem[]>([]);
  const [channel, setChannel] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!genomeId) return;
    const [scheduled, heldRes] = await Promise.all([
      invoke<{ items: PlanItem[] }>('content.list', { genomeId, status: 'scheduled', limit: 100 }),
      invoke<{ items: PlanItem[] }>('content.list', { genomeId, status: 'needs_review', limit: 100 }),
    ]);

    if (scheduled.status !== 'succeeded') {
      setError(scheduled.status === 'failed' ? scheduled.error.message : 'That request was gated.');
      return;
    }
    setError(null);
    setItems(
      scheduled.output.items
        // A scheduled row with no date cannot be placed in a queue at all. It
        // is a real state (a status set without a date), so it is dropped from
        // the ordering rather than sorted to an arbitrary end.
        .filter((i) => Boolean(i.scheduledAt))
        .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!)),
    );
    // A failed second read leaves the held list empty rather than failing the
    // queue: the plan is the point of this panel, and held items are context.
    setHeld(heldRes.status === 'succeeded' ? heldRes.output.items : []);
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!genomeId) return null;

  /**
   * Filtering and paging are client-side, for the reason the header already
   * gives about sorting: `content.list` returns the whole set in one read, so
   * going back to the server to narrow it would add a round trip and a loading
   * state to a list that is already in memory.
   */
  const all = items ?? [];
  const channels = [...new Set(all.map((i) => i.platform).filter((p): p is string => Boolean(p)))].sort();
  const filtered = channel === ALL ? all : all.filter((i) => i.platform === channel);
  const pages = Math.max(1, Math.ceil(filtered.length / SHOWN));
  // Clamped rather than reset: narrowing the filter while on page 3 should land
  // you on the last page that exists, not silently back at the beginning.
  const current = Math.min(page, pages - 1);
  const upcoming = filtered.slice(current * SHOWN, current * SHOWN + SHOWN);
  const undrafted = filtered.filter((i) => i.summary === NO_COPY).length;

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">What happens next</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {items === null
              ? 'The plan, in order.'
              : items.length === 0
                ? 'Nothing is scheduled.'
                : channel === ALL
                  ? `${items.length} post${items.length === 1 ? '' : 's'} scheduled, soonest first.`
                  : `${filtered.length} of ${items.length} scheduled to ${platformLabel(channel)}, soonest first.`}
          </p>
        </div>
        {held.length > 0 ? (
          <p className="shrink-0 text-[13px] font-medium text-warn">
            {held.length} waiting on you
          </p>
        ) : null}
      </div>

      {/* Only offered when there is something to filter. A select with one
          option is a control that cannot do anything, which is worse than no
          control — it implies the list is narrower than it is. */}
      {channels.length > 1 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label htmlFor="queue-channel" className="text-[12px] font-medium text-ink-muted">
            Channel
          </label>
          <select
            id="queue-channel"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink"
          >
            <option value={ALL}>All channels ({all.length})</option>
            {channels.map((c) => (
              <option key={c} value={c}>
                {platformLabel(c)} ({all.filter((i) => i.platform === c).length})
              </option>
            ))}
          </select>
          {channel !== ALL ? (
            <button
              type="button"
              onClick={() => {
                setChannel(ALL);
                setPage(0);
              }}
              className="text-[12px] font-medium text-primary underline decoration-dotted underline-offset-2"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

      {items === null && !error ? <Skeleton className="mt-4 h-40 w-full rounded-lg" /> : null}

      {items !== null && items.length === 0 ? (
        <p className="mt-4 text-[14px] text-ink-muted">
          SPARK has nothing queued. Generate a calendar from a campaign, or create a single post, and it appears
          here in the order it will go out.
        </p>
      ) : null}

      {undrafted > 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface-muted px-3 py-2 text-[13px] text-ink-muted">
          <span className="font-medium text-ink">
            {undrafted} of these {undrafted === 1 ? 'has' : 'have'} no copy yet.
          </span>{' '}
          That is normal — SPARK writes each one the morning it goes out, so the wording reflects the day rather
          than the day it was planned.
        </p>
      ) : null}

      {upcoming.length > 0 ? (
        <ol className="mt-4 grid grid-cols-1 gap-2">
          {upcoming.map((item, i) => (
            <li
              key={item.contentItemId}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-border p-3"
            >
              {/* The next one out is the only row anybody is looking for — and
                  it is the first of the whole queue, not the first of whichever
                  page you are on. Paging made `i === 0` wrong: it labelled the
                  ninth post "Next" on page 2. The absolute position also makes
                  the numbers continue across pages instead of restarting at 1,
                  which is what tells you where you are in the plan. */}
              <span
                className={cn(
                  'w-8 shrink-0 text-[12px] font-medium tabular-nums',
                  current * SHOWN + i === 0 ? 'text-primary' : 'text-ink-muted',
                )}
              >
                {current * SHOWN + i === 0 ? 'Next' : `${current * SHOWN + i + 1}`}
              </span>

              <span className="w-32 shrink-0 text-[13px] tabular-nums text-ink">{when(item.scheduledAt!)}</span>

              <span className="min-w-[140px] flex-1 truncate text-[13px] text-ink-muted">
                {item.summary === NO_COPY ? (
                  <span className="italic">not written yet</span>
                ) : (
                  item.summary
                )}
              </span>

              <span className="shrink-0 text-[12px] text-ink-muted">{item.playbookName}</span>
              {item.mediaType ? <Badge variant="neutral">{item.mediaType}</Badge> : null}
              {/* Named, not the raw enum: `youtube_shorts` on a row is the kind
                  of leak the platform label map exists to stop. */}
              {item.platform ? <Badge variant="neutral">{platformLabel(item.platform)}</Badge> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {items !== null && filtered.length > SHOWN ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            className="text-[13px] font-medium text-primary disabled:text-ink-muted disabled:no-underline"
          >
            Earlier
          </button>
          {/* The position, not just the controls: "page 2 of 4" is the only
              thing that tells you how much plan there is. */}
          <span className="text-[13px] tabular-nums text-ink-muted">
            Page {current + 1} of {pages}
          </span>
          <button
            type="button"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
            className="text-[13px] font-medium text-primary disabled:text-ink-muted disabled:no-underline"
          >
            Later
          </button>
          <Link
            href="/calendar"
            className="ml-auto text-[13px] font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
          >
            View full queue
          </Link>
        </div>
      ) : null}

      {/*
        The held posts, listed rather than counted.
        `content.list` now returns `blockedReason`, so each row can say *why* it
        stopped instead of making somebody open all of them to find the one that
        matters. Clicking opens the Draft Panel, which is where `StallNotice`
        lives — the whole of `5.5` is that this list exists and goes there.
      */}
      {held.length > 0 ? (
        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-[13px] font-medium text-ink">Stopped, and waiting on you</h3>
          <ul className="mt-2 grid grid-cols-1 gap-1.5">
            {held.map((h) => (
              <li key={h.contentItemId}>
                <button
                  type="button"
                  onClick={() => onOpen(h.contentItemId)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left hover:border-ink-muted"
                >
                  <span className="text-[13px] text-ink">{h.summary}</span>
                  <span className="mt-0.5 block text-[12px] text-ink-muted">
                    {h.blockedReason ??
                      (h.publishAttempts
                        ? `Tried ${h.publishAttempts} time${h.publishAttempts === 1 ? '' : 's'}.`
                        : 'Waiting for approval.')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

    </section>
  );
}

/**
 * Relative for the near dates and absolute past that.
 *
 * "In 3 days" is what somebody wants for tomorrow and useless for the 19th; a
 * date is the reverse. The boundary is a week, which is the horizon a posting
 * cadence is actually planned on.
 */
function when(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((at.getTime() - Date.now()) / 86_400_000);

  if (days < 0) return `overdue · ${at.toLocaleDateString('en', { day: 'numeric', month: 'short' })}`;
  if (days === 0) return `today · ${time}`;
  if (days === 1) return `tomorrow · ${time}`;
  if (days <= 7) return `in ${days} days · ${time}`;
  return `${at.toLocaleDateString('en', { day: 'numeric', month: 'short' })} · ${time}`;
}
