/**
 * The plan a visitor chose on `AUTH-01`, carried to where an org exists to apply
 * it to.
 *
 * ── Why not a query parameter ─────────────────────────────────────────────
 *
 * §8.1 lists the selected plan as an input to authentication, and the distance
 * between choosing it and being able to use it is four navigations: pricing →
 * sign-up → email verification → Clerk's organization task → the app shell,
 * where `OrgGuard` finally creates the org. Two of those hops are Clerk's own
 * and neither preserves our query string, so a `?plan=` threaded through would
 * be silently dropped somewhere in the middle — which is worse than not having
 * it, because it would look like it worked.
 *
 * `sessionStorage` survives exactly the right amount: the tab, and no longer. A
 * plan chosen in one tab does not leak into another person's session on a shared
 * machine, and an abandoned signup does not apply a plan to an account created
 * next week.
 *
 * ── This is a preference, not an entitlement ──────────────────────────────
 *
 * Nothing here grants anything. The value is validated against
 * `org.billing.plan.set`'s own enum server-side, and the tool is scoped to
 * owner/admin like every other org write — so a hand-edited value selects a plan
 * the org is then billed for in the ordinary way, exactly as if it had been
 * picked in settings.
 */

const KEY = 'spark.selectedPlan';

/** The three plans `org.billing.plan.set` accepts (`packages/agency/src/org.ts`). */
const PLANS = ['starter', 'growth', 'agency'] as const;
export type SelectedPlan = (typeof PLANS)[number];

function isPlan(value: string | null): value is SelectedPlan {
  return value !== null && (PLANS as readonly string[]).includes(value);
}

/**
 * Stash the `?plan=` on the current URL. Ignores anything unrecognised.
 *
 * Reads `window.location` rather than taking the value from
 * `useSearchParams()`. That hook opts a page out of static prerendering unless
 * it is wrapped in a Suspense boundary, and sign-up is prerendered — using it
 * broke `next build` outright. Since this only ever runs in an effect, the
 * browser's own URL is available and needs no hook at all.
 */
export function rememberSelectedPlan(): void {
  if (typeof window === 'undefined') return;
  const raw = new URLSearchParams(window.location.search).get('plan');
  if (!isPlan(raw)) return;
  try {
    window.sessionStorage.setItem(KEY, raw);
  } catch {
    // Private browsing and storage-blocked contexts throw. The plan is a
    // preference, so losing it costs one visit to settings — not worth failing
    // a signup over.
  }
}

/** Reads and clears it — applying a plan is a one-time act, so it must not replay. */
export function takeSelectedPlan(): SelectedPlan | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const value = window.sessionStorage.getItem(KEY);
    if (!isPlan(value)) return undefined;
    window.sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return undefined;
  }
}
