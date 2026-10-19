import { describe, expect, it } from 'vitest';
import {
  allTimezones,
  cityOf,
  guessTimezone,
  offsetLabel,
  regionOf,
  timezoneRegions,
  zoneLabel,
  zonesInRegion,
  zonesIncluding,
} from '../src/timezones.js';

/**
 * The zone list four screens used to carry eighteen hand-written entries of.
 *
 * The assertions that matter are coverage ones: the old list could not express
 * Karachi, Jakarta, Mexico City, Istanbul or Seoul, and a brand's whole posting
 * schedule runs in whatever this control stores.
 */

describe('coverage', () => {
  it('knows far more than the eighteen zones that were hard-coded', () => {
    expect(allTimezones().length).toBeGreaterThan(300);
  });

  it('includes the zones the old list could not express', () => {
    const zones = allTimezones();
    for (const zone of [
      'Asia/Karachi',
      'Asia/Jakarta',
      'America/Mexico_City',
      'Europe/Istanbul',
      'Asia/Seoul',
      'Pacific/Auckland',
    ]) {
      expect(zones).toContain(zone);
    }
  });

  it('offers regions beyond the five the old list reached', () => {
    const regions = timezoneRegions();
    for (const region of ['Pacific', 'Indian', 'Atlantic', 'Antarctica']) {
      expect(regions).toContain(region);
    }
  });
});

describe('regionOf — UTC is the awkward one', () => {
  it('splits an ordinary zone at the first slash', () => {
    expect(regionOf('Africa/Lagos')).toBe('Africa');
    expect(regionOf('America/Indiana/Vevay')).toBe('America');
  });

  /*
   * The case every hand-rolled `split('/')[0]` in the four old copies got
   * right by accident and then needed a special branch for anyway.
   */
  it('treats a zone with no slash as its own region', () => {
    expect(regionOf('UTC')).toBe('UTC');
  });

  it('puts UTC first, because it is the answer that is never wrong', () => {
    expect(timezoneRegions()[0]).toBe('UTC');
  });
});

describe('cityOf — the part a person recognises', () => {
  it('drops the region and the underscores', () => {
    expect(cityOf('America/New_York')).toBe('New York');
  });

  it('keeps a nested zone readable rather than truncating it', () => {
    expect(cityOf('America/Indiana/Vevay')).toBe('Indiana / Vevay');
  });

  it('leaves UTC alone', () => {
    expect(cityOf('UTC')).toBe('UTC');
  });
});

describe('offsets come from the tz database, not from us', () => {
  it('labels a known zone with its offset', () => {
    expect(offsetLabel('Africa/Lagos')).toMatch(/^\(GMT[+-]\d/);
  });

  it('writes zero as GMT+0 rather than a bare GMT', () => {
    expect(offsetLabel('UTC')).toBe('(GMT+0)');
  });

  /*
   * Daylight saving is the reason the offset is computed per render instead of
   * stored. London is GMT+0 in January and GMT+1 in July; a frozen label is
   * wrong for half the year.
   */
  it('follows daylight saving rather than freezing one answer', () => {
    const winter = offsetLabel('Europe/London', new Date('2026-01-15T12:00:00Z'));
    const summer = offsetLabel('Europe/London', new Date('2026-07-15T12:00:00Z'));
    expect(winter).not.toBe(summer);
  });

  it('survives a zone the runtime rejects instead of throwing the list away', () => {
    expect(offsetLabel('Not/AZone')).toBe('');
    expect(zoneLabel('Not/AZone')).toBe('AZone');
  });
});

describe('zonesInRegion', () => {
  it('returns only that region, sorted by the readable part', () => {
    const african = zonesInRegion('Africa');
    expect(african.every((z) => z.startsWith('Africa/'))).toBe(true);
    expect(african).toContain('Africa/Lagos');
    expect([...african]).toEqual([...african].sort((a, b) => cityOf(a).localeCompare(cityOf(b))));
  });

  it('handles UTC, which has no members under a slash', () => {
    expect(zonesInRegion('UTC')).toEqual([]);
  });
});

describe('guessTimezone and the zone that is not on the list', () => {
  /*
   * `supportedValuesOf` omits the legacy `Etc/*` aliases; `resolvedOptions()`
   * returns them anyway. The machine this was written on reports `Etc/GMT-1`,
   * which is how this was found: a select whose value is absent from its own
   * options renders blank, and the first interaction rewrites the brand's zone
   * to whatever happens to be first.
   */
  it('can return a zone the enumerated list does not contain', () => {
    // Asserting the hazard exists, not that this machine has it.
    expect(allTimezones()).not.toContain('Etc/GMT-1');
  });

  it('zonesIncluding makes the stored value selectable whatever it is', () => {
    expect(zonesIncluding('Etc/GMT-1')).toContain('Etc/GMT-1');
    expect(zonesIncluding(guessTimezone())).toContain(guessTimezone());
  });

  it('does not duplicate a value that is already enumerated', () => {
    const zones = zonesIncluding('Africa/Lagos');
    expect(zones.filter((z) => z === 'Africa/Lagos')).toHaveLength(1);
  });

  it('does not invent a zone when nothing is stored yet', () => {
    expect(zonesIncluding(undefined)).toEqual(allTimezones());
  });

  /*
   * Not normalised to UTC: POSIX inverts the sign in `Etc/GMT-1`, so it is
   * UTC+1. Collapsing it would move every scheduled post by an hour.
   */
  it('keeps a legacy alias at its real offset rather than folding it into UTC', () => {
    expect(offsetLabel('Etc/GMT-1')).toBe('(GMT+1)');
  });
});
