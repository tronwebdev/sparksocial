/**
 * "2 minutes ago" / "in 3 days" — the prototype's own phrasing, in one place.
 *
 * Three surfaces on the cockpit alone need it (the activity feed, the upcoming
 * queue, the sales list) and each was about to grow its own version. Written by
 * hand rather than with `Intl.RelativeTimeFormat` because the prototype's rows
 * read "1 hour ago" and "1 day ago", and `Intl`'s narrow style gives "1h ago"
 * while its long style gives "1 hour ago" only for some units and locales.
 *
 * Callers pass `now` in tests. Left to default in the app, where the string is
 * recomputed on every render anyway.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** The magnitude, without a direction — "2 minutes", "3 days". */
function span(ms: number): string {
  if (ms < MINUTE) return 'less than a minute';
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'minute');
  if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour');
  if (ms < WEEK) return plural(Math.floor(ms / DAY), 'day');
  return plural(Math.floor(ms / WEEK), 'week');
}

/**
 * Past or future, whichever the timestamp is. One function rather than two,
 * because a scheduled post that has slipped past its slot is genuinely in the
 * past and a queue that could only say "in −2 hours" would hide exactly that.
 */
export function relativeTime(at: string | Date, now: Date = new Date()): string {
  const then = typeof at === 'string' ? new Date(at) : at;
  const ms = then.getTime() - now.getTime();
  if (Number.isNaN(ms)) return '';
  // A tolerance either side of now, so a row does not flicker between "in less
  // than a minute" and "less than a minute ago" as the clock crosses it.
  if (Math.abs(ms) < 30_000) return 'just now';
  return ms > 0 ? `in ${span(ms)}` : `${span(-ms)} ago`;
}

/**
 * A whole number with thousands separators, or `12.3k` / `4.5M` past a
 * threshold — impressions run to seven figures and a KPI card has room for four
 * characters, but "1,204" is more useful than "1.2k" when that is the real
 * number.
 */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return n.toLocaleString('en-US');
}
