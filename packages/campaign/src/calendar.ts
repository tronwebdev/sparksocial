import { postingSlotAt, type ContentPillar, type GenerationMode } from '@sparksocial/shared';
import { PROMOTIONAL_CEILING, type Playbook } from '@sparksocial/playbooks';
import type { PlannedSlot } from './plan.js';

/**
 * CALENDAR PLACEMENT — engine spec §6.8 Step 4; PRD `CAL-01`→`CAL-06`.
 *
 *   *"Review the CALENDAR at mix level, not the posts. Slots labelled by type —
 *   Craft · Team · Offer · Community. … If the user has to open all 24 posts,
 *   the product failed."*
 *
 * Turns a plan's pillar counts into dated slots. Pure and deterministic: same
 * inputs, same calendar. That matters because Step 4 is a *review* loop — the
 * user says "less offer, more craft" and regenerates — and a calendar that
 * reshuffled unrelated slots on every regeneration would make the change
 * impossible to judge.
 *
 * Three properties the placement has to hold, all of them visible to a user
 * scanning a month view:
 *
 *   1. **Spread.** Posts are spaced across the window, not clumped in week one.
 *   2. **Pillar variety.** The same pillar does not run three days straight,
 *      even when it holds the largest share of the mix.
 *   3. **Format spacing.** One playbook does not reappear before its
 *      saturation risk says it may — the calendar-level counterpart of the
 *      reuse penalty in asset retrieval.
 */

export interface CalendarSlot {
  /** Day offset from the campaign start, 0-based. */
  dayOffset: number;
  scheduledAt: Date;
  pillar: ContentPillar;
  playbookId: string;
  mode: GenerationMode;
  /**
   * Which account this slot posts to (`CMP-01.4`).
   *
   * Resolved here, at placement, from the intersection of the campaign's chosen
   * accounts and the platforms the chosen format is actually for — a carousel
   * cannot go to a Shorts-only account however the campaign is configured.
   * Undefined when the campaign named no accounts, which keeps the previous
   * behaviour for every campaign created before `CMP-01.4` existed.
   */
  platform?: string;
}

export interface PlaceCalendarArgs {
  mix: PlannedSlot[];
  /** Ready playbooks, best-scoring first. Only these can be scheduled. */
  playbooks: Playbook[];
  windowDays: number;
  startAt: Date;
  /**
   * The brand's own zone (PRD §8.2, required at onboarding) and the local hours
   * it posts in (§8.7's "posting windows").
   *
   * Optional so that a caller with no brand row still gets a sane calendar, but
   * *not* absent in the product: `calendar.generate` reads both off `brands`.
   * Before these existed every slot inherited `startAt`'s time-of-day, so a
   * campaign created at 03:47 posted at 03:47 for a month and any two slots
   * sharing a day published on the same instant.
   */
  timeZone?: string;
  postingWindows?: number[];
  /**
   * `CMP-01.4`'s account selection, from `campaigns.platforms`.
   *
   * Slots are dealt round-robin across whichever of these the chosen format
   * supports, so a campaign targeting three accounts spreads across them rather
   * than sending everything to the first. Empty leaves `slot.platform` unset and
   * the scheduler's playbook fallback in charge.
   */
  platforms?: string[];
  /**
   * Nothing is placed before this instant — the day-0 fix.
   *
   * `dayOffset: 0` used to resolve to `startAt` exactly, so the moment a
   * campaign was created its opening slots were already due; the scheduler
   * picked them up on its next tick, found copy that nothing had written yet,
   * and marked the brand's whole first day `blocked`. Passing `now` here rolls
   * those slots forward to the next real posting window instead.
   */
  notBefore?: Date;
}

export interface PlacedCalendar {
  slots: CalendarSlot[];
  /**
   * Pillars the mix asked for that no ready playbook can serve. Reported rather
   * than silently reallocated: it is a real gap in the library for this brand,
   * and the honest answer to "why is there no community post" is that nothing
   * they can make is a community format.
   */
  unfilledPillars: Array<{ pillar: ContentPillar; count: number }>;
}

