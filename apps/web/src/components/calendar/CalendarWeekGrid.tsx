'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { PlatformIcon } from '@/components/common/PlatformIcon';
import {
  EMPTY_FILTERS,
  QueueFilters,
  matchesFilters,
  type QueueFilterState,
} from '@/components/command-center/QueueFilters';
import { dayKey, mondayOf, useCalendarSlots, type CalendarSlot } from './useCalendarSlots';

/**
 * Week view — the fourth screenshot supplied with the request.
 *
 * Month was the only span the calendar actually rendered; Week and Day were a
 * segmented control that changed a variable and nothing on screen. This is
 * Week: the same filter row the other spans carry, `< April 2026 >`, then seven
 * columns Monday–Sunday with one tall cell each.
 *
 *   header   weekday names, Sunday in red — the same rule the month grid uses
 *   cell     the date top-left, `+` top-right, then "Planned by Agent", a chip
 *            naming what is planned, the formats, and the channel glyphs
 *   empty    a centred `+` that opens the same Add Post chooser a month cell does
 *
 * ── Colour is by position, not status ─────────────────────────────────────
 *
 * The design cycles amber / cyan / purple across planned days, exactly as the
 * month grid does, so the tint is the day's index among the week's planned days.
 * Status has its own words in the chip; using colour for it too would make two
 * encodings of the same thing that disagree the moment one changes.
 */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TINTS = [
  { bg: 'var(--ss-cal-day-amber)', ring: 'var(--ss-cal-day-amber-ring)', chipRing: '#E48915' },
  { bg: 'var(--ss-cal-day-cyan)', ring: 'var(--ss-cal-day-cyan-ring)', chipRing: '#0BAAC7' },
  { bg: 'var(--ss-cal-day-purple)', ring: 'var(--ss-cal-day-purple-ring)', chipRing: '#8937D6' },
] as const;

const MEDIA_WORD: Record<string, string> = {
  video: 'Reel',
  image: 'Image',
  carousel: 'Carousel',
  text: 'Post',
};

const STATUS_WORD: Record<string, string> = {
  needs_review: 'Needs review',
  scheduled: 'Scheduled',
  approved: 'Approved',
  published: 'Published',
  draft: 'Draft',
  failed: 'Failed',
  blocked: 'Blocked',
};

function monthLabel(d: Date): string {
  return d.toLocaleDateString('en', { month: 'long', year: 'numeric' });
}

