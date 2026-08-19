import { describe, expect, it } from 'vitest';
import { PLAYBOOKS, byId, type Playbook } from '@sparksocial/playbooks';
import type { ContentPillar } from '@sparksocial/shared';
import { interleave, placeCalendar } from '../src/calendar.js';
import type { PlannedSlot } from '../src/plan.js';

/**
 * §6.8 Step 4: *"Review the CALENDAR at mix level, not the posts. … If the user
 * has to open all 24 posts, the product failed."*
 *
 * That framing sets what matters here. The user judges this surface by
 * scanning a month, so the failures that count are the ones visible at a
 * glance: everything bunched into week one, one pillar running five days
 * straight, or the same format twice in a row.
 */

const START = new Date('2026-09-01T09:00:00.000Z');

const mix = (over: Partial<Record<ContentPillar, number>>): PlannedSlot[] =>
  (Object.entries(over) as Array<[ContentPillar, number]>).map(([pillar, count]) => ({ pillar, count }));

/** Real records, so the test exercises the library rather than invented shapes. */
const forPillar = (pillar: ContentPillar): Playbook[] =>
  PLAYBOOKS.filter((p) => p.content_pillar === pillar && p.mode === 'assemble');

describe('interleave', () => {
  it('emits exactly the demanded counts', () => {
    const out = interleave([
      { pillar: 'educational', remaining: 3 },
      { pillar: 'community', remaining: 2 },
    ]);
    expect(out).toHaveLength(5);
    expect(out.filter((p) => p === 'educational')).toHaveLength(3);
    expect(out.filter((p) => p === 'community')).toHaveLength(2);
  });

  it('never runs the same pillar twice in a row while another has demand', () => {
    // A month that opens with seven educational posts and closes with five
    // community ones is the right mix and reads like two different accounts.
    const out = interleave([
      { pillar: 'educational', remaining: 7 },
      { pillar: 'community', remaining: 5 },
      { pillar: 'proof', remaining: 2 },
    ]);
    for (let i = 1; i < out.length; i++) {
      const othersLeft = out.slice(i).some((p) => p !== out[i]);
      if (othersLeft) expect(out[i], `position ${i}`).not.toBe(out[i - 1]);
    }
  });

  it('repeats only when one pillar is all that is left', () => {
    const out = interleave([{ pillar: 'product', remaining: 3 }]);
    expect(out).toEqual(['product', 'product', 'product']);
  });

  it('is deterministic', () => {
    const demand = () => [
      { pillar: 'educational' as const, remaining: 4 },
      { pillar: 'proof' as const, remaining: 3 },
    ];
    expect(interleave(demand())).toEqual(interleave(demand()));
  });
});

