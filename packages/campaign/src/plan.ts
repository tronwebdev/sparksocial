import type { ContentPillar, Genome, Objective } from '@sparksocial/shared';
import { deriveMix, resolve, type AssetInventory, type ResolvedPlaybook } from '@sparksocial/playbooks';

/**
 * CAMPAIGN PLANNING — engine spec §6.8, Steps 2 and 3.
 *
 *   Step 2  *"SPARK proposes the plan — volume, platforms, mix, and the
 *           reasoning. Not a form."*
 *   Step 3  *"Gap report + capture plan: '9 posts now, 24 if you film 6 minutes,
 *           one sitting.' Stating the reasoning, exposing the gap honestly, and
 *           quantifying human effort is what converts."*
 *
 * Both steps come out of one calculation, so they live in one function. The
 * honesty in Step 3 is not a copywriting choice — it is what the numbers
 * actually are. Every playbook the resolver marks `unlockable` is one this brand
 * *cannot* make today, and saying "24 posts" without saying "if you film" would
 * be the lie the whole product is trying not to tell.
 *
 * Pure. Takes a genome and an inventory, returns a plan. Persistence and
 * calendar placement are separate concerns and separate steps.
 *
 * Nothing here branches on niche or category (invariant 5): volume comes from
 * the window, the split comes from the mix engine, and what is buildable comes
 * from the Asset Graph.
 */

/** §6.3's weekly sitting. Capture effort is quoted in these units, never as a total. */
const SESSION_BUDGET_SEC = 5 * 60;

/**
 * Posts per week. Deliberately a small band: the failure mode for a local
 * business is an ambitious cadence abandoned in week two, and the plan §11 note
 * that the capture loop is "most likely to be underestimated" applies to how
 * much filming a plan implicitly asks for.
 */
const POSTS_PER_WEEK = 3;

/**
 * How many times one format can run inside a 30-day window before the account
 * starts to look like a template.
 *
 * This is what makes the Step 3 gap a real number rather than a slogan. Volume
 * is not limited by the calendar — there are always more days — it is limited
 * by *variety*: a brand with two usable formats cannot fill twelve slots
 * without repeating itself into exactly the "reads as automated" failure the
 * retrieval penalties and the mix ceiling both exist to prevent.
 *
 * Keyed off `saturation_risk`, which every playbook already declares, so this
 * stays data-driven — a new playbook sets its own reuse budget and no code
 * changes (invariant 5).
 */
const RUNS_PER_WINDOW: Record<'low' | 'medium' | 'high', number> = {
  low: 4,
  medium: 2,
  // A format the spec flags as high-saturation is one that wears out fast:
  // once per window, or it becomes the thing people scroll past.
  high: 1,
};

/** Reference window the reuse budgets above are quoted against. */
const SATURATION_WINDOW_DAYS = 30;

export interface CampaignPlanArgs {
  genome: Genome;
  inventory: AssetInventory;
  objective: Objective;
  /** Campaign length. 30 days is the §12 exit criterion's shape, not a hard rule. */
  windowDays: number;
}

export interface PlannedSlot {
  pillar: ContentPillar;
  count: number;
}

export interface CaptureAsk {
  /** Playbooks unlocked by filming, best-scoring first. */
  playbookIds: string[];
  /** Asset roles the brand does not have yet, deduped. */
  missingRoles: string[];
  /** Weekly sittings implied, at §6.3's five-minute budget. Never a raw total. */
  sittings: number;
  minutesPerSitting: number;
}

export interface CampaignPlan {
  objective: Objective;
  windowDays: number;
  /** What can be posted with the Asset Graph as it stands today. */
  buildableNow: number;
  /** What the same window supports once the capture asks are filmed. */
  potentialWithCapture: number;
  mix: PlannedSlot[];
  mixSource: 'cold_start' | 'learned';
  mixWhy: string;
  capture: CaptureAsk | null;
  /** Playbook ids usable today, best-scoring first — the calendar's raw material. */
  readyPlaybookIds: string[];
}

