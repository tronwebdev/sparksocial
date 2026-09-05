'use client';

import { useEffect, useMemo, useState } from 'react';
import { PlatformIcon } from '@/components/common/PlatformIcon';
import {
  EMPTY_FILTERS,
  QueueFilters,
  matchesFilters,
  type QueueFilterState,
} from '@/components/command-center/QueueFilters';
import { dayKey, useCalendarSlots, type CalendarSlot } from './useCalendarSlots';

/**
 * Day view — the fifth screenshot: "Upcoming action queue" on a time axis.
 *
 * Not a third grid. A day has one column and the useful axis is time, so this
 * is a half-hour ladder with each post sitting in the slot its `scheduledAt`
 * falls in, an empty slot offering "+ Add New Post", and a red line where now
 * is.
 *
 * ── The window is the day's own, not 09:00–12:00 ──────────────────────────
 *
 * The design draws 09:00 to 12:00 because that is where its fixture data sits.
 * Hard-coding that would hide a 07:00 post and an 18:00 one — most of a posting
 * schedule — so the ladder runs from an hour before the first post to an hour
 * after the last, and falls back to the working day when nothing is planned.
 *
 * ── The "now" line ────────────────────────────────────────────────────────
 *
 * Drawn only on today. On any other day there is no now to mark, and a red line
 * across next Tuesday would be a decoration that reads as a deadline.
 */

const SLOT_MINUTES = 30;

const TINTS = [
  { bg: 'var(--ss-cal-day-amber)', ring: 'var(--ss-cal-day-amber-ring)', chipRing: '#E48915' },
  { bg: 'var(--ss-cal-day-cyan)', ring: 'var(--ss-cal-day-cyan-ring)', chipRing: '#0BAAC7' },
  { bg: 'var(--ss-cal-day-purple)', ring: 'var(--ss-cal-day-purple-ring)', chipRing: '#8937D6' },
] as const;

