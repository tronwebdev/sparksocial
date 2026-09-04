'use client';

import { useCallback, useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { postKindLabel } from '@/lib/platforms';
import { cn } from '@/lib/utils';
import { PlatformIcon } from '@/components/common/PlatformIcon';
import {
  EMPTY_FILTERS,
  QueueCardHeader,
  QueueFilters,
  matchesFilters,
  type QueueFilterState,
} from './QueueFilters';
import { SparkMark } from '@/components/brand/SparkMark';

/**
 * Calendar Mode — the month grid on the Agent Calendar tab
 * (`SparkSocial Command Center.dc.html`).
 *
 * ── Why this is not `CalendarBoard` ───────────────────────────────────────
 *
 * The tab used to mount `CalendarBoard` here, and switching to Calendar Mode
 * rendered no month grid at all: no weekday row, no cells. `CalendarBoard` is
 * the `/calendar` *screen* — campaign list, generate flow, its own board — and
 * it is that screen's, reached from `(app)/calendar/page.tsx`. Reshaping it to
 * the two 7-column grids this card wants would have rewritten a screen this
 * task is not allowed to touch, so the card gets its own grid and `/calendar`
 * is left exactly as it was.
 *
 * ── The design's numbers, card-relative ──────────────────────────────────
 *
 *   weekday row   28,96   1573 wide, 7 columns, 8px gaps, centred 16/500
 *                         `#838383` over 10px of padding
 *   cells         28,136  same grid, each 140 tall at radius 16 in a
 *                         `rgba(131,131,131,0.18)` ring
 *   day number    14,9    20px/500
 *   post chip     10,44   right 10, 64 tall, radius 10, white in a
 *                         `rgba(131,131,131,0.25)` ring, padding 8/10
 *
 * Past and other-month cells drop to `rgba(131,131,131,0.06)`, and their
 * numbers to `rgba(131,131,131,0.45)` (other month) or `#838383` (past).
 *
 * ── Five weeks, except when the month needs six ──────────────────────────
 *
 * The prototype draws exactly 35 cells, which is what its invented month
 * happens to need. Rendering a fixed 35 for a real month silently drops the
 * days that do not fit — and with them any post scheduled on one. So the grid
 * computes the weeks the month actually spans, and a six-week month is 148px
 * taller than the design's card. That is the one place this deliberately
 * departs from the prototype: losing a scheduled post off the bottom of a
 * calendar is not a fidelity trade worth making.
 */

interface Slot {
  contentItemId: string;
  playbookName: string;
  mediaType?: 'video' | 'image' | 'carousel' | 'text';
  platform?: string;
  status: string;
  summary: string;
  scheduledAt?: string;
}

const NO_COPY = '(no copy yet)';
/**
 * The design's three planned-day palettes, each a tint with its own ring and a
 * matching chip stroke. A planned day is coloured by *which* day it is in the
 * month's run of them, not by status — the prototype cycles amber, cyan, purple
 * across its three examples, so the cycle is by index.
 */
const DAY_TINTS = [
  { bg: 'var(--ss-cal-day-amber)', ring: 'var(--ss-cal-day-amber-ring)', chipRing: '#E48915' },
  { bg: 'var(--ss-cal-day-cyan)', ring: 'var(--ss-cal-day-cyan-ring)', chipRing: '#0BAAC7' },
  { bg: 'var(--ss-cal-day-purple)', ring: 'var(--ss-cal-day-purple-ring)', chipRing: '#8937D6' },
] as const;

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Local `YYYY-MM-DD`. `toISOString` is UTC and would file a 23:00 slot on the wrong day. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CalendarMonthGrid({
  genomeId,
  onOpenDraft,
  variant = 'panel',
  onAddPost,
  monthOffset = 0,
  onMonthOffset,
}: {
  genomeId: string | undefined;
  onOpenDraft: (contentItemId: string) => void;
  /*
    Two sizes, two screens.

    `panel` is the Command Center's Agent Calendar tab: 140px cells at radius 16
    inside a card that also carries a list view, so a cell holds a day number and
    one compact chip. `screen` is `SparkSocial Calendar.dc.html`, where the grid
    *is* the screen — 226px cells at radius 20, each with an add button, who
    planned it, a tinted status chip, the post's type and its platform marks.

    One component rather than two because the month arithmetic, the local-date
    bucketing and the six-week case are the hard parts and they are identical.
  */
  variant?: 'panel' | 'screen';
  /** `screen` only: an empty day offers to create for that date. */
  onAddPost?: (isoDate: string) => void;
  /** Months from the current one, so the chrome can page. */
  monthOffset?: number;
  onMonthOffset?: (next: number) => void;
}) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<QueueFilterState>(EMPTY_FILTERS);

  const load = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<{ items: Slot[] }>('content.list', {
      genomeId,
      status: 'scheduled',
      // `content.list` caps this at 100; 200 came back as a validation error.
      limit: 100,
    });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setError(null);
    setSlots(res.output.items.filter((s) => Boolean(s.scheduledAt)));
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!genomeId) return null;

  /* The month on screen, Monday-first like the design's own week order. */
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  // 0 = Monday. `getDay()` is Sunday-first, so Sunday (0) becomes 6.
  const lead = (first.getDay() + 6) % 7;
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);

  const byDay = new Map<string, Slot[]>();
  for (const s of (slots ?? []).filter((x) => matchesFilters(x, filters))) {
    const k = dayKey(new Date(s.scheduledAt!));
    const list = byDay.get(k);
    if (list) list.push(s);
    else byDay.set(k, [s]);
  }

  const todayKey = dayKey(today);

  /* The filter row's options come from the month's own slots. */
  const platforms = [...new Set((slots ?? []).map((x) => x.platform).filter((x): x is string => Boolean(x)))].sort();
  const mediaTypes = [...new Set((slots ?? []).map((x) => x.mediaType ?? 'text'))].sort();
  const statuses = [...new Set((slots ?? []).map((x) => x.status))].sort();

  return (
    /*
      The card, not just the grid.

      The design has one card here and swaps only its body: the heading, the
      info glyph and the five filters stay put across List View and Calendar
      Mode. Rendering the bare grid took the whole card with it the moment the
      toggle flipped, so the chrome is shared - see `QueueCardHeader`.
    */
    <section className="overflow-hidden rounded-lg bg-white">
      {variant === 'panel' ? (
        <QueueCardHeader
          title="Upcoming action queue"
          hint="Every post your agent has placed this month. A day with a post opens it."
        />
      ) : (
        /*
          The Calendar screen's own head: a 242x54 month stepper at 24,22 and the
          five filter boxes at 601 / 811 / 1021 / 1231 / 1441, all on top 22.
        */
        <div className="flex flex-wrap items-center gap-[16px] pl-cal-inset pr-0 pt-[22px]">
          <div
            className="flex h-[54px] w-[242px] shrink-0 items-center rounded px-[6px]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
          >
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => onMonthOffset?.(monthOffset - 1)}
              className="flex h-[32px] w-[32px] items-center justify-center rounded-lg transition-colors hover:bg-[rgba(131,131,131,0.08)]"
            >
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden>
                <path d="M7 1 1 7l6 6" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="flex-1 text-center text-[17px] font-semibold text-ink">
              {first.toLocaleDateString('en', { month: 'long', year: 'numeric' })}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => onMonthOffset?.(monthOffset + 1)}
              className="flex h-[32px] w-[32px] items-center justify-center rounded-lg transition-colors hover:bg-[rgba(131,131,131,0.08)]"
            >
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden>
                <path d="m1 1 6 6-6 6" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* The same five as the queue card's, and the same three of them work
              — this grid holds its slots client-side too. */}
          <QueueFilters
            value={filters}
            onChange={setFilters}
            platforms={platforms}
            mediaTypes={mediaTypes}
            statuses={statuses}
            statusLabel={(st) => st[0]!.toUpperCase() + st.slice(1)}
          />
        </div>
      )}
      {/*
        No hairline here. The design draws one at 140 in List View, under the
        column labels — Calendar Mode has none, and its weekday row starts at 96
        with the cells at 136. The header band is 86, so that is 10 then 14.
      */}
      <div
        className={cn(
          variant === 'screen'
            ? /* 24 in; weekday row on 100, which is 24 under the 76-tall head. */
              'px-cal-inset pb-[37px] pt-[24px]'
            : 'px-7 pb-8 pt-[10px]',
        )}
      >
      {error ? <p className="pb-3 text-[13px] text-destructive">{error}</p> : null}

      {/* 96 and 136 in the design are 16 and 56 below the card's 80px hairline. */}
      <div className="grid grid-cols-7 gap-[8px]">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className={cn(
              'text-center',
              variant === 'screen'
                ? 'pb-[12px] text-[17px] font-medium'
                : 'pb-[10px] text-16 font-medium text-ink-muted',
            )}
            /* Sunday is the one weekday the design colours, and the only red on
               the screen. */
            style={variant === 'screen' ? { color: d === 'Sunday' ? 'var(--ss-cal-sunday)' : '#0C0C0C' } : undefined}
          >
            {/* The design writes them in full; there is not room for that under
                220px of column, so the short form appears below `2xl`. */}
            <span className="hidden 2xl:inline">{d}</span>
            <span className="2xl:hidden">{d.slice(0, 3)}</span>
          </div>
        ))}
      </div>

      {slots === null && !error ? (
        <div className={cn('grid grid-cols-7 gap-[8px]', variant === 'screen' ? 'mt-[8px]' : 'mt-[14px]')}>
          {Array.from({ length: weeks * 7 }, (_, i) => (
            <Skeleton key={i} className={cn('rounded-2xl', variant === 'screen' ? 'h-cal-cell' : 'h-[140px]')} />
          ))}
        </div>
      ) : (
        <div className={cn('grid grid-cols-7 gap-[8px]', variant === 'screen' ? 'mt-[8px]' : 'mt-[14px]')}>
          {Array.from({ length: weeks * 7 }, (_, i) => {
            const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
            const otherMonth = date.getMonth() !== first.getMonth();
            const key = dayKey(date);
            const past = !otherMonth && key < todayKey;
            const posts = byDay.get(key) ?? [];
            const post = posts[0];
            const tint = DAY_TINTS[date.getDate() % DAY_TINTS.length]!;
            /* A day with nothing on it opens the chooser — screen variant only,
               in-month only, and only when the screen gave us somewhere to go. */
            const interactive = variant === 'screen' && !otherMonth && Boolean(onAddPost);

            return (
              <div
                key={key}
                className={cn(
                  'group relative overflow-hidden',
                  variant === 'screen' ? 'h-cal-cell rounded-[20px]' : 'h-[140px] rounded-2xl',
                  post || (variant === 'screen' && !otherMonth && onAddPost)
                    ? 'cursor-pointer transition-shadow'
                    : undefined,
                )}
                style={{
                  background:
                    variant === 'screen' && post
                      ? tint.bg
                      : otherMonth || past
                        ? 'rgba(131,131,131,0.06)'
                        : '#FFFFFF',
                  boxShadow:
                    variant === 'screen' && post
                      ? `inset 0 0 0 1.5px ${tint.ring}`
                      : 'inset 0 0 0 1px rgba(131,131,131,0.18)',
                }}
                onClick={
                  post
                    ? () => onOpenDraft(post.contentItemId)
                    : variant === 'screen' && !otherMonth
                      ? () => onAddPost?.(key)
                      : undefined
                }
                /* An empty in-month day is a control too, once there is
                   somewhere for it to go — the `onClick` above already covered
                   that case and these two did not, so the day was clickable by
                   mouse and invisible to the keyboard. */
                role={post || interactive ? 'button' : undefined}
                tabIndex={post || interactive ? 0 : undefined}
                onKeyDown={
                  post || interactive
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (post) onOpenDraft(post.contentItemId);
                          else onAddPost?.(key);
                        }
                      }
                    : undefined
                }
              >
                <span
                  className={cn(
                    'absolute text-[20px] font-medium tabular-nums',
                    variant === 'screen' ? 'left-[16px] top-[11px]' : 'left-[14px] top-[9px]',
                  )}
                  style={{
                    color: otherMonth ? 'rgba(131,131,131,0.45)' : past ? '#838383' : '#0C0C0C',
                  }}
                >
                  {date.getDate()}
                </span>

                {/*
                  Today is not a state the design draws — its month is invented,
                  so nothing in it is today. A calendar that cannot show you
                  where you are is worse than one pixel off, so today's number
                  carries the brand ring.
                */}
                {!otherMonth && key === todayKey ? (
                  <span
                    aria-hidden
                    className="absolute left-[8px] top-[4px] h-[30px] w-[30px] rounded-full"
                    style={{ boxShadow: 'inset 0 0 0 1.5px var(--ss-accent-purple)' }}
                  />
                ) : null}

                {/*
                  The screen variant's cell, on the design's own offsets: an add
                  button at right 11 / top 11, who planned it at 16,52, a 37px
                  status chip at 16,94, the type at 16,146 and the platform marks
                  at 16,176. A day with nothing planned reveals a centred add
                  button on hover, which is the prototype's `isHover` cell.
                */}
                {variant === 'screen' ? (
                  post ? (
                    <>
                      <span
                        aria-hidden
                        className="absolute right-[11px] top-[11px] flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-white"
                        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                          <path d="M6.5 1v11M1 6.5h11" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </span>

                      <span className="absolute left-[16px] top-[52px] flex items-center gap-[8px]">
                        <SparkMark variant="shell" size={26} />
                        <span className="whitespace-nowrap text-[13.5px] font-medium text-ink">
                          Planned by Agent
                        </span>
                      </span>

                      <span
                        className="absolute left-[16px] right-[16px] top-[94px] flex h-[37px] items-center rounded-[9px] px-[12px]"
                        style={{
                          background: 'rgba(255,255,255,0.65)',
                          boxShadow: `inset 0 0 0 1.2px ${tint.chipRing}`,
                        }}
                      >
                        <span
                          className="truncate text-14 font-semibold"
                          style={{ color: tint.chipRing }}
                        >
                          {post.summary === NO_COPY ? 'not written yet' : post.summary}
                        </span>
                      </span>

                      <span
                        className="absolute left-[16px] top-[146px] truncate text-15 font-medium"
                        style={{ color: '#3B3B3B', maxWidth: 'calc(100% - 32px)' }}
                      >
                        {postKindLabel(post.platform, post.mediaType)}
                      </span>

                      <span className="absolute left-[16px] top-[176px] flex items-center gap-[6px]">
                        <PlatformIcon platform={post.platform} size={24} />
                        {posts.length > 1 ? (
                          <span className="text-[13px] font-semibold text-brand-purple">
                            +{posts.length - 1}
                          </span>
                        ) : null}
                      </span>
                    </>
                  ) : !otherMonth && onAddPost ? (
                    <span
                      aria-hidden
                      className="absolute left-1/2 top-1/2 flex h-[34px] w-[34px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-white opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 13 13" fill="none">
                        <path d="M6.5 1v11M1 6.5h11" stroke="#838383" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </span>
                  ) : null
                ) : post ? (
                  <div
                    className="absolute left-[10px] right-[10px] top-[44px] h-[64px] overflow-hidden rounded bg-white px-[10px] py-[8px]"
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' }}
                  >
                    <div className="flex items-center gap-[6px]">
                      {/* 16px in the design's cells. */}
                      <PlatformIcon platform={post.platform} size={16} />
                      <span className="truncate text-[12.5px] font-semibold text-ink">
                        {postKindLabel(post.platform, post.mediaType)}
                      </span>
                      {posts.length > 1 ? (
                        <span className="shrink-0 text-[11px] font-semibold text-brand-purple">
                          +{posts.length - 1}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-[6px] truncate text-[11.5px] font-medium text-ink-muted">
                      {post.summary === NO_COPY ? 'not written yet' : post.summary}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </section>
  );
}