export function planCampaign(args: CampaignPlanArgs): CampaignPlan {
  const { genome, inventory, objective, windowDays } = args;

  const { ranked } = resolve(genome, inventory);
  const mix = deriveMix(genome);

  // A campaign has its own objective, which need not be the genome's standing
  // one — "fill quiet days" this month, "book calls" next. Re-ranking on the
  // campaign's objective is the difference between a plan and a template.
  const forObjective = [...ranked].sort(
    (a, b) => objectiveFit(b.playbook, objective) - objectiveFit(a.playbook, objective),
  );

  const ready = forObjective.filter((r) => !r.unlockable);
  const unlockable = forObjective.filter((r) => r.unlockable);

  const slots = Math.max(1, Math.round((windowDays / 7) * POSTS_PER_WEEK));

  // Volume is capped by what can actually be made without repeating, not by the
  // calendar. This is where the Step 3 gap comes from: `buildableNow` counts
  // only formats whose assets exist, `potentialWithCapture` counts those plus
  // the ones filming would unlock, and both are bounded by the same cadence.
  const buildableNow = Math.min(slots, capacity(ready, windowDays));
  const potentialWithCapture = Math.min(slots, capacity([...ready, ...unlockable], windowDays));

  return {
    objective,
    windowDays,
    buildableNow,
    potentialWithCapture,
    // The mix describes the plan the user is being offered, so it is sized to
    // what that plan will actually contain, not to the unconstrained cadence.
    mix: distribute(potentialWithCapture, mix.weights),
    mixSource: mix.source,
    mixWhy: mix.why,
    // Only ask for filming when filming actually buys something. A brand whose
    // existing formats already fill the cadence gains no posts by shooting more,
    // and asking anyway trades the owner's Saturday for nothing — which is the
    // fastest way to make them stop trusting the asks that do matter.
    capture: potentialWithCapture > buildableNow ? buildCaptureAsk(unlockable) : null,
    readyPlaybookIds: ready.map((r) => r.playbook.playbook_id),
  };
}

/**
 * Largest-remainder distribution of slots across pillars.
 *
 * Naive rounding loses or invents slots — five pillars at 0.5 rounding each is a
 * plan that promises twelve posts and schedules ten. The remainder pass makes
 * the parts sum to the whole, which matters because the user reviews the
 * calendar at mix level (Step 4) and a mix that does not add up is the first
 * thing they will notice.
 */
export function distribute(
  total: number,
  weights: Record<ContentPillar, number>,
): PlannedSlot[] {
  const entries = Object.entries(weights) as Array<[ContentPillar, number]>;
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  if (sum <= 0 || total <= 0) return entries.map(([pillar]) => ({ pillar, count: 0 }));

  const exact = entries.map(([pillar, w]) => ({ pillar, exact: (w / sum) * total }));
  const out = exact.map((e) => ({ pillar: e.pillar, count: Math.floor(e.exact) }));

  let remaining = total - out.reduce((s, o) => s + o.count, 0);
  const byRemainder = [...exact]
    .map((e, i) => ({ i, frac: e.exact - Math.floor(e.exact) }))
    .sort((a, b) => b.frac - a.frac);

  for (const { i } of byRemainder) {
    if (remaining <= 0) break;
    out[i]!.count += 1;
    remaining -= 1;
  }
  return out;
}

/**
 * The Step 3 ask, phrased the way §6.3 requires: **sittings, not a total**.
 *
 * "Film for 18 minutes" reads as a project and gets deferred. "Four five-minute
 * sittings, one a week" reads as a habit — and it is also what actually happens,
 * because `direct.session.batch` bundles briefs into exactly that shape.
 */
function buildCaptureAsk(unlockable: ResolvedPlaybook[]): CaptureAsk | null {
  if (unlockable.length === 0) return null;

  const missingRoles = [...new Set(unlockable.flatMap((r) => r.missingRoles))];

  return {
    playbookIds: unlockable.map((r) => r.playbook.playbook_id),
    missingRoles,
    // One sitting per unlockable playbook is the honest upper bound: a sitting
    // holds 3–5 briefs, but briefs for different formats rarely share a setup.
    sittings: Math.max(1, Math.ceil(unlockable.length / 3)),
    minutesPerSitting: SESSION_BUDGET_SEC / 60,
  };
}

/**
 * How many non-repetitive posts a set of formats can carry over the window.
 *
 * Scaled from the 30-day reference so a 7-day campaign does not inherit a
 * month's worth of reuse budget — the point of the budget is spacing, and
 * spacing is a property of time, not of post count.
 */
export function capacity(
  playbooks: Array<{ playbook: { saturation_risk: 'low' | 'medium' | 'high' } }>,
  windowDays: number,
): number {
  const scale = windowDays / SATURATION_WINDOW_DAYS;
  const total = playbooks.reduce((sum, r) => sum + RUNS_PER_WINDOW[r.playbook.saturation_risk] * scale, 0);
  // Floor, not round: promising a post the variety cannot support is the
  // overstatement Step 3 exists to avoid.
  return Math.floor(total);
}

/** Missing entries mean "not tuned for this objective", which is 0, not neutral. */
function objectiveFit(playbook: { objective_fit: Partial<Record<Objective, number>> }, objective: Objective): number {
  return playbook.objective_fit[objective] ?? 0;
}