/** Minimum days between two runs of the same playbook, by saturation risk. */
const MIN_SPACING_DAYS: Record<Playbook['saturation_risk'], number> = {
  low: 5,
  medium: 10,
  // A high-saturation format that reappears inside three weeks is the one
  // people start scrolling past.
  high: 21,
};

export function placeCalendar(args: PlaceCalendarArgs): PlacedCalendar {
  const { mix, playbooks, windowDays, startAt } = args;

  const byPillar = new Map<ContentPillar, Playbook[]>();
  for (const p of playbooks) {
    const list = byPillar.get(p.content_pillar) ?? [];
    list.push(p);
    byPillar.set(p.content_pillar, list);
  }

  // Only ask for what can actually be served; the rest is reported, not faked.
  const unfilledPillars: PlacedCalendar['unfilledPillars'] = [];
  const demand: Array<{ pillar: ContentPillar; remaining: number }> = [];
  for (const slot of mix) {
    if (slot.count <= 0) continue;
    if (!byPillar.has(slot.pillar)) {
      unfilledPillars.push({ pillar: slot.pillar, count: slot.count });
      continue;
    }
    demand.push({ pillar: slot.pillar, remaining: slot.count });
  }

  capPromotionalDemand(demand);

  const total = demand.reduce((s, d) => s + d.remaining, 0);
  if (total === 0) return { slots: [], unfilledPillars };

  const order = interleave(demand);
  const lastUsedDay = new Map<string, number>();
  const slots: CalendarSlot[] = [];
  const timeZone = args.timeZone ?? 'UTC';
  /** How many slots already sit on each day, so two never share an instant. */
  const placedPerDay = new Map<number, number>();
  /** Per-playbook rotation through the campaign's eligible accounts. */
  const perPlatformCursor = new Map<string, number>();

  for (let i = 0; i < order.length; i++) {
    // Even spread. `(i + 0.5)` centres each post in its share of the window
    // rather than stacking the first on day 0 and the last on the final day.
    const dayOffset = Math.min(windowDays - 1, Math.floor(((i + 0.5) / total) * windowDays));
    const pillar = order[i]!;
    const chosen = pickPlaybook(byPillar.get(pillar)!, dayOffset, lastUsedDay);
    lastUsedDay.set(chosen.playbook_id, dayOffset);

    const indexWithinDay = placedPerDay.get(dayOffset) ?? 0;
    placedPerDay.set(dayOffset, indexWithinDay + 1);

    // Round-robin across the campaign's accounts that this format can serve.
    // `perPlatformCursor` is keyed by playbook, so two formats with different
    // platform support each rotate through their own eligible set rather than
    // sharing one counter and skewing the spread.
    const eligible = (args.platforms ?? []).filter((p) => chosen.output.platforms.includes(p));
    let platform: string | undefined;
    if (eligible.length) {
      const cursor = perPlatformCursor.get(chosen.playbook_id) ?? 0;
      platform = eligible[cursor % eligible.length];
      perPlatformCursor.set(chosen.playbook_id, cursor + 1);
    }

    slots.push({
      dayOffset,
      // A real local time of day, in the brand's zone, from the brand's own
      // posting windows — see `postingSlotAt`. Was `addDays(startAt, n)`, which
      // is why every post in a campaign used to fire at the minute the campaign
      // was created.
      scheduledAt: postingSlotAt({
        dayOffset,
        indexWithinDay,
        startAt,
        timeZone,
        ...(args.postingWindows ? { postingWindows: args.postingWindows } : {}),
        ...(args.notBefore ? { notBefore: args.notBefore } : {}),
      }),
      pillar,
      playbookId: chosen.playbook_id,
      mode: chosen.mode,
      ...(platform ? { platform } : {}),
    });
  }

  return { slots, unfilledPillars };
}

