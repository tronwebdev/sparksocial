/**
 * Fixing a missing piece of setup where the person is, then carrying on.
 *
 * A tool that stops for missing setup — no call to action, no account on that
 * platform, no Canva, no consent — says what is missing in `error.requires`
 * (`packages/shared/src/setupRequirement.ts`). `invoke` hands that here; the
 * `SetupPromptHost` mounted once in `AppProviders` shows a small dialog for it;
 * and if the person fills it in, `invoke` runs the original call again. So a
 * draft from a trend that needs a CTA asks for the CTA, then writes the draft —
 * without leaving the trend for Settings and starting over.
 *
 * A module-level registry rather than React context because `invoke` is a plain
 * function called from everywhere, including outside components.
 */

import type { SetupRequirement } from '@sparksocial/shared';

type Resolver = (requirement: SetupRequirement) => Promise<boolean>;

let resolver: Resolver | null = null;

/** Called by `SetupPromptHost` on mount; the returned function unregisters it. */
export function registerSetupResolver(next: Resolver): () => void {
  resolver = next;
  return () => {
    if (resolver === next) resolver = null;
  };
}

/**
 * One dialog per requirement at a time. "Generate 3 drafts" fires three calls
 * that all stop on the same missing CTA; they share one question and all go
 * again once it is answered.
 */
const pending = new Map<string, Promise<boolean>>();

/** True when the requirement was met and the call is worth repeating. */
export function askToFix(requirement: SetupRequirement): Promise<boolean> {
  if (!resolver) return Promise.resolve(false);
  const key = JSON.stringify(requirement);
  const existing = pending.get(key);
  if (existing) return existing;
  const asked = resolver(requirement).finally(() => pending.delete(key));
  pending.set(key, asked);
  return asked;
}

/**
 * Whether the call in progress was started by a person just now.
 *
 * A dialog that opens out of a background read — a poll, a prefetch — would be
 * a question nobody asked. `userActivation.isActive` is true for a few seconds
 * after a click or key press; browsers without it are given the benefit of the
 * doubt, since setup refusals come from actions, not reads.
 */
export function startedByAPerson(): boolean {
  if (typeof navigator === 'undefined') return false;
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return activation ? activation.isActive : true;
}
