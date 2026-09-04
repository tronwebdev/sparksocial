'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { platformLabel } from '@/lib/platforms';
import { cn } from '@/lib/utils';
import {
  EMPTY_FILTERS,
  QueueFilters,
  matchesFilters,
  type QueueFilterState,
} from './QueueFilters';
import { PlatformIcon } from '@/components/common/PlatformIcon';
import { EmptyCard } from '@/components/common/EmptyCard';

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


/** How many upcoming posts is a queue, past which it is a calendar. */
/**
 * How many rows, by which card this is.
 *
 * The two layouts are two different cards in the design and they hold different
 * amounts. The Overview's is 465 tall: 70 of header, three 104px rows to 382,
 * and "View full queue" at 420. The Agent Calendar's is 900: a header, a filter
 * row, column labels, then four 157px rows from 141 to 769 with "Page 1 of 4"
 * and a pair of pager circles at 796.
 *
 * This was a single `const SHOWN = 8`, and when I cut it to 3 for the Overview I
 * took a row off the calendar table with it. Hence two numbers.
 */
const SHOWN_BY_LAYOUT = { rows: 3, table: 4 } as const;

export function PlanQueue({
  title = 'What is your Agent doing next?',
  genomeId,
  onOpen,
  layout = 'rows',
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
  /**
   * `rows` is the Overview's Queue card. `table` is the Agent Calendar tab's
   * List View — the design's six-column table (Content, Type, Preview,
   * Channel, Status, Action) over exactly this data.
   *
   * A prop rather than a second component, because a second component means a
   * second `content.list` and two views of one queue that can disagree about
   * what is in it.
   */
  layout?: 'rows' | 'table';
  /**
   * The card's heading. The Overview asks "What is your Agent doing next?"; the
   * Agent Calendar's card is headed "Upcoming action queue" — one component, two
   * cards, and the heading was hardcoded to the Overview's on both.
   */
  title?: string;
}) {
  const [items, setItems] = useState<PlanItem[] | null>(null);
  /* The design's five filter boxes, over the rows already in memory. */
  const [filters, setFilters] = useState<QueueFilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!genomeId) return;
    /*
      Every status, not just `scheduled`.

      This asked for `status: 'scheduled'`, so the card called "What is your
      Agent doing next?" showed only the part of the queue that was already
      settled — a post waiting for approval, one regenerating, one the agent had
      optimised were all absent from the one card whose job is to say what is
      coming. `content.list` returns the whole set when the filter is omitted.

      `published` is the one thing dropped: it has already gone out, so it is not
      what the agent is doing next, and the dashboard rail is where published
      posts live.
    */
    const scheduled = await invoke<{ items: PlanItem[] }>('content.list', {
      genomeId,
      limit: 100,
    });

    if (scheduled.status !== 'succeeded') {
      setError(scheduled.status === 'failed' ? scheduled.error.message : 'That request was gated.');
      return;
    }
    setError(null);
    setItems(
      scheduled.output.items
        .filter((i) => i.status !== 'published')
        /*
          Dated first, in slot order, then the undated.

          Undated rows used to be filtered out entirely, on the argument that a
          post with no slot "cannot be placed in a queue". That was true while
          this read was `scheduled`-only — a scheduled post always has a date.
          Now that the card carries the whole pipeline it is wrong: a post
          waiting for approval or mid-regeneration frequently has no slot yet,
          and those are exactly the rows somebody is looking for. They sort last,
          newest first, rather than being hidden.
        */
        .sort((a, b) => {
          const at = a.scheduledAt ? Date.parse(a.scheduledAt) : null;
          const bt = b.scheduledAt ? Date.parse(b.scheduledAt) : null;
          if (at !== null && bt !== null) return at - bt;
          if (at !== null) return -1;
          if (bt !== null) return 1;
          return Date.parse(b.createdAt) - Date.parse(a.createdAt);
        }),
    );
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
  /*
    The option lists come from the rows themselves: an option that matches
    nothing is a dead end, and the queue's contents change with the campaign.
  */
  const channels = [...new Set(all.map((i) => i.platform).filter((p): p is string => Boolean(p)))].sort();
  const mediaTypes = [...new Set(all.map((i) => i.mediaType ?? 'text'))].sort();
  const statuses = [...new Set(all.map((i) => i.status))].sort();
  const filtered = all.filter((i) => matchesFilters(i, filters));
  const shown = SHOWN_BY_LAYOUT[layout];
  const pages = Math.max(1, Math.ceil(filtered.length / shown));
  // Clamped rather than reset: narrowing the filter while on page 3 should land
  // you on the last page that exists, not silently back at the beginning.
  const current = Math.min(page, pages - 1);
  const upcoming = filtered.slice(current * shown, current * shown + shown);
  const undrafted = filtered.filter((i) => i.summary === NO_COPY).length;

  return (
    /*
      The design's Queue card: 1159x465 at radius 15, plain white, no border.
      Its title is "What is your Agent doing next?" at 20px/600 with an info
      glyph beside it and a `rgba(131,131,131,0.15)` hairline under the header at
      y=70 - so the header is padded and the rows run edge to edge, which is why
      the padding moved off the section and onto its parts.
    */
    <>
    <section className="overflow-hidden rounded-lg bg-white">
      {/*
        One line, and the divider on 70.

        The design's header is the heading plus an info glyph — nothing else. A
        subtitle counting the queue and a "N waiting on you" tally pushed it to
        91.6 and moved every row down with it; the count now lives in the glyph's
        own tooltip, where it is still readable, and the tally was already stated
        by the Needs Attention band at the top of the screen.
      */}
      <div
        className={cn(
          'flex gap-3',
          /* 86 on the calendar card — its 54px filter buttons sit on 16..70 —
             and 70 on the Overview's, whose heading sits on 24. */
          layout === 'table'
            ? 'items-center pl-7 pr-0 pb-[16px] pt-[16px]'
            : 'items-start px-5 pb-[20.4px] pt-6',
        )}
      >
        <h2 className="text-20 font-semibold leading-[1.28] text-ink">{title}</h2>
        {/* Beside the heading, which is where both cards put it - the
            calendar's at 265 and the Overview's directly after its title.
            Last in the row it took ~30px off the right edge and shifted the
            whole filter row left by that much. */}
        <span
          title={
            items === null
              ? 'The plan, in order.'
              : items.length === 0
                ? 'Nothing is queued.'
                : filtered.length === items.length
                  ? `${items.length} post${items.length === 1 ? '' : 's'} queued, soonest first.`
                  : `${filtered.length} of ${items.length} queued match the filters.`
          }
          className="mt-1 flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
          style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
        >
          i
        </span>
        {/*
          The advisory as a pill, in the header — on the Overview's card only.

          Both cards share this header, and on the calendar's the pill's own
          `ml-auto` was competing with the filter row's: it took 208px off the
          right edge and pushed all five filters exactly one 210px pitch left of
          where the design puts them. The calendar card has no such pill.

          It was a full-width bordered paragraph under the rows, which is a lot
          of furniture for one sentence and put it inside a card the design fixes
          at 465. As a pill on the header row it sits in the 70px band the design
          already has, and the sentence that explains *why* moves to its tooltip.
        */}
        {/* Shared with Calendar Mode — see `QueueFilters`. */}
        {layout === 'table' ? (
          <QueueFilters
            value={filters}
            onChange={(next) => {
              setFilters(next);
              /* A filter that leaves fewer rows than the page you are on would
                 otherwise show an empty page with content behind it. */
              setPage(0);
            }}
            platforms={channels}
            mediaTypes={mediaTypes}
            statuses={statuses}
            statusLabel={(st) => STATUS_CHIP[st]?.label ?? st}
          />
        ) : null}

        {undrafted > 0 && layout === 'rows' ? (
          <span
            title="SPARK writes each post the morning it goes out, so the wording reflects the day rather than the day it was planned."
            className="ml-auto flex h-[26px] shrink-0 cursor-help items-center gap-[6px] rounded-full px-[11px] text-[13px] font-medium"
            style={{ background: 'var(--ss-cc-attn-bg)', boxShadow: 'inset 0 0 0 1px var(--ss-cc-attn-ring)', color: 'var(--ss-warn)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <circle cx="6" cy="6" r="5.2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M6 3.4v3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="6" cy="8.6" r="0.7" fill="currentColor" />
            </svg>
            {undrafted} {undrafted === 1 ? 'has' : 'have'} no copy yet
          </span>
        ) : null}

      </div>

      {/*
        The Overview's card closes its header on 70. The calendar's does not have
        a rule there at all — its one hairline is at 140, under the column
        labels — so that one is drawn by the table branch instead.
      */}
      {layout === 'rows' ? (
        <div className="h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />
      ) : null}

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

      {items === null && !error ? <Skeleton className="mt-4 h-40 w-full rounded-lg" /> : null}

      {items !== null && items.length === 0 ? (
        <EmptyCard body="Generate a calendar from a campaign, or create a single post, and everything your agent plans appears here in the order it will go out." />
      ) : null}

      {/* Filtered to nothing is a different fact from an empty queue, and the
          way out of it is the filters themselves. */}
      {items !== null && items.length > 0 && filtered.length === 0 ? (
        <div className="flex items-center gap-4 px-7 py-[26px]">
          <p className="text-16 text-ink-muted">
            No post in the queue matches those filters.
          </p>
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-16 font-medium text-ink underline underline-offset-2"
          >
            Clear filters
          </button>
        </div>
      ) : null}


      {upcoming.length > 0 && layout === 'table' ? (
        /*
          The design's table. Columns at 28 / 690 / 838 / 1035 / 1190 / 1462 of
          a 1629 card, which is a 28px inset and widths of 662 / 148 / 197 /
          155 / 272 / 167 — 1601 exactly, so they are `fr` and hold at any
          width rather than only at 1629.

          They were `42fr 9fr 12fr 10fr 17fr 10fr` with `gap-4 px-7`, and the
          gaps are what went wrong: four 16px gutters pushed every column after
          the first 14-17px left of the design. The widths already account for
          the spacing between columns, so the grid has none.

          Rows are a fixed 157. `py-6` let them size to content, which on a
          table whose rows the design pitches at exactly 157 meant no two builds
          agreed on where row four ended.

          Rows are 157px: the title at 20px/600 with its date beneath at
          18px/500, a 127x110 preview well, the platform icons at 28px, the
          status chip, and the same action buttons the row layout uses.
        */
        <div role="table" className="w-full">
          <div
            role="row"
            className="grid grid-cols-[662fr_148fr_197fr_155fr_272fr_167fr] items-center gap-0 pl-[28px] pb-[20px] pt-[16px]"
          >
            {['Content', 'Type', 'Preview', 'Channel', 'Status', 'Action'].map((h) => (
              <span key={h} role="columnheader" className="text-18 font-medium text-ink-muted">
                {h}
              </span>
            ))}
          </div>

          <div className="h-px w-full" style={{ background: 'rgba(131,131,131,0.2)' }} />

          {upcoming.map((item, i) => {
            const chip = STATUS_CHIP[item.status] ?? STATUS_CHIP.scheduled!;
            return (
              <div
                key={item.contentItemId}
                role="row"
                className="grid grid-cols-[662fr_148fr_197fr_155fr_272fr_167fr] items-center gap-0 pl-[28px] h-[157px]"
                style={{ borderTop: i === 0 ? undefined : '1px solid rgba(131,131,131,0.12)' }}
              >
                <div className="min-w-0">
                  <p className="truncate text-20 font-semibold leading-[1.28] text-ink">
                    {item.summary === NO_COPY ? (
                      <span className="italic text-ink-muted">not written yet</span>
                    ) : (
                      item.summary
                    )}
                  </p>
                  <p className="mt-2.5 flex items-center gap-2.5 text-18 font-medium text-ink">
                    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden>
                      <rect x="2" y="3.2" width="14" height="12.6" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
                      <path d="M2 7h14M6 1.8v2.6M12 1.8v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                    {item.scheduledAt ? when(item.scheduledAt) : 'No slot yet'}
                  </p>
                </div>

                <span className="text-18 font-medium text-ink-muted">{item.mediaType ?? 'text'}</span>

                <div
                  className="flex h-[110px] w-[127px] items-center justify-center rounded-md text-[12px] text-ink-muted"
                  style={{ background: 'rgba(131,131,131,0.1)' }}
                >
                  {/* No `mediaUrl` on a content item — the fourth card on this
                      screen with the same hole. */}
                  no preview
                </div>

                {/* The Channel column is the mark itself in the design — 28px
                    at 1035, with a second badged at 1068 for a cross-post. The
                    name stays as the icon's title. */}
                <span className="flex items-center gap-[5px]">
                  {item.platform ? (
                    <PlatformIcon platform={item.platform} size={28} />
                  ) : (
                    <span className="text-18 font-medium text-ink-muted">—</span>
                  )}
                </span>

                <span
                  className="flex h-[41px] w-fit items-center rounded-lg px-[18px] text-[15px] font-medium"
                  style={{ background: chip.bg, boxShadow: `inset 0 0 0 1.06px ${chip.ring}`, color: chip.fg }}
                >
                  {chip.label}
                </span>

                <div className="flex items-center gap-2.5">
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
              </div>
            );
          })}
        </div>
      ) : null}

      {upcoming.length > 0 && layout === 'rows' ? (
        <ol>
          {upcoming.map((item, i) => {
            const chip = STATUS_CHIP[item.status] ?? STATUS_CHIP.scheduled!;
            const absolute = current * shown + i;
            return (
              <li
                key={item.contentItemId}
                /*
                  104px, on the design's own grid.

                  This was `flex flex-wrap items-center gap-x-5 py-[22px]`, which
                  measured 124-125 and put nothing where the design puts it: the
                  media well landed on 352,22 against 320,12, the kind on 669
                  against 562, the chip on 831 against 770. Absolute offsets in a
                  fixed 104 row, the same fix the dashboard's Upcoming rows got.
                */
                className="relative h-[104px]"
                style={{ borderTop: i === 0 ? undefined : '1px solid rgba(131,131,131,0.12)' }}
              >
                <span className="absolute left-[20px] top-[22px] block" aria-hidden>
                  <QueueCalendarGlyph />
                </span>

                {/* The next one out is the only row anybody is looking for - and
                    it is the first of the whole queue, not of whichever page you
                    are on. */}
                <p className="absolute left-[55px] top-[22px] whitespace-nowrap text-20 font-semibold leading-[1.28] text-ink">
                  {item.scheduledAt ? when(item.scheduledAt) : 'No slot yet'}
                  {absolute === 0 ? (
                    <span className="ml-2 align-middle text-14 font-medium text-primary">Next</span>
                  ) : null}
                </p>
                <p className="absolute left-[55px] top-[56px] whitespace-nowrap text-16 leading-[1.3] text-ink-muted">
                  Confidence: <b className="font-semibold text-ink">High</b>
                </p>

                {/*
                  The 127x80 media well at 320,12. `content.list` carries
                  `mediaType` and no URL, so it names the medium - the third card
                  on this screen with the same hole, and one field closes all
                  three.
                */}
                <div
                  className="absolute left-[320px] top-[12px] flex h-20 w-[127px] items-center justify-center rounded text-[12px] text-ink-muted"
                  style={{ background: 'rgba(131,131,131,0.1)' }}
                >
                  {item.mediaType ?? 'text'}
                </div>

                {/* The design badges the platform at 492,24 in 26.5px and puts
                    the kind at 562,27 — so with `public/icons` in place the mark
                    goes back in its own slot and the label starts at 562. */}
                <span className="absolute left-[492px] top-[24px]">
                  <PlatformIcon platform={item.platform} size={26.5} />
                </span>
                <p className="absolute left-[562px] top-[27px] max-w-[194px] truncate text-18 font-medium text-ink">
                  {/* Named, not the raw enum: `youtube_shorts` on a row is the
                      kind of leak the platform label map exists to stop. */}
                  {item.platform ? platformLabel(item.platform) : 'no account chosen'}
                </p>
                <p className="absolute left-[492px] top-[62px] max-w-[264px] truncate text-16 leading-[1.3] text-ink-muted">
                  {item.summary === NO_COPY ? <span className="italic">not written yet</span> : item.summary}
                </p>

                <span
                  className="absolute left-[770px] top-[30px] flex h-[41px] items-center whitespace-nowrap rounded-lg px-[18px] text-[15px] font-medium"
                  style={{ background: chip.bg, boxShadow: `inset 0 0 0 1.06px ${chip.ring}`, color: chip.fg }}
                >
                  {chip.label}
                </span>

                {/*
                  Three 37x37 buttons at radius 8, on 985, 1032 and 1079 - and
                  only one of them can be real.

                  Four were drawn, Approve *and* Send together, which is not a
                  state the design has: it shows Approve on a post waiting for
                  approval and Send on a scheduled one, never both, and that
                  fourth slot pushed the other two 47px left of where they go.

                  `approval.decide` is keyed on a held **callId**, not a content
                  item - approving is the review list's job - and there is no
                  `content.publish_now` or `content.delete` in the registry at
                  all. So whichever one shows is drawn disabled and says what is
                  missing, and preview opens the draft panel, which is a real
                  route to everything the other two would do.
                */}
                {item.status === 'needs_review' ? (
                  <RowAction
                    disabled
                    className="absolute left-[985px] top-[32px]"
                    label="Approve"
                    title="Approving is keyed on the held call, not the post - use the review list below."
                    style={{ background: '#3EC332', opacity: 0.45 }}
                  >
                    <svg width="15" height="12" viewBox="0 0 16 12" fill="none" aria-hidden>
                      <path d="m1 6 4.5 4.5L15 1" stroke="#FFFFFF" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </RowAction>
                ) : item.status === 'scheduled' ? (
                  <RowAction
                    disabled
                    className="absolute left-[985px] top-[32px]"
                    label="Send now"
                    title="No publish-now tool exists - a post goes out on its scheduled slot."
                    style={{ background: '#9CEFFF', opacity: 0.45 }}
                  >
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="M14.5 1.5 1.5 6.8l5 2 2 5 6-12.3Z" stroke="#0C0C0C" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  </RowAction>
                ) : null}

                <RowAction
                  className="absolute left-[1032px] top-[32px]"
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
                  className="absolute left-[1079px] top-[32px]"
                  label="Remove"
                  title="No delete tool exists - a planned post is removed from the calendar."
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(243,85,37,0.6)', opacity: 0.55 }}
                >
                  <svg width="13" height="15" viewBox="0 0 14 16" fill="none" aria-hidden>
                    <path d="M1 3.8h12M5 3.5V2.2C5 1.5 5.5 1 6.2 1h1.6c.7 0 1.2.5 1.2 1.2v1.3M2.6 3.8l.7 9.7c.05.8.7 1.4 1.5 1.4h4.4c.8 0 1.45-.6 1.5-1.4l.7-9.7" stroke="#F35525" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </RowAction>
              </li>
            );
          })}
        </ol>
      ) : null}


      {/* 16px/500 ink with a chevron, at the card's bottom left — the design's
          own treatment, and shown whether or not there is more than one page. */}
      {/*
        Two footers, because the two cards end differently.

        The Overview's is a link out — its card is a three-row preview and the
        full queue lives on the calendar. The calendar's own card is the full
        queue, so it pages instead: "Page 1 of N" at 28,806 with two 34px
        circles at 1524 and 1568. Removing the pager wholesale (right for a
        3-row preview) had taken it off the calendar as well.
      */}
      {layout === 'table' ? (
        <div className="flex items-center px-7 pb-[26px] pt-[30px]">
          <span className="text-16 font-medium text-ink-muted">
            Page {current + 1} of {pages}
          </span>
          <div className="ml-auto flex items-center gap-[10px]">
            <button
              type="button"
              aria-label="Earlier"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full disabled:opacity-45"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
            >
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden className="-scale-x-100">
                <path d="m1 1 5 5-5 5" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Later"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full disabled:opacity-45"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
            >
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
                <path d="m1 1 5 5-5 5" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
      /* Rows end at 383 and the design puts this on 420 inside a 465 card,
         so 33 above and 33 below the 16px line. */
      <div className="px-5 pb-[25px] pt-[33px]">
        <Link href="/calendar" className="inline-flex items-center gap-2.5 text-16 font-medium text-ink">
          View full queue
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
            <path d="m1 1 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
      )}

    </section>

    </>
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
  /* The design's other two. `regenerating` also spins its chip glyph — see the
     row — and `optimized` shares the green of `approved` because it is the same
     news: the agent is happy with it. */
  regenerating: { label: 'Regenerating', bg: '#FEF0FF', ring: '#F56BFF', fg: '#F56BFF' },
  optimized: { label: 'Optimized', bg: '#E9F9E7', ring: '#13D711', fg: '#13A711' },
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
  className,
}: {
  children: React.ReactNode;
  label: string;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** The row places these absolutely, on the design's 985/1032/1079. */
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={cn(
        'flex h-[37px] w-[37px] items-center justify-center rounded-lg border-0 bg-transparent disabled:cursor-not-allowed',
        className,
      )}
      style={style}
    >
      {children}
    </button>
  );
}

/**
 * The 23x24 calendar at 20,22 on every queue row - `#838383` strokes over an
 * `rgba(131,131,131,0.3)` header block, the same glyph the dashboard's Upcoming
 * rows use, traced from the prototype's path data.
 */
function QueueCalendarGlyph() {
  return (
    <svg width="23" height="24" viewBox="0 0 24 25" fill="none" aria-hidden>
      <path
        d="M3 6.5A3.5 3.5 0 0 1 6.5 3h11A3.5 3.5 0 0 1 21 6.5v-.4c.1.9.2 1.9.3 2.9H2.7c.1-1 .2-2 .3-2.9Z"
        fill="rgba(131,131,131,0.3)"
      />
      <rect x="2.7" y="4.1" width="18.6" height="18.4" rx="4" stroke="#838383" strokeWidth="1.7" />
      <path d="M2.9 9.9h18.2" stroke="#838383" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.1 1.9v3.8M18.5 1.9v3.8" stroke="#838383" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
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
