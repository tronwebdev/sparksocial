import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POSTING_WINDOWS,
  postingSlotAt,
  zoneOffsetMinutes,
  zonedTimeToUtc,
  zonedYmd,
} from '../src/time.js';

/**
 * The three bugs this module exists to fix, asserted as behaviour:
 *
 *   1. Every post in a campaign fired at whatever instant the campaign was
 *      created, in UTC.
 *   2. Two posts on the same day got byte-identical timestamps.
 *   3. Day-0 slots were already in the past by the next scheduler tick.
 *
 * Each has a test below that fails if it comes back.
 */

describe('zoneOffsetMinutes', () => {
  it('is zero for UTC', () => {
    expect(zoneOffsetMinutes(new Date('2026-08-20T12:00:00Z'), 'UTC')).toBe(0);
  });

  it('follows the zone across a DST boundary rather than assuming a fixed offset', () => {
    // London is +60 in August and 0 in January. A fixed-offset implementation
    // gets one of these wrong, and it is the one that moves every posting time
    // by an hour for half the year.
    expect(zoneOffsetMinutes(new Date('2026-08-20T12:00:00Z'), 'Europe/London')).toBe(60);
    expect(zoneOffsetMinutes(new Date('2026-01-20T12:00:00Z'), 'Europe/London')).toBe(0);
  });

  it('handles a zone behind UTC', () => {
    expect(zoneOffsetMinutes(new Date('2026-08-20T12:00:00Z'), 'America/New_York')).toBe(-240);
  });

  it('handles a half-hour zone, which a naive hours-only implementation cannot', () => {
    expect(zoneOffsetMinutes(new Date('2026-08-20T12:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });

  it('falls back to UTC for an unknown zone rather than throwing', () => {
    // A bad zone name is a data problem. Failing a publish over it would be a
    // worse outcome than posting at the wrong hour.
    expect(zoneOffsetMinutes(new Date('2026-08-20T12:00:00Z'), 'Mars/Olympus_Mons')).toBe(0);
  });
});

describe('zonedYmd', () => {
  it('reports the local calendar date, not the UTC one', () => {
    // 23:30 UTC is already the next day in Sydney. This is why `dayOffset` is
    // counted in the brand's zone: otherwise a campaign starting late in the
    // evening has its day 0 and day 1 land on the same local date.
    expect(zonedYmd(new Date('2026-08-20T23:30:00Z'), 'Australia/Sydney')).toEqual({
      year: 2026,
      month: 8,
      day: 21,
    });
    expect(zonedYmd(new Date('2026-08-20T23:30:00Z'), 'UTC')).toEqual({ year: 2026, month: 8, day: 20 });
  });
});

describe('zonedTimeToUtc', () => {
  it('resolves a local wall-clock time to the right instant', () => {
    // 09:00 in London in August is 08:00 UTC.
    expect(zonedTimeToUtc({ year: 2026, month: 8, day: 20 }, { hour: 9 }, 'Europe/London').toISOString()).toBe(
      '2026-08-20T08:00:00.000Z',
    );
  });

  it('gets the hour right on both sides of a DST transition', () => {
    // The whole reason the offset is resolved twice. With a single pass, one of
    // these lands an hour out — a 09:00 slot posting at 08:00 for half the year.
    expect(zonedTimeToUtc({ year: 2026, month: 1, day: 20 }, { hour: 9 }, 'Europe/London').toISOString()).toBe(
      '2026-01-20T09:00:00.000Z',
    );
    expect(zonedTimeToUtc({ year: 2026, month: 7, day: 20 }, { hour: 9 }, 'Europe/London').toISOString()).toBe(
      '2026-07-20T08:00:00.000Z',
    );
  });
});

describe('postingSlotAt', () => {
  const startAt = new Date('2026-08-20T03:47:11Z'); // a deliberately awkward creation time

  it('ignores the campaign creation time and uses a posting window', () => {
    // Bug 1. `scheduledAt = addDays(startAt, n)` meant a campaign created at
    // 03:47 posted at 03:47 every day for a month.
    const slot = postingSlotAt({ dayOffset: 1, indexWithinDay: 0, startAt, timeZone: 'UTC' });
    expect(slot.toISOString()).toBe('2026-08-21T09:00:00.000Z');
    expect(slot.getUTCMinutes()).not.toBe(47);
  });

  it('never gives two posts on one day the same instant', () => {
    // Bug 2. Normal as soon as a month's post count exceeds its window in days.
    const slots = [0, 1, 2, 3, 4].map((indexWithinDay) =>
      postingSlotAt({ dayOffset: 3, indexWithinDay, startAt, timeZone: 'UTC' }).toISOString(),
    );
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('walks the configured windows in order before repeating one', () => {
    const [a, b, c, d] = [0, 1, 2, 3].map((i) =>
      postingSlotAt({ dayOffset: 0, indexWithinDay: i, startAt, timeZone: 'UTC', postingWindows: [8, 12, 17] }),
    );
    expect([a!.getUTCHours(), b!.getUTCHours(), c!.getUTCHours()]).toEqual([8, 12, 17]);
    // The fourth reuses the first window, pushed a few minutes later.
    expect(d!.getUTCHours()).toBe(8);
    expect(d!.getTime()).toBeGreaterThan(a!.getTime());
  });

  it('rolls a slot forward past notBefore instead of placing it in the past', () => {
    // Bug 3, and the whole day-0 fix. A campaign activated at 14:00 must not
    // have its 09:00 slot land five hours ago and publish on the next tick.
    const activatedAt = new Date('2026-08-20T14:00:00Z');
    const slot = postingSlotAt({
      dayOffset: 0,
      indexWithinDay: 0,
      startAt: activatedAt,
      timeZone: 'UTC',
      postingWindows: [9, 13, 18],
      notBefore: activatedAt,
    });
    expect(slot.getTime()).toBeGreaterThan(activatedAt.getTime());
    expect(slot.toISOString()).toBe('2026-08-20T18:00:00.000Z');
  });

  it('rolls into the next day when every window today has passed', () => {
    const activatedAt = new Date('2026-08-20T23:00:00Z');
    const slot = postingSlotAt({
      dayOffset: 0,
      indexWithinDay: 0,
      startAt: activatedAt,
      timeZone: 'UTC',
      postingWindows: [9, 13, 18],
      notBefore: activatedAt,
    });
    expect(slot.toISOString()).toBe('2026-08-21T09:00:00.000Z');
  });

  it('places in the brand’s own local time, not UTC', () => {
    const slot = postingSlotAt({
      dayOffset: 0,
      indexWithinDay: 0,
      startAt: new Date('2026-08-20T15:00:00Z'),
      timeZone: 'America/New_York',
      postingWindows: [9],
    });
    // 09:00 New York in August is 13:00 UTC.
    expect(slot.toISOString()).toBe('2026-08-20T13:00:00.000Z');
  });

  it('counts day 0 as the local day, which is not always the UTC one', () => {
    // 00:30 UTC is still the *previous* evening in New York, so day 0 is the
    // 19th there. Counting days in UTC instead would put day 0 and day 1 of a
    // late-evening campaign on the same local date — the reason `zonedYmd`
    // exists rather than reading `startAt`'s UTC date directly.
    const slot = postingSlotAt({
      dayOffset: 0,
      indexWithinDay: 0,
      startAt: new Date('2026-08-20T00:30:00Z'),
      timeZone: 'America/New_York',
      postingWindows: [9],
    });
    expect(slot.toISOString()).toBe('2026-08-19T13:00:00.000Z');
  });

  it('is deterministic — the same inputs give the same instant', () => {
    // Step 4 is a review loop: the user nudges the mix and regenerates. A
    // calendar that reshuffled its *times* on every pass would make the change
    // impossible to judge.
    const args = { dayOffset: 5, indexWithinDay: 1, startAt, timeZone: 'Europe/Berlin' } as const;
    expect(postingSlotAt(args).toISOString()).toBe(postingSlotAt(args).toISOString());
  });

  it('falls back to the default spread, and ignores nonsense hours', () => {
    const withJunk = postingSlotAt({
      dayOffset: 0,
      indexWithinDay: 0,
      startAt,
      timeZone: 'UTC',
      postingWindows: [47, -3, 9.5],
    });
    // Every supplied hour is out of range or non-integer, so the default applies.
    expect(withJunk.getUTCHours()).toBe(DEFAULT_POSTING_WINDOWS[0]);
  });

  it('de-duplicates and sorts supplied windows', () => {
    const first = postingSlotAt({
      dayOffset: 0,
      indexWithinDay: 0,
      startAt,
      timeZone: 'UTC',
      postingWindows: [18, 9, 9],
    });
    expect(first.getUTCHours()).toBe(9);
  });
});