/**
 * Re-applies the promotional ceiling to the demand that will actually be placed.
 *
 * `deriveMix` already caps the *weights*, but that guarantee does not survive
 * to the calendar: pillars no ready format can serve are dropped above, which
 * shrinks the denominator and inflates everything left. A brand whose community
 * and proof formats are all unavailable can therefore end up 42% promotional
 * from a mix that was capped at 35% — and the ceiling exists precisely so an
 * account does not read as an advert, which is a property of the posts people
 * see, not of an intermediate weight vector.
 *
 * Excess promotional slots are given to the other pillars that *can* be served,
 * heaviest first. If nothing else can be served the cap is not applied: an
 * all-promotional month is bad, and an empty one is worse (§6.5).
 */
function capPromotionalDemand(demand: Array<{ pillar: ContentPillar; remaining: number }>): void {
  const total = demand.reduce((s, d) => s + d.remaining, 0);
  const promotional = demand.find((d) => d.pillar === 'product');
  if (!promotional || total === 0) return;

  const allowed = Math.floor(PROMOTIONAL_CEILING * total);
  if (promotional.remaining <= allowed) return;

  const others = demand.filter((d) => d.pillar !== 'product').sort((a, b) => b.remaining - a.remaining);
  if (others.length === 0) return;

  let excess = promotional.remaining - allowed;
  promotional.remaining = allowed;
  // Round-robin the excess so one pillar does not absorb all of it.
  for (let i = 0; excess > 0; i = (i + 1) % others.length) {
    others[i]!.remaining += 1;
    excess -= 1;
  }
}

/**
 * Round-robin across pillars, weighted by how much each still owes.
 *
 * Taking the pillar with the largest remaining demand each turn spaces the
 * heavy pillars out instead of emitting them in a block. A month that opens
 * with seven educational posts and closes with five community ones is
 * technically the right mix and reads, to the person scrolling it, like two
 * different accounts.
 */
export function interleave(demand: Array<{ pillar: ContentPillar; remaining: number }>): ContentPillar[] {
  const pool = demand.map((d) => ({ ...d }));
  const out: ContentPillar[] = [];
  let previous: ContentPillar | undefined;

  while (pool.some((d) => d.remaining > 0)) {
    // Prefer the neediest pillar that is not the one just emitted; fall back to
    // repeating only when it is the sole pillar with demand left.
    const candidates = pool.filter((d) => d.remaining > 0);
    const notPrevious = candidates.filter((d) => d.pillar !== previous);
    const pick = (notPrevious.length > 0 ? notPrevious : candidates).reduce((a, b) =>
      b.remaining > a.remaining ? b : a,
    );

    pick.remaining -= 1;
    out.push(pick.pillar);
    previous = pick.pillar;
  }
  return out;
}

/**
 * Which playbook fills this pillar slot.
 *
 * Spacing is a **floor, not a preference**. An earlier version took the first
 * rank-ordered candidate that satisfied its spacing window, which meant that
 * whenever the calendar was loose enough — four posts across thirty days, an
 * eight-day gap against a five-day floor — the top-ranked format satisfied it
 * every single time and the month ran the same playbook four times. That is the
 * calendar-level twin of "the same three photos every week", and it passes a
 * spacing check while failing the thing spacing exists to protect.
 *
 * So: filter to what the floor allows, then prefer the format used longest ago.
 * Never-used formats tie at the front and fall back to resolver rank, so the
 * best format still opens the month — it just does not own it.
 *
 * When nothing clears the floor the pool widens rather than the calendar
 * gaining a hole: the plan already promised this many posts, and `plan.ts`'s
 * capacity model is what keeps that case rare.
 */
function pickPlaybook(
  candidates: Playbook[],
  dayOffset: number,
  lastUsedDay: Map<string, number>,
): Playbook {
  const spaced = candidates.filter((p) => {
    const last = lastUsedDay.get(p.playbook_id);
    return last === undefined || dayOffset - last >= MIN_SPACING_DAYS[p.saturation_risk];
  });
  const pool = spaced.length > 0 ? spaced : candidates;

  // Strict `<` keeps the earlier (higher-ranked) entry on ties, which is what
  // makes never-used formats resolve in resolver order.
  return pool.reduce((best, p) =>
    (lastUsedDay.get(p.playbook_id) ?? -Infinity) < (lastUsedDay.get(best.playbook_id) ?? -Infinity) ? p : best,
  );
}
