/**
 * SALES ASSIST's shared vocabulary — `Settings WS EI Sales`.
 *
 * Lives in `shared` because two packages on opposite sides of the build order
 * need the same answer. `packages/agency` owns the settings tool that *writes*
 * the configuration; `packages/engage` owns the tools that *obey* it, and cannot
 * import from `agency` (see CLAUDE.md's build order). A brand whose settings
 * screen resolves a handoff one way while the opportunity tool resolves it
 * another is worse than no configuration at all — the screen would be telling
 * the owner something untrue.
 */

/** The design's three handoff destinations, in descending urgency. */
export type SalesHandoffDestination = 'crm_notify' | 'save_notify' | 'nurture_only';

export type SalesTemperature = 'hot' | 'warm' | 'cold';

export type SalesHandoffMap = Record<SalesTemperature, SalesHandoffDestination>;

const DESTINATIONS: readonly string[] = ['crm_notify', 'save_notify', 'nurture_only'];

/**
 * The handoff a brand gets before it chooses one.
 *
 * Mirrors the design's own defaults, and errs toward telling somebody: a hot
 * lead nobody hears about is the expensive failure, while a cold lead that
 * notifies is merely mildly annoying.
 */
export const DEFAULT_SALES_HANDOFF: SalesHandoffMap = {
  hot: 'crm_notify',
  warm: 'save_notify',
  cold: 'nurture_only',
};

/**
 * A stored handoff map is only honoured when it covers all three temperatures.
 *
 * A partial map is not a partial preference — it is a lead with no rule, and the
 * failure mode is silence, which is indistinguishable from a quiet week. So a
 * partial map falls back wholesale rather than being merged key-by-key with the
 * defaults, which would produce a configuration the owner never chose and cannot
 * see on their screen.
 */
export function isCompleteSalesHandoff(stored: Record<string, string> | undefined): boolean {
  if (!stored) return false;
  return (['hot', 'warm', 'cold'] as const).every((k) => DESTINATIONS.includes(stored[k] ?? ''));
}

/** The effective handoff map: this brand's own when complete and valid, else the default. */
export function resolveSalesHandoff(stored: Record<string, string> | undefined): SalesHandoffMap {
  // An unrecognised destination means a value predating this vocabulary or
  // written by hand. Falling back beats surfacing a destination nothing honours.
  if (!isCompleteSalesHandoff(stored)) return { ...DEFAULT_SALES_HANDOFF };
  return {
    hot: stored!['hot'] as SalesHandoffDestination,
    warm: stored!['warm'] as SalesHandoffDestination,
    cold: stored!['cold'] as SalesHandoffDestination,
  };
}

/**
 * Where a lead of this temperature should be routed, or undefined for "nowhere
 * automatic".
 *
 * `crm_notify` is the only destination that names an external target, and it
 * needs one: without a configured `salesDestination` there is nothing to route
 * *to*, and writing the literal string "crm_notify" into `opportunities.routed_to`
 * would look like a real destination in the UI while meaning nothing. So an
 * unconfigured destination returns undefined and the opportunity stays unrouted,
 * which is the honest state and is what the Sales Opportunities tab shows.
 *
 * `save_notify` and `nurture_only` are deliberately not auto-routed. Both mean
 * "keep it here", and the row already exists — routing it somewhere would be
 * inventing a destination the owner did not ask for.
 */
export function salesRouteFor(
  temperature: SalesTemperature,
  handoff: SalesHandoffMap,
  salesDestination: string | undefined,
): string | undefined {
  return handoff[temperature] === 'crm_notify' && salesDestination ? salesDestination : undefined;
}
