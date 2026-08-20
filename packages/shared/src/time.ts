/**
 * BRAND-LOCAL TIME — PRD §8.2 (timezone is required at onboarding) and §8.7
 * (timezone and posting windows are Calendar inputs).
 *
 * Before this module the product had no concept of a time of day at all. Grep
 * for `setHours`, `setUTCHours`, "posting window" or "best time" returned
 * nothing, and `placeCalendar` computed `scheduledAt = addDays(startAt, n)`.
 * Three things followed from that, all of them visible to a customer:
 *
 *   1. Every post in a campaign fired at whatever wall-clock instant the
 *      campaign happened to be created, in UTC. A campaign made at 03:47 posted
 *      at 03:47 for a month.
 *   2. Two posts placed on the same day got byte-identical timestamps and went
 *      out simultaneously — normal as soon as a month's post count exceeds its
 *      window in days.
 *   3. The first day's slots were already in the past by the next scheduler
 *      tick, which is how activating a campaign came to block its own opening
 *      week.
 *
 * ── Why no dependency ──────────────────────────────────────────────────────
 *
 * `Intl.DateTimeFormat` with a `timeZone` is the platform's own IANA database,
 * kept current by the runtime rather than by a lockfile, and it is all this
 * needs. A date library would be a second source of zone truth to keep in sync
 * with the one Node already ships.
 */

/** The spread used for a brand that has never set its own windows. */
export const DEFAULT_POSTING_WINDOWS = [9, 13, 18] as const;

/**
 * Minutes to stagger a second, third … post sharing one window.
 *
 * Not zero, which is the bug this exists to prevent: two posts on one instant
 * hit the platform together, which is both the pattern rate limiters punish and
 * the pattern an audience reads as a bot.
 */
const STAGGER_MINUTES = 7;

/**
 * The zone's UTC offset in minutes at a given instant — positive east of
 * Greenwich, matching the sign convention people write (`+01:00`) rather than
 * `Date.prototype.getTimezoneOffset`'s inverted one.
 *
 * Derived by formatting the instant *in* the zone and reading the wall-clock
 * numbers back out. That is the only way to get this from `Intl` without
 * parsing a localized offset string, and it is exact: the difference between
 * "what the clock says there" and "what the clock says in UTC" is the offset.
 */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);
  } catch {
    // An unknown zone name is a data problem, not a reason to fail a publish.
    // UTC is the schema default and the honest fallback.
    return 0;
  }

  const at = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type)?.value;
    return found ? Number(found) : 0;
  };

  // `hour12: false` renders midnight as 24 in some ICU versions.
  const hour = at('hour') % 24;
  const asUtc = Date.UTC(at('year'), at('month') - 1, at('day'), hour, at('minute'), at('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The calendar date, in the brand's own zone, that an instant falls on. */
export function zonedYmd(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const offset = zoneOffsetMinutes(instant, timeZone);
  const shifted = new Date(instant.getTime() + offset * 60_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/**
 * The UTC instant at which a given wall-clock time occurs in a zone.
 *
 * Resolved twice on purpose. The offset depends on the instant, and the instant
 * is what we are solving for, so the first pass uses the offset at the naive
 * guess and the second corrects it. That second pass is what makes the hour
 * come out right on the two days a year a DST transition moves it — without it,
 * a 09:00 slot lands at 08:00 or 10:00 for half the year.
 */
export function zonedTimeToUtc(
  date: { year: number; month: number; day: number },
  timeOfDay: { hour: number; minute?: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, timeOfDay.hour, timeOfDay.minute ?? 0, 0, 0);
  const firstGuess = new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  return new Date(naive - zoneOffsetMinutes(firstGuess, timeZone) * 60_000);
}

export interface PostingSlotArgs {
  /** Days from the campaign's start, 0-based — `placeCalendar`'s own `dayOffset`. */
  dayOffset: number;
  /** How many posts already placed on this same day, so they do not collide. */
  indexWithinDay: number;
  /** The campaign's start, which fixes which local day `dayOffset: 0` means. */
  startAt: Date;
  timeZone: string;
  /** Local hours-of-day, earliest first. Falls back to {@link DEFAULT_POSTING_WINDOWS}. */
  postingWindows?: number[];
  /**
   * Nothing may be scheduled before this instant.
   *
   * This is the whole of the day-0 fix. `dayOffset: 0`'s window has usually
   * already passed by the time somebody activates a campaign in the afternoon,
   * and a slot in the past is due immediately — which is how activation came to
   * publish (or block) its own first day within one scheduler tick. A slot that
   * would land in the past rolls forward to the next available window instead.
   */
  notBefore?: Date;
}

/**
 * When a post placed at `dayOffset` should actually go out.
 *
 * Pure, and deterministic for the same inputs — `placeCalendar`'s regeneration
 * loop depends on that: the user nudges the mix and asks again, and a calendar
 * that reshuffled every unrelated slot's *time* on each pass would make the
 * change impossible to judge.
 */
export function postingSlotAt(args: PostingSlotArgs): Date {
  const windows = normaliseWindows(args.postingWindows);
  const { dayOffset, indexWithinDay, startAt, timeZone } = args;

  // Which local day this offset lands on, counted in the brand's own zone so
  // that a campaign starting at 23:00 local does not have its day 1 fall on the
  // same calendar day as its day 0.
  const base = zonedYmd(startAt, timeZone);
  const dayCursor = new Date(Date.UTC(base.year, base.month - 1, base.day));
  dayCursor.setUTCDate(dayCursor.getUTCDate() + dayOffset);

  // More posts on a day than it has windows: reuse windows in order and push
  // each repeat a few minutes later, rather than stacking them on one instant.
  const windowIndex = indexWithinDay % windows.length;
  const extraCycles = Math.floor(indexWithinDay / windows.length);

  let candidate = zonedTimeToUtc(
    { year: dayCursor.getUTCFullYear(), month: dayCursor.getUTCMonth() + 1, day: dayCursor.getUTCDate() },
    { hour: windows[windowIndex]!, minute: extraCycles * STAGGER_MINUTES },
    timeZone,
  );

  // Roll forward past `notBefore`, window by window, so a campaign activated
  // mid-afternoon starts at this evening's window rather than this morning's.
  if (args.notBefore) {
    let guard = 0;
    let cursorDay = dayCursor;
    let cursorIndex = windowIndex;
    while (candidate.getTime() < args.notBefore.getTime() && guard < windows.length * 8) {
      cursorIndex += 1;
      if (cursorIndex >= windows.length) {
        cursorIndex = 0;
        cursorDay = new Date(cursorDay.getTime());
        cursorDay.setUTCDate(cursorDay.getUTCDate() + 1);
      }
      candidate = zonedTimeToUtc(
        { year: cursorDay.getUTCFullYear(), month: cursorDay.getUTCMonth() + 1, day: cursorDay.getUTCDate() },
        { hour: windows[cursorIndex]!, minute: extraCycles * STAGGER_MINUTES },
        timeZone,
      );
      guard += 1;
    }
  }

  return candidate;
}

/** Sorted, de-duplicated, in-range hours — a config typo must not place a post at hour 47. */
function normaliseWindows(raw?: number[]): number[] {
  const cleaned = [...new Set((raw ?? []).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort(
    (a, b) => a - b,
  );
  return cleaned.length ? cleaned : [...DEFAULT_POSTING_WINDOWS];
}