export function CalendarWeekGrid({
  genomeId,
  weekOffset,
  onWeekOffset,
  onOpenDraft,
  onAddPost,
  onCount,
}: {
  genomeId: string | undefined;
  weekOffset: number;
  onWeekOffset: (next: number) => void;
  onOpenDraft: (contentItemId: string) => void;
  onAddPost: (day: string) => void;
  /** Lets the screen's header say "N posts this week" from the rows on screen. */
  onCount?: (n: number) => void;
}) {
  const { slots, error } = useCalendarSlots(genomeId);
  const [filters, setFilters] = useState<QueueFilterState>(EMPTY_FILTERS);

  const start = useMemo(() => {
    const m = mondayOf(new Date());
    m.setDate(m.getDate() + weekOffset * 7);
    return m;
  }, [weekOffset]);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
      }),
    [start],
  );

  const visible = useMemo(
    () => (slots ?? []).filter((s) => matchesFilters(s, filters)),
    [slots, filters],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarSlot[]>();
    for (const s of visible) {
      const key = dayKey(new Date(s.scheduledAt!));
      const list = map.get(key);
      if (list) list.push(s);
      else map.set(key, [s]);
    }
    return map;
  }, [visible]);

  const inWeek = days.reduce((n, d) => n + (byDay.get(dayKey(d))?.length ?? 0), 0);
  /* Reported during render rather than in an effect: the parent only ever puts
     it in a sentence, and an effect would land a frame late every time. */
  if (onCount) onCount(inWeek);

  const platforms = useMemo(
    () => [...new Set((slots ?? []).map((s) => s.platform).filter(Boolean) as string[])],
    [slots],
  );
  const mediaTypes = useMemo(
    () => [...new Set((slots ?? []).map((s) => s.mediaType ?? 'text'))],
    [slots],
  );
  const statuses = useMemo(() => [...new Set((slots ?? []).map((s) => s.status))], [slots]);

  let tintIndex = -1;

  return (
    <section className="overflow-hidden rounded-lg bg-white p-[18px]">
      <div className="flex flex-wrap items-center gap-[14px]">
        <div className="flex h-[44px] items-center gap-[14px] rounded-[10px] px-[12px]" style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.25)' }}>
          <button type="button" onClick={() => onWeekOffset(weekOffset - 1)} aria-label="Previous week" className="flex h-[24px] w-[24px] items-center justify-center rounded-full transition-colors hover:bg-[rgba(131,131,131,0.12)]">
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
              <path d="M6 1 1 6l5 5" stroke="#0C0C0C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="whitespace-nowrap text-16 font-medium text-ink">{monthLabel(start)}</span>
          <button type="button" onClick={() => onWeekOffset(weekOffset + 1)} aria-label="Next week" className="flex h-[24px] w-[24px] items-center justify-center rounded-full transition-colors hover:bg-[rgba(131,131,131,0.12)]">
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
              <path d="m1 1 5 5-5 5" stroke="#0C0C0C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="ml-auto">
          <QueueFilters
            value={filters}
            onChange={setFilters}
            platforms={platforms}
            mediaTypes={mediaTypes}
            statuses={statuses}
            statusLabel={(s) => STATUS_WORD[s] ?? s}
          />
        </div>
      </div>

      {error ? <p className="mt-[12px] text-14 text-destructive">{error}</p> : null}

      <div className="mt-[16px] overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="border-b px-[10px] pb-[10px] text-16 font-medium"
                style={{ borderColor: 'rgba(131,131,131,0.2)', color: d === 'Sunday' ? 'var(--ss-cal-sunday)' : '#0C0C0C' }}
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((d) => {
              const key = dayKey(d);
              const posts = byDay.get(key) ?? [];
              const planned = posts.length > 0;
              if (planned) tintIndex += 1;
              const tint = TINTS[tintIndex % TINTS.length]!;
              const formats = [...new Set(posts.map((p) => MEDIA_WORD[p.mediaType ?? 'text'] ?? 'Post'))];
              const channels = [...new Set(posts.map((p) => p.platform).filter(Boolean) as string[])];

              return (
                <div key={key} className="border-b border-r p-[6px]" style={{ borderColor: 'rgba(131,131,131,0.14)' }}>
                  <div
                    className={cn(
                      'group relative flex h-[118px] flex-col rounded-[10px] p-[9px]',
                      planned ? '' : 'transition-colors hover:bg-[rgba(131,131,131,0.06)]',
                    )}
                    style={planned ? { background: tint.bg, boxShadow: `inset 0 0 0 1.3px ${tint.ring}` } : undefined}
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-15 font-medium text-ink">{d.getDate()}</span>
                      <button
                        type="button"
                        onClick={() => onAddPost(key)}
                        aria-label={`Add a post on ${d.toDateString()}`}
                        className={cn(
                          'flex h-[18px] w-[18px] items-center justify-center rounded-[5px] transition-opacity hover:bg-[rgba(12,12,12,0.08)]',
                          planned ? 'opacity-80' : 'opacity-0 group-hover:opacity-70',
                        )}
                      >
                        <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden>
                          <path d="M7 1v12M1 7h12" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>

                    {planned ? (
                      <>
                        <span className="mt-[6px] flex items-center gap-[6px]">
                          <span aria-hidden className="block h-[15px] w-[15px] shrink-0 rounded-full" style={{ background: 'linear-gradient(140deg,#6B4A2F,#2F2119)' }} />
                          <span className="truncate text-[11.5px]" style={{ color: '#5B5B5B' }}>
                            Planned by Agent
                          </span>
                        </span>

                        <button
                          type="button"
                          onClick={() => onOpenDraft(posts[0]!.contentItemId)}
                          title={posts[0]!.summary}
                          className="mt-[6px] truncate rounded-[6px] bg-white/70 px-[7px] py-[4px] text-left text-[11.5px] font-medium text-ink"
                          style={{ boxShadow: `inset 0 0 0 1.1px ${tint.chipRing}` }}
                        >
                          {posts.length > 1 ? `${posts.length} posts` : posts[0]!.summary || posts[0]!.playbookName}
                        </button>

                        <span className="mt-auto truncate text-[11.5px]" style={{ color: '#5B5B5B' }}>
                          {formats.join(', ')}
                        </span>
                        {channels.length > 0 ? (
                          <span className="mt-[4px] flex items-center gap-[5px]">
                            {channels.slice(0, 4).map((p) => (
                              <PlatformIcon key={p} platform={p} size={15} />
                            ))}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onAddPost(key)}
                        aria-label={`Plan a post on ${d.toDateString()}`}
                        className="flex flex-1 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-white" style={{ boxShadow: '0 6px 16px -10px rgba(12,12,12,0.5)' }}>
                          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
                            <path d="M7 1v12M1 7h12" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
