/**
 * EVERY IANA TIME ZONE, from the runtime rather than a hand-kept list.
 *
 * ── What was here before ─────────────────────────────────────────────────
 *
 * Four screens each carried their own copy of an eighteen-entry array —
 * onboarding's Brand Kit step, Settings' governance panel, the agency wizard
 * and the personal profile section — under a comment saying "600 zones is not
 * a select". The list is the same list four times, so the four could disagree,
 * and between them they covered about four percent of the world. A brand in
 * Karachi, Mexico City, Jakarta, Istanbul or Seoul could not state where it
 * was, and the first select was labelled **Country** while its options were
 * IANA *region* prefixes: `Europe`, `Africa`, `America`. Choosing "Europe" as
 * your country is not a smaller version of choosing Portugal; it is a
 * different question.
 *
 * ── Why this is not country-based ────────────────────────────────────────
 *
 * Because a correct country-to-zone mapping is a dataset, not a computation.
 * `Intl.Locale.prototype.getTimeZones()` would give exactly that from the
 * platform, and it is unavailable in Safari and in the Node this repo builds
 * on — verified, not assumed. The alternatives are to embed and then maintain
 * a ~250-country table, or to ask the question the platform can actually
 * answer completely. A region select that says "Region" is honest and covers
 * everywhere; a country select built on a table nobody updates goes wrong
 * quietly, in the direction of telling someone their country does not exist.
 *
 * So: the design's two-select shape is kept, the first one is relabelled, and
 * every zone the runtime knows is reachable.
 *
 * ── Why the offset is in the label ───────────────────────────────────────
 *
 * `America/Indiana/Vevay` is a correct answer that nobody recognises.
 * `(GMT-5) Indiana / Vevay` is the same answer with the part people actually
 * check. The offset is computed live, so it follows daylight saving rather
 * than freezing whatever it was on the day the list was written.
 */

/**
 * Every zone the runtime knows, plus `current` if it is not among them.
 *
 * The union is not defensive padding. `Intl.supportedValuesOf('timeZone')`
 * deliberately omits the legacy `Etc/*` aliases, and
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` will happily return one:
 * the machine this was written on reports `Etc/GMT-1`. Without the union the
 * select has no option matching its own value, so it renders blank and the
 * first interaction silently rewrites the brand's zone to whatever is at the
 * top of the list. Found by the test asserting the guess was selectable; it
 * was not.
 *
 * `Etc/GMT-1` is also a reminder not to "normalise" these to UTC — POSIX
 * inverts the sign, so that one is UTC**+**1 and collapsing it would move
 * every scheduled post by an hour.
 */
export function zonesIncluding(current: string | undefined): string[] {
  const zones = allTimezones();
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

/** Every zone the runtime knows, or a usable floor if it cannot say. */
export function allTimezones(): string[] {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    if (zones.length > 0) return [...zones];
  } catch {
    // `supportedValuesOf` is recent. Fall through rather than render nothing.
  }
  return [...FALLBACK_ZONES];
}

/**
 * The floor when `Intl.supportedValuesOf` is missing.
 *
 * Deliberately short. This is not a second copy of the list to maintain — it
 * is the "your browser is too old to enumerate zones" path, and its job is to
 * leave the control usable, not complete. `UTC` first because it is the one
 * answer that is always right somewhere.
 */
const FALLBACK_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

/**
 * The region a zone belongs to — the part before the first slash.
 *
 * `UTC` has no slash and is its own region, which is why this is a function
 * and not a `split('/')[0]` at each call site: that expression returns `'UTC'`
 * for `UTC` by luck rather than intent, and the version of this code that
 * relied on the luck had a separate branch apologising for it.
 */
export function regionOf(zone: string): string {
  const slash = zone.indexOf('/');
  return slash === -1 ? zone : zone.slice(0, slash);
}

/** Every region present, alphabetical, with `UTC` lifted to the front. */
export function timezoneRegions(zones: string[] = allTimezones()): string[] {
  const regions = [...new Set(zones.map(regionOf))].sort((a, b) => a.localeCompare(b));
  return ['UTC', ...regions.filter((r) => r !== 'UTC')];
}

/** The zones in one region, alphabetical by the part people read. */
export function zonesInRegion(region: string, zones: string[] = allTimezones()): string[] {
  return zones
    .filter((z) => regionOf(z) === region)
    .sort((a, b) => cityOf(a).localeCompare(cityOf(b)));
}

/** `America/Indiana/Vevay` → `Indiana / Vevay`; `UTC` → `UTC`. */
export function cityOf(zone: string): string {
  const slash = zone.indexOf('/');
  if (slash === -1) return zone;
  return zone.slice(slash + 1).replace(/_/g, ' ').replace(/\//g, ' / ');
}

/**
 * `(GMT+1)` for a zone, right now.
 *
 * Read out of `Intl.DateTimeFormat` rather than computed, because the only
 * correct source for "what is this zone's offset today" is the tz database the
 * runtime already carries. Returns an empty string for a zone the runtime
 * rejects, so one bad entry cannot throw the whole list away.
 */
export function offsetLabel(zone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(now);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    // Chrome gives `GMT+1`, and plain `GMT` at zero rather than `GMT+0`.
    return name ? `(${name === 'GMT' ? 'GMT+0' : name})` : '';
  } catch {
    return '';
  }
}

/** What a zone looks like in a select: `(GMT+1) Lagos`. */
export function zoneLabel(zone: string, now?: Date): string {
  const offset = offsetLabel(zone, now);
  return offset ? `${offset} ${cityOf(zone)}` : cityOf(zone);
}

/**
 * The viewer's own zone, when there is nothing stored yet.
 *
 * A brand's posting schedule runs in this zone (`campaign.calendar` passes it
 * straight to `Intl` as `timeZone`), so the default being wrong is not
 * cosmetic — it shifts every scheduled post. Guessing from the browser is
 * right far more often than defaulting to UTC, and the control shows the guess
 * rather than applying it silently.
 */
export function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
