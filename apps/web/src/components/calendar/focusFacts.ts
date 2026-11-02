/**
 * The Draft Panel's "Current Focus" facts, from a campaign's `calendar.get`.
 *
 * These lived in `CalendarBoard`, which was the only opener that passed the
 * panel a focus — so a post opened from the Command Center, the queue, the
 * Drafts List or a notification showed no campaign card at all, though every
 * `DP` prototype draws one. The panel now reads the campaign itself when its
 * opener did not, and both build the card from the same functions.
 */

export interface FocusSlot {
  scheduledAt: string | null;
  status: string;
  /** Null for a slot placed on a day rather than on an account. */
  platform: string | null;
  /** Resolved from the playbook by `calendar.get`. Null when it no longer resolves. */
  mediaType: string | null;
}

export interface FocusMixSlice {
  pillar: string;
  count: number;
}

/** The part of `calendar.get`'s output the card reads. */
export interface FocusCalendarView {
  name: string;
  objective: string;
  mixActual: FocusMixSlice[];
  slots: FocusSlot[];
}

export interface FocusFacts {
  campaignName?: string;
  goal?: string;
  campaignType?: string;
  duration?: string;
  source?: string;
  production?: Array<{ label: string; state: string; tone: 'work' | 'done' | 'idle' }>;
  platforms?: string[];
  brandName?: string;
}

/** Every fact the card shows, for the post scheduled on `day` (YYYY-MM-DD). */
export function focusFromCalendar(
  view: FocusCalendarView,
  opts: { day?: string; source?: string; brandName?: string } = {},
): FocusFacts {
  return {
    campaignName: view.name,
    goal: view.objective,
    campaignType: leadingPillar(view.mixActual),
    duration: slotSpan(view.slots),
    ...(opts.source ? { source: opts.source } : {}),
    ...(opts.brandName ? { brandName: opts.brandName } : {}),
    production: productionByType(view.slots, opts.day),
    platforms: platformsOn(view.slots, opts.day),
  };
}

/**
 * How long the campaign runs, from its own slots.
 *
 * `calendar.get` returns no duration field, and the campaign's window is
 * whatever its scheduled days span — so this counts inclusive days between the
 * first and last scheduled slot rather than reporting a number nothing stores.
 * Unscheduled slots carry no date and are skipped.
 */
export function slotSpan(slots: FocusSlot[]): string | undefined {
  const days = slots.map((s) => s.scheduledAt).filter((d): d is string => Boolean(d)).sort();
  if (days.length === 0) return undefined;
  const first = Date.parse(`${days[0]!.slice(0, 10)}T00:00:00Z`);
  const last = Date.parse(`${days[days.length - 1]!.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(first) || Number.isNaN(last)) return undefined;
  const n = Math.round((last - first) / 86_400_000) + 1;
  return n === 1 ? '1 day' : `${n} days`;
}

/**
 * The campaign's "Type" — its leading pillar.
 *
 * `calendar.get` returns no type field. What a campaign *is* shows in the shape
 * of what it posts, and the mix is exactly that, so the pillar with the most
 * slots answers the question the design is asking. Undefined when the calendar
 * is empty, which is honest: a campaign with no posts has no shape yet.
 */
export function leadingPillar(mix: FocusMixSlice[]): string | undefined {
  const top = [...mix].sort((a, b) => b.count - a.count)[0];
  if (!top || top.count === 0) return undefined;
  return top.pillar.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * The four post types, and what each is doing on one date.
 *
 * The design's chip row — "Generating", "Completed", "No post", "No post" —
 * read as what it plainly is: one chip per type in the drawer's rail, in the
 * rail's order, describing that day. A type with nothing scheduled says
 * "No post" because there is genuinely no post, not because a slot was blank.
 */
export function productionByType(
  slots: FocusSlot[],
  day?: string,
): Array<{ label: string; state: string; tone: 'work' | 'done' | 'idle' }> {
  const onDay = day ? slots.filter((s) => (s.scheduledAt ?? '').slice(0, 10) === day) : slots;

  return (['image', 'video', 'carousel', 'text'] as const).map((type) => {
    const mine = onDay.filter((s) => s.mediaType === type);
    if (mine.length === 0) return { label: type, state: 'No post', tone: 'idle' as const };
    // "Completed" only when every post of that type is out; one still in flight
    // keeps the whole type in progress, which is what the chip is for.
    if (mine.every((s) => s.status === 'published')) {
      return { label: type, state: 'Completed', tone: 'done' as const };
    }
    if (mine.some((s) => s.status === 'scheduled' || s.status === 'needs_review')) {
      return { label: type, state: 'Scheduled', tone: 'work' as const };
    }
    return { label: type, state: 'Drafting', tone: 'work' as const };
  });
}

/**
 * The accounts one date is posting to, in the order they appear.
 *
 * Null is a real platform state — a slot placed on a day has no account until
 * one is chosen. Those are dropped rather than shown as an unnamed circle.
 */
export function platformsOn(slots: FocusSlot[], day?: string): string[] {
  const onDay = day ? slots.filter((s) => (s.scheduledAt ?? '').slice(0, 10) === day) : slots;
  return [...new Set(onDay.map((s) => s.platform).filter((p): p is string => Boolean(p)))];
}