describe('placeCalendar', () => {
  const playbooks = [...forPillar('educational'), ...forPillar('product'), ...forPillar('proof')];

  it('schedules every slot the mix asks for', () => {
    const { slots } = placeCalendar({
      mix: mix({ educational: 4, product: 3, proof: 2 }),
      playbooks,
      windowDays: 30,
      startAt: START,
    });
    expect(slots).toHaveLength(9);
  });

  it('spreads across the window rather than clumping in week one', () => {
    const { slots } = placeCalendar({
      mix: mix({ educational: 6, product: 3 }),
      playbooks,
      windowDays: 30,
      startAt: START,
    });

    const days = slots.map((s) => s.dayOffset);
    expect(Math.min(...days)).toBeLessThan(5);
    // The last post must land in the final stretch — otherwise the month goes
    // quiet after week two, which is the pattern owners cancel over.
    expect(Math.max(...days)).toBeGreaterThan(20);
    // Strictly non-decreasing: slots are emitted in date order.
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it('never schedules two slots outside the window', () => {
    const { slots } = placeCalendar({
      mix: mix({ educational: 12 }),
      playbooks,
      windowDays: 14,
      startAt: START,
    });
    for (const s of slots) {
      expect(s.dayOffset).toBeGreaterThanOrEqual(0);
      expect(s.dayOffset).toBeLessThanOrEqual(13);
    }
  });

  it('is deterministic, so a mix adjustment is judged against a stable calendar', () => {
    // Step 4 is a review loop. If regenerating reshuffled unrelated slots, the
    // user could not tell what their adjustment actually changed.
    const args = { mix: mix({ educational: 5, product: 3 }), playbooks, windowDays: 30, startAt: START };
    const a = placeCalendar(args);
    const b = placeCalendar(args);
    expect(a.slots).toEqual(b.slots);
  });

  it('caps promotional slots at the ceiling once unservable pillars fall away', () => {
    // `deriveMix` caps the weights, but dropping pillars no format can serve
    // shrinks the denominator and inflates what is left — a mix capped at 35%
    // reached 42% of the placed calendar. The ceiling is a property of the
    // posts people see, so it is re-applied here.
    const { slots } = placeCalendar({
      mix: mix({ product: 8, educational: 2, proof: 2 }),
      playbooks,
      windowDays: 30,
      startAt: START,
    });

    const product = slots.filter((s) => s.pillar === 'product').length;
    expect(product / slots.length).toBeLessThanOrEqual(0.35);
    // Total is preserved: the excess moves, it does not vanish.
    expect(slots).toHaveLength(12);
  });

  it('spreads the capped excess across pillars rather than dumping it on one', () => {
    // Handing every reclaimed slot to a single pillar trades one lopsided month
    // for another — the mix would satisfy the ceiling and still read wrong.
    const before = { educational: 2, proof: 2 };
    const { slots } = placeCalendar({
      mix: mix({ product: 10, ...before }),
      playbooks,
      windowDays: 30,
      startAt: START,
    });

    const gained = (pillar: ContentPillar) =>
      slots.filter((s) => s.pillar === pillar).length - before[pillar as 'educational' | 'proof'];

    expect(gained('educational')).toBeGreaterThan(0);
    expect(gained('proof')).toBeGreaterThan(0);
  });

  it('keeps an all-promotional month rather than an empty one when nothing else can be served', () => {
    // §6.5: the calendar must never go empty. If `product` is the only pillar
    // with a servable format, the cap yields rather than deleting the month.
    const { slots } = placeCalendar({
      mix: mix({ product: 6 }),
      playbooks: forPillar('product'),
      windowDays: 30,
      startAt: START,
    });
    expect(slots).toHaveLength(6);
  });

  it('reports pillars nothing can serve instead of silently reallocating them', () => {
    // The honest answer to "why is there no community post" is that no format
    // this brand can make is a community format.
    const { slots, unfilledPillars } = placeCalendar({
      mix: mix({ educational: 3, community: 4 }),
      playbooks: forPillar('educational'),
      windowDays: 30,
      startAt: START,
    });

    expect(slots).toHaveLength(3);
    expect(unfilledPillars).toEqual([{ pillar: 'community', count: 4 }]);
  });

  it('returns an empty calendar rather than throwing when nothing can be placed', () => {
    const { slots, unfilledPillars } = placeCalendar({
      mix: mix({ community: 5 }),
      playbooks: forPillar('educational'),
      windowDays: 30,
      startAt: START,
    });
    expect(slots).toEqual([]);
    expect(unfilledPillars).toEqual([{ pillar: 'community', count: 5 }]);
  });

  it('rotates through the available formats instead of repeating the best one', () => {
    // The bug this pins: spacing was treated as a preference, so whenever the
    // calendar was loose enough — four posts over thirty days against a
    // five-day floor — the top-ranked format cleared the floor every time and
    // the month ran it four times. Adjacent-only checking missed it, because
    // the repeats were eight days apart and still identical.
    const educational = forPillar('educational');
    if (educational.length < 2) return; // library too small to assert on

    const want = Math.min(4, educational.length);
    const { slots } = placeCalendar({
      mix: mix({ educational: want }),
      playbooks: educational,
      windowDays: 30,
      startAt: START,
    });

    const distinct = new Set(slots.map((s) => s.playbookId));
    expect(distinct.size, 'distinct formats used').toBe(want);
  });

  it('opens with the best-ranked format, then rotates', () => {
    // Variety must not cost relevance on the first post: never-used formats tie
    // and fall back to resolver order, so the strongest one still leads.
    const educational = forPillar('educational');
    if (educational.length < 2) return;

    const { slots } = placeCalendar({
      mix: mix({ educational: 3 }),
      playbooks: educational,
      windowDays: 30,
      startAt: START,
    });
    expect(slots[0]!.playbookId).toBe(educational[0]!.playbook_id);
  });

  it('reuses only when the pillar has a single format to give', () => {
    const one = forPillar('educational').slice(0, 1);
    const { slots } = placeCalendar({
      mix: mix({ educational: 3 }),
      playbooks: one,
      windowDays: 30,
      startAt: START,
    });
    // A hole in the calendar would be worse than a repeat here.
    expect(slots).toHaveLength(3);
    expect(new Set(slots.map((s) => s.playbookId)).size).toBe(1);
  });

  it('carries each playbook’s real mode through to the slot', () => {
    const { slots } = placeCalendar({
      mix: mix({ educational: 3 }),
      playbooks: forPillar('educational'),
      windowDays: 30,
      startAt: START,
    });
    for (const s of slots) {
      expect(s.mode).toBe(byId(s.playbookId)!.mode);
    }
  });

  it('dates are real dates offset from the start', () => {
    const { slots } = placeCalendar({
      mix: mix({ educational: 2 }),
      playbooks: forPillar('educational'),
      windowDays: 30,
      startAt: START,
    });
    for (const s of slots) {
      const expected = new Date(START);
      expected.setUTCDate(expected.getUTCDate() + s.dayOffset);
      expect(s.scheduledAt.toISOString()).toBe(expected.toISOString());
    }
  });
});
