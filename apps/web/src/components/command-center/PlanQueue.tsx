'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { platformLabel } from '@/lib/platforms';

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
    /*
      The design's Queue card: 1159x465 at radius 15, plain white, no border.
      Its title is "What is your Agent doing next?" at 20px/600 with an info
      glyph beside it and a `rgba(131,131,131,0.15)` hairline under the header at
      y=70 - so the header is padded and the rows run edge to edge, which is why
      the padding moved off the section and onto its parts.
    */
    <section className="overflow-hidden rounded-lg bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-[22px] pt-6">
        <div className="flex items-start gap-3">
        <div>
          <h2 className="text-20 font-semibold leading-[1.28] text-ink">What is your Agent doing next?</h2>
          <p className="mt-1.5 text-14 text-ink-muted">
            {items === null
              ? 'The plan, in order.'
              : items.length === 0
                ? 'Nothing is scheduled.'
                : channel === ALL
                  ? `${items.length} post${items.length === 1 ? '' : 's'} scheduled, soonest first.`
                  : `${filtered.length} of ${items.length} scheduled to ${platformLabel(channel)}, soonest first.`}
          </p>
        </div>
        <span
          title="Everything your agent has lined up, soonest first. Approving happens in the review list below."
          className="mt-1 flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
          style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
        >
          i
        </span>
        </div>
        {held.length > 0 ? (
          <p className="shrink-0 text-14 font-medium text-warn">{held.length} waiting on you</p>
        ) : null}
      </div>

      <div className="h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />

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
        <ol>
          {upcoming.map((item, i) => {
            const chip = STATUS_CHIP[item.status] ?? STATUS_CHIP.scheduled!;
            const absolute = current * SHOWN + i;
            return (
              <li
                key={item.contentItemId}
                className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-[22px]"
                style={{ borderTop: i === 0 ? undefined : '1px solid rgba(131,131,131,0.12)' }}
              >
                {/* The next one out is the only row anybody is looking for — and
                    it is the first of the whole queue, not the first of whichever
                    page you are on. Paging made `i === 0` wrong: it labelled the
                    ninth post "Next" on page 2. */}
                <div className="min-w-[210px] flex-1">
                  <p className="text-20 font-semibold leading-[1.28] text-ink">
                    {when(item.scheduledAt!)}
                    {absolute === 0 ? (
                      <span className="ml-2 align-middle text-14 font-medium text-primary">Next</span>
                    ) : null}
                  </p>
                  <p className="mt-[9px] text-16 text-ink-muted">
                    Confidence: <b className="font-semibold text-ink">High</b>
                  </p>
                </div>

                {/*
                  The 127x80 media well. `content.list` carries `mediaType` and
                  no URL, so it names the medium — the third card on this screen
                  with the same hole, and the same one field closes all three.
                */}
                <div
                  className="flex h-20 w-[127px] shrink-0 items-center justify-center rounded-md text-[12px] text-ink-muted"
                  style={{ background: 'rgba(131,131,131,0.1)' }}
                >
                  {item.mediaType ?? 'text'}
                </div>

                <div className="min-w-[200px] flex-1">
                  <p className="text-18 font-medium text-ink">
                    {/* Named, not the raw enum: `youtube_shorts` on a row is the
                        kind of leak the platform label map exists to stop. */}
                    {item.platform ? platformLabel(item.platform) : 'no account chosen'}
                    {item.playbookName ? (
                      <span className="ml-2 text-16 font-normal text-ink-muted">{item.playbookName}</span>
                    ) : null}
                  </p>
                  <p className="mt-[9px] truncate text-16 text-ink-muted">
                    {item.summary === NO_COPY ? <span className="italic">not written yet</span> : item.summary}
                  </p>
                </div>

                <span
                  className="flex h-[41px] shrink-0 items-center rounded-lg px-[18px] text-[15px] font-medium"
                  style={{ background: chip.bg, boxShadow: `inset 0 0 0 1.06px ${chip.ring}`, color: chip.fg }}
                >
                  {chip.label}
                </span>

                {/*
                  Four 37x37 buttons at radius 8, and only one of them can be
                  real.

                  `approval.decide` is keyed on a held **callId**, not a content
                  item — approving is the review list's job, and there is no
                  `content.publish_now` or `content.delete` in the registry at
                  all. So approve, send-now and remove are drawn and disabled,
                  each saying what is missing, and preview opens the draft panel,
                  which is a genuine route to everything those three would do.
                */}
                <div className="flex shrink-0 items-center gap-[10px]">
                  <RowAction
                    disabled
                    label="Approve"
                    title="Approving is keyed on the held call, not the post — use the review list below."
                    style={{ background: '#3EC332', opacity: 0.45 }}
                  >
                    <svg width="15" height="12" viewBox="0 0 16 12" fill="none" aria-hidden>
                      <path d="m1 6 4.5 4.5L15 1" stroke="#FFFFFF" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </RowAction>
                  <RowAction
                    disabled
                    label="Send now"
                    title="No publish-now tool exists — a post goes out on its scheduled slot."
                    style={{ background: '#9CEFFF', opacity: 0.45 }}
                  >
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="M14.5 1.5 1.5 6.8l5 2 2 5 6-12.3Z" stroke="#0C0C0C" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  </RowAction>
                  <RowAction
                    label="Preview"
                    title={`Open ${item.playbookName ?? 'this post'}`}
                    onClick={() => onOpen(item.contentItemId)}
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.4)' }}
                  >
                    <svg width="16" height="12" viewBox="0 0 18 12" fill="none" aria-hidden>
                      <path d="M1 6s2.9-5 8-5 8 5 8 5-2.9 5-8 5-8-5-8-5Z" stroke="#0C0C0C" strokeWidth="1.4" strokeLinejoin="round" />
                      <circle cx="9" cy="6" r="2.2" stroke="#0C0C0C" strokeWidth="1.4" />
                    </svg>
                  </RowAction>
                  <RowAction
                    disabled
                    label="Remove"
                    title="No delete tool exists — a planned post is removed from the calendar."
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(243,85,37,0.6)', opacity: 0.55 }}
                  >
                    <svg width="13" height="15" viewBox="0 0 14 16" fill="none" aria-hidden>
                      <path d="M1 3.8h12M5 3.5V2.2C5 1.5 5.5 1 6.2 1h1.6c.7 0 1.2.5 1.2 1.2v1.3M2.6 3.8l.7 9.7c.05.8.7 1.4 1.5 1.4h4.4c.8 0 1.45-.6 1.5-1.4l.7-9.7" stroke="#F35525" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </RowAction>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {items !== null && filtered.length > SHOWN ? (
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
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
        </div>
      ) : null}

      {/* 16px/500 ink with a chevron, at the card's bottom left — the design's
          own treatment, and shown whether or not there is more than one page. */}
      <div className="px-5 pb-6 pt-2">
        <Link href="/calendar" className="inline-flex items-center gap-2.5 text-16 font-medium text-ink">
          View full queue
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
            <path d="m1 1 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>

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
/**
 * The design's four status chips, at its own fills: 41px tall at radius 8.3 with
 * a 1.06px ring.
 *
 * Its four states are "Waiting for approval", "Approved", "Scheduled" and
 * "Optimized". Three of those map onto a real `content_items.status`; there is
 * no "Optimized" status in the schema, so nothing renders it — a fifth chip
 * nobody can reach is worse than four.
 */
const STATUS_CHIP: Record<string, { label: string; bg: string; ring: string; fg: string }> = {
  needs_review: { label: 'Waiting for approval', bg: '#FFF0DC', ring: '#FFB453', fg: '#E48915' },
  approved: { label: 'Approved', bg: '#E9F9E7', ring: '#13D711', fg: '#13A711' },
  scheduled: { label: 'Scheduled', bg: '#EEEEFE', ring: '#5E64F4', fg: '#5E64F4' },
  published: { label: 'Published', bg: '#E9F9E7', ring: '#13D711', fg: '#13A711' },
  blocked: { label: 'Stopped', bg: '#FDE9E2', ring: '#F35525', fg: '#D2470F' },
};

/** One of the row's four 37x37 buttons. */
function RowAction({
  children,
  label,
  title,
  onClick,
  disabled,
  style,
}: {
  children: React.ReactNode;
  label: string;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className="flex h-[37px] w-[37px] items-center justify-center rounded-lg border-0 bg-transparent disabled:cursor-not-allowed"
      style={style}
    >
      {children}
    </button>
  );
}

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
