import type { CampaignType, CampaignWeight, EngagementRung } from '@sparksocial/shared';

/**
 * The wizard's working copy, and the one place the prototype's vocabulary is
 * reconciled with the engine's.
 *
 * ── Goals: four cards, six objectives ─────────────────────────────────────
 *
 * The prototype's step 1 offers four goals; `Objective` in `@sparksocial/shared`
 * has six values, and they are not the same four. "Increase Website Traffic"
 * and "Build Authority & Trust" both land on `audience` — clicks to a page and
 * reputation are the same objective to the planner and different *shapes of
 * content*, which is what the campaign type carries.
 *
 * So the card is stored, not the objective: two cards can write one objective
 * and still come back selected correctly, and each card also carries the type
 * it preselects on step 2. `bookings`, `trials` and `hiring` have no card — the
 * wizard offers them beneath the panel rather than dropping three objectives
 * the engine supports because a four-card grid had no room for them.
 */
export interface GoalCard {
  key: string;
  title: string;
  desc: string;
  objective: string;
  /** The type step 2 preselects when this goal is chosen. */
  type: CampaignType;
}

export const GOAL_CARDS: readonly GoalCard[] = [
  {
    key: 'leads',
    title: 'Get Leads',
    desc: 'Capture emails, signups or enquiries',
    objective: 'leads',
    type: 'lead_magnet',
  },
  {
    key: 'sales',
    title: 'Drive Sales/Bookings',
    desc: 'Push offers, demos or paid actions',
    objective: 'sales',
    type: 'promotion',
  },
  {
    key: 'traffic',
    title: 'Increase Website Traffic',
    desc: 'Drive clicks to pages or content',
    objective: 'audience',
    type: 'promotion',
  },
  {
    key: 'authority',
    title: 'Build Authority & Trust',
    desc: 'Educate and position your brand',
    objective: 'audience',
    type: 'authority',
  },
];

/** The objectives the prototype's four cards leave unreachable. */
export const EXTRA_OBJECTIVES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'bookings', label: 'More bookings' },
  { value: 'trials', label: 'More sign-ups' },
  { value: 'hiring', label: 'Hiring' },
];

/** The prototype's four type cards, in its own words. */
export const TYPE_CARDS: ReadonlyArray<{ value: CampaignType; title: string; desc: string }> = [
  { value: 'promotion', title: 'Promotion / Offers', desc: 'Direct benefits, urgency and clear calls to action' },
  { value: 'lead_magnet', title: 'Lead Magnet', desc: 'Educational content with opt-in focus' },
  { value: 'authority', title: 'Authority / Education', desc: 'Teach, explain and build credibility' },
  { value: 'launch', title: 'Launch / Announcement', desc: 'Short term visibility burst' },
];

/**
 * The prototype's duration control cycles three labels; the engine takes days.
 * The order is the order the control cycles in.
 */
export const DURATIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: '7 Days' },
  { days: 14, label: '14 Days' },
  { days: 30, label: '30 Days' },
];

/**
 * The frequency slider's three stops.
 *
 * `fill` is the width of the coloured track in the design — 39 / 191 / 382 on a
 * 382 track. Note the first stop is not zero and the last is the full width, so
 * the control reads as "some / half / all" rather than a linear scale.
 */
export const WEIGHT_STOPS: ReadonlyArray<{ value: CampaignWeight; label: string; fill: number; labelX: number }> = [
  { value: 'light', label: 'Light', fill: 39, labelX: 0 },
  { value: 'balanced', label: 'Balanced', fill: 191, labelX: 161 },
  { value: 'dominant', label: 'Dominant', fill: 382, labelX: 319 },
];

/** The engagement ladder, in the prototype's labels and geometry. */
export const RUNG_CARDS: ReadonlyArray<{ value: EngagementRung; title: string; desc: string }> = [
  { value: 'observe', title: 'Observe Only', desc: 'Read and categorize messages' },
  { value: 'suggest', title: 'Suggest Replies', desc: 'Draft replies for approval' },
  { value: 'auto_reply', title: 'Auto Reply (Safe)', desc: 'Handles simple conversations' },
  { value: 'sales_assist', title: 'Sales Assist', desc: 'Qualifies leads in DMs' },
];

/**
 * The approval ladder as the prototype's three cumulative switches.
 *
 * `approvalMode` has three values and the design has three switches, but they
 * are not a one-to-one map: the switches read as "does it draft / does it
 * schedule / does it publish", which is a ladder, not three independent
 * settings. Drafting is the floor — a campaign that drafts nothing is not a
 * campaign — so that switch is always on, and the other two climb from it.
 */
export function ladderFromMode(mode: string): { draft: boolean; schedule: boolean; auto: boolean } {
  return {
    draft: true,
    schedule: mode !== 'review_everything',
    auto: mode === 'autopublish',
  };
}

export const modeFromLadder = (schedule: boolean, auto: boolean): string =>
  auto ? 'autopublish' : schedule ? 'review_first_week' : 'review_everything';
