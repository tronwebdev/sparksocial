import type { Genome } from './genome.js';

/**
 * GENOME REQUIREMENTS — the facts a playbook needs the brand to have *said*.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * A playbook's `preconditions` covered everything the brand needed to *own* —
 * asset roles, a minimum count, capture capability, filmable talent, a likeness
 * licence — and nothing it needed to have *told us*. Fourteen of the playbooks
 * source their `cta` beat from `genome:offer.primary_cta`, and not one of them
 * declared that as a precondition, because there was no field to declare it in.
 *
 * The consequence was a campaign that looked fine and was not. The resolver
 * ranked all fourteen as `ready`, `planCampaign` counted them into
 * `buildableNow`, the calendar placed nine posts across a month, and the failure
 * arrived when somebody clicked one: *"The genome has no value at
 * offer.primary_cta"* — thrown by `planBeat`, three screens and one week after
 * the decision that caused it.
 *
 * ── Why the requirement is derived and not authored ───────────────────────
 *
 * The list of paths a playbook needs is already written down: it is the `genome:`
 * beat sources in the record. Adding a parallel `required_genome_paths` field
 * would mean two lists that must agree, and the failure mode of two such lists
 * is silence — a new playbook whose author fills in the beats and forgets the
 * preconditions is exactly the state all fourteen were already in. So the
 * requirement is computed from the beats, and a guard test asserts the resolver's
 * `ready` set can never reach `planBeat`'s throw.
 *
 * This file holds only the *words*: a dotted path is a schema location, and
 * "offer.primary_cta" is not something to put in front of a business owner.
 */

/**
 * How to talk about one missing genome fact.
 *
 * `fixWith` names a screen rather than a tool, because the thing a person needs
 * is somewhere to go. A message that says which field is empty and not where to
 * fill it in is a better error and still a dead end.
 */
export interface GenomeRequirement {
  /** What it is, in the brand's language. */
  label: string;
  /** What SPARK does with it, so the request does not read as bureaucracy. */
  hint: string;
  /** Where it gets filled in. */
  fixWith: string;
}

const REQUIREMENTS: Record<string, GenomeRequirement> = {
  'offer.primary_cta': {
    label: 'a call to action',
    hint: 'The line that closes a post — "Book now", "DM for prices". Used word for word, never invented.',
    fixWith: 'Settings → Offer',
  },
};

/**
 * The words for a path, or a last-resort shape built from the path itself.
 *
 * A fallback rather than `undefined`, because a playbook author adding a new
 * `genome:` beat must not be able to produce a screen that says nothing. The
 * generated wording is poor on purpose — it is legible enough to act on and
 * obviously unfinished, which is the signal that this map needs a line.
 */
export function genomeRequirement(path: string): GenomeRequirement {
  return (
    REQUIREMENTS[path] ?? {
      label: path.split('.').pop()?.replace(/_/g, ' ') ?? path,
      hint: `Needed by some of your formats. Stored at ${path}.`,
      fixWith: 'Settings',
    }
  );
}

/** Every path this file has real words for — the guard test reads it. */
export const DESCRIBED_GENOME_PATHS: readonly string[] = Object.keys(REQUIREMENTS);

/**
 * "a call to action" · "a call to action and a price list" — for a sentence.
 *
 * Shares the shape of `assetRoleWordList` for the same reason that exists: these
 * end up mid-sentence in a `why`, and a bare comma-joined list of schema paths is
 * what this whole file is here to stop.
 */
export function genomeRequirementWordList(paths: readonly string[]): string {
  const labels = paths.map((p) => genomeRequirement(p).label);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/**
 * Dotted lookup into the genome, e.g. `offer.primary_cta`.
 *
 * Returns undefined for anything that is not a non-empty string: a beat renders
 * text, and an object or a number arriving here means the playbook points at the
 * wrong path. Silently stringifying it would put `[object Object]` on someone's
 * Instagram.
 *
 * ── Why this lives in `shared` and not next to its caller ─────────────────
 *
 * It was in `packages/assemble`, beside `planBeat`, which is the only place that
 * reads a beat's text. The resolver now has to answer the *same* question one
 * week earlier — "would this playbook find a value here?" — and a second
 * implementation of it would be a guard that agrees with the thing it guards
 * until the day it does not. `packages/playbooks` is built before
 * `packages/assemble`, so the shared copy is the only one both can reach.
 *
 * `assemble/plan.ts` re-exports it, so its own callers and tests are unchanged.
 */
export function readGenomePath(genome: Genome, path: string): string | undefined {
  let current: unknown = genome;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    // Own-property only: a path like `constructor.name` must not resolve.
    if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.trim() ? current : undefined;
}
