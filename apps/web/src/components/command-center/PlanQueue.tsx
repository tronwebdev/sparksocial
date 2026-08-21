'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
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
  status: string;
  summary: string;
  scheduledAt?: string;
  createdAt: string;
}

/** `content.list`'s own placeholder for a slot with no written beats yet. */
const NO_COPY = '(no copy yet)';

/** How many upcoming posts is a queue, past which it is a calendar. */
const SHOWN = 8;

export function PlanQueue({ genomeId }: { genomeId: string | undefined }) {
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [heldCount, setHeldCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!genomeId) return;
    const [scheduled, held] = await Promise.all([
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
    // A failed second read leaves the held count at zero rather than failing the
    // queue: the plan is the point of this panel, and the held count is context.
    setHeldCount(held.status === 'succeeded' ? held.output.items.length : 0);
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!genomeId) return null;

  const upcoming = (items ?? []).slice(0, SHOWN);
  const undrafted = (items ?? []).filter((i) => i.summary === NO_COPY).length;

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
                : `${items.length} post${items.length === 1 ? '' : 's'} scheduled, soonest first.`}
          </p>
        </div>
        {heldCount > 0 ? (
          <Link
            href="#review"
            className="shrink-0 text-[13px] font-medium text-warn underline decoration-dotted underline-offset-2"
          >
            {heldCount} waiting on you
          </Link>
        ) : null}
      </div>

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
              {/* The next one out is the only row anybody is looking for. */}
              <span
                className={cn(
                  'w-8 shrink-0 text-[12px] font-medium tabular-nums',
                  i === 0 ? 'text-primary' : 'text-ink-muted',
                )}
              >
                {i === 0 ? 'Next' : `${i + 1}`}
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
            </li>
          ))}
        </ol>
      ) : null}

      {items !== null && items.length > SHOWN ? (
        <p className="mt-3 text-[13px] text-ink-muted">
          {items.length - SHOWN} more after that —{' '}
          <Link
            href="/calendar"
            className="font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
          >
            see the month
          </Link>
          .
        </p>
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