const MEDIA_WORD: Record<string, string> = {
  video: 'Video',
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

function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function minutesOf(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function CalendarDayQueue({
  genomeId,
  dayOffset,
  onDayOffset,
  onOpenDraft,
  onAddPost,
  onCount,
}: {
  genomeId: string | undefined;
  dayOffset: number;
  onDayOffset: (next: number) => void;
  onOpenDraft: (contentItemId: string) => void;
  onAddPost: (day: string) => void;
  onCount?: (n: number) => void;
}) {
  const { slots, error } = useCalendarSlots(genomeId);
  const [filters, setFilters] = useState<QueueFilterState>(EMPTY_FILTERS);
  const [now, setNow] = useState(() => new Date());

  /* The line moves. A minute is fine — this is a schedule, not a stopwatch. */
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const day = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [dayOffset]);

  const onDay = useMemo(() => {
    const key = dayKey(day);
    return (slots ?? [])
      .filter((s) => dayKey(new Date(s.scheduledAt!)) === key)
      .filter((s) => matchesFilters(s, filters))
      .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
  }, [slots, day, filters]);

  if (onCount) onCount(onDay.length);

  /* The ladder's bounds, rounded out to the half hour either side. */
  const { from, to } = useMemo(() => {
    if (onDay.length === 0) return { from: 9 * 60, to: 18 * 60 };
    const times = onDay.map((s) => minutesOf(s.scheduledAt!));
    const lo = Math.max(0, Math.min(...times) - 60);
    const hi = Math.min(23 * 60 + 30, Math.max(...times) + 60);
    return { from: lo - (lo % SLOT_MINUTES), to: hi - (hi % SLOT_MINUTES) };
  }, [onDay]);

  const rows = useMemo(() => {
    const out: number[] = [];
    for (let m = from; m <= to; m += SLOT_MINUTES) out.push(m);
    return out;
  }, [from, to]);

  const isToday = dayKey(day) === dayKey(new Date());
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const platforms = useMemo(
    () => [...new Set((slots ?? []).map((s) => s.platform).filter(Boolean) as string[])],
    [slots],
  );
  const mediaTypes = useMemo(() => [...new Set((slots ?? []).map((s) => s.mediaType ?? 'text'))], [slots]);
  const statuses = useMemo(() => [...new Set((slots ?? []).map((s) => s.status))], [slots]);

  let tintIndex = -1;

  return (
    <section className="overflow-hidden rounded-lg bg-white">
      <div className="flex flex-wrap items-center gap-3 px-[22px] pb-[14px] pt-[16px]">
        <h2 className="text-20 font-semibold leading-[1.28] text-ink">Upcoming action queue</h2>
        <span
          title="Everything scheduled for this day, in the order it will happen. Empty slots are open — add a post to one."
          className="flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
          style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
        >
          i
        </span>

        <div className="ml-auto flex items-center gap-[10px]">
          <span className="text-14 font-medium text-ink-muted">Filters:</span>
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

      <div className="flex items-center gap-[10px] border-t px-[22px] py-[12px]" style={{ borderColor: 'rgba(131,131,131,0.16)' }}>
        <button type="button" onClick={() => onDayOffset(dayOffset - 1)} aria-label="Previous day" className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] transition-colors hover:bg-[rgba(131,131,131,0.12)]" style={{ boxShadow: 'inset 0 0 0 1.1px rgba(131,131,131,0.3)' }}>
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
            <path d="M6 1 1 6l5 5" stroke="#0C0C0C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" onClick={() => onDayOffset(dayOffset + 1)} aria-label="Next day" className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] transition-colors hover:bg-[rgba(131,131,131,0.12)]" style={{ boxShadow: 'inset 0 0 0 1.1px rgba(131,131,131,0.3)' }}>
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
            <path d="m1 1 5 5-5 5" stroke="#0C0C0C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <p className="flex-1 text-center text-17 font-semibold text-ink">
          {day.toLocaleDateString('en', { weekday: 'long', day: 'numeric' })}
          {isToday ? <span className="ml-[8px] text-14 font-medium text-ink-muted">Today</span> : null}
        </p>
        {/* Balances the two arrows so the date sits centred. */}
        <span aria-hidden className="w-[62px]" />
      </div>

      {error ? <p className="px-[22px] pb-[12px] text-14 text-destructive">{error}</p> : null}

      <div className="border-t" style={{ borderColor: 'rgba(131,131,131,0.16)' }}>
        {rows.map((m) => {
          const posts = onDay.filter((s) => {
            const at = minutesOf(s.scheduledAt!);
            return at >= m && at < m + SLOT_MINUTES;
          });
          const showNow = isToday && nowMinutes >= m && nowMinutes < m + SLOT_MINUTES;

          return (
            <div key={m} className="relative flex min-h-[76px] border-b" style={{ borderColor: 'rgba(131,131,131,0.12)' }}>
              <div className="w-[110px] shrink-0 px-[16px] py-[14px] text-[14px] font-medium leading-[1.3]" style={{ color: '#5B5B5B' }}>
                {clockLabel(m)}
              </div>

              <div className="min-w-0 flex-1 py-[8px] pr-[16px]">
                {posts.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => onAddPost(dayKey(day))}
                    className="flex h-[58px] w-full items-center justify-center gap-[8px] rounded-[10px] text-[13.5px] font-medium text-ink-muted transition-colors hover:bg-[rgba(131,131,131,0.06)]"
                    style={{ background: 'rgba(131,131,131,0.05)' }}
                  >
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M7 1v12M1 7h12" stroke="#838383" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    Add New Post
                  </button>
                ) : (
                  posts.map((s) => {
                    tintIndex += 1;
                    const tint = TINTS[tintIndex % TINTS.length]!;
                    return <Entry key={s.contentItemId} slot={s} tint={tint} onOpen={() => onOpenDraft(s.contentItemId)} />;
                  })
                )}
              </div>

              {showNow ? (
                <span aria-hidden className="pointer-events-none absolute left-[110px] right-0 flex items-center" style={{ top: `${((nowMinutes - m) / SLOT_MINUTES) * 100}%` }}>
                  <span className="block h-[9px] w-[9px] rounded-full" style={{ background: '#F35525' }} />
                  <span className="block h-[2px] flex-1" style={{ background: '#F35525' }} />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Entry({
  slot,
  tint,
  onOpen,
}: {
  slot: CalendarSlot;
  tint: { bg: string; ring: string; chipRing: string };
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-[8px] flex w-full items-center gap-[14px] rounded-[10px] p-[10px] text-left last:mb-0"
      style={{ background: tint.bg, boxShadow: `inset 0 0 0 1.3px ${tint.ring}` }}
    >
      <span className="flex h-[52px] w-[74px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-white/70">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <rect x="2" y="3" width="14" height="12" rx="3" stroke="#5B5B5B" strokeWidth="1.4" />
          <circle cx="6.4" cy="7.2" r="1.3" stroke="#5B5B5B" strokeWidth="1.2" />
          <path d="m3.4 13 3.6-3.6a1.6 1.6 0 0 1 2.2 0l4.2 4.2" stroke="#5B5B5B" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium text-ink">
          {slot.summary || slot.playbookName}
        </span>
        <span className="mt-[6px] flex items-center gap-[8px]">
          <span aria-hidden className="block h-[15px] w-[15px] shrink-0 rounded-full" style={{ background: 'linear-gradient(140deg,#6B4A2F,#2F2119)' }} />
          <span className="text-[11.5px]" style={{ color: '#5B5B5B' }}>
            Planned by Agent
          </span>
          {slot.platform ? <PlatformIcon platform={slot.platform} size={15} /> : null}
        </span>
      </span>

      <span
        className="shrink-0 rounded-[6px] bg-white/80 px-[9px] py-[4px] text-[11.5px] font-medium text-ink"
        style={{ boxShadow: `inset 0 0 0 1.1px ${tint.chipRing}` }}
      >
        {MEDIA_WORD[slot.mediaType ?? 'text'] ?? 'Post'}
      </span>
    </button>
  );
}
