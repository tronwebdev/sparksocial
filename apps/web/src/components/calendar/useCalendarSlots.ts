'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';

/**
 * The rows every calendar span draws from.
 *
 * `CalendarMonthGrid` loads exactly this and keeps it to itself, which was fine
 * while Month was the only span that rendered anything. Week and Day need the
 * same rows scoped differently, and three copies of the same `content.list`
 * call would be three places to forget the two rules that matter:
 *
 *   - **every status**, not just `scheduled`. A month that hides drafts and
 *     failures is a calendar of one queue state, and the missing rows read as
 *     "nothing planned". The filter row is where narrowing belongs.
 *   - **only rows with a date**. `scheduledAt` is the only date `content.list`
 *     returns, so a draft that has never been placed has no day to sit on. That
 *     is honest rather than a gap.
 */

export interface CalendarSlot {
  contentItemId: string;
  playbookName: string;
  mediaType?: 'video' | 'image' | 'carousel' | 'text';
  platform?: string;
  status: string;
  summary: string;
  scheduledAt?: string;
}

export interface CalendarSlots {
  slots: CalendarSlot[] | null;
  error: string | null;
  reload: () => Promise<void>;
}

export function useCalendarSlots(genomeId: string | undefined): CalendarSlots {
  const [slots, setSlots] = useState<CalendarSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<{ items: CalendarSlot[] }>('content.list', {
      genomeId,
      /* `content.list` caps this at 100 — 200 comes back as a validation error. */
      limit: 100,
    });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      setSlots([]);
      return;
    }
    setError(null);
    setSlots(res.output.items.filter((s) => Boolean(s.scheduledAt)));
  }, [genomeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { slots, error, reload };
}

/** Local `YYYY-MM-DD`. `toISOString` is UTC and would file a 23:00 slot on the wrong day. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The Monday of the week `d` falls in — the design's weeks start on Monday. */
export function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  /* `getDay()` is 0 for Sunday, which belongs to the week that started six days
     earlier rather than the one about to start. */
  const back = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - back);
  return out;
}
