import type { DraftCaptureBrief } from './schema.js';

/**
 * `direct.brief.validate` — engine spec §6.2, master plan §3.2 ("quality bar gate").
 *
 * A pure function, deliberately mirroring `packages/tools/src/policy.ts`: no I/O,
 * no clock, unit-tested against the spec's own worked examples. This is the gate
 * plan §11 calls out by name — *"Generated briefs must pass the validator before
 * send"* — and it is what stands between a business owner and being asked to film
 * something they can't act on without thinking.
 *
 * The spec's own contrast is the test oracle:
 *
 *   REJECT  "Post a video of your work today."
 *   PASS    "Film 20 seconds of the fade from behind the chair. Vertical. Don't
 *           talk — we'll add captions. Face a window. Keep the clippers in frame
 *           the whole time."
 *
 * What separates them isn't length for its own sake — it's that the good one
 * commits to a camera position, an orientation, and an explicit instruction not
 * to talk, none of which the bad one does. The checks below test for exactly
 * those commitments rather than a word-count minimum, so a terse but concrete
 * brief still passes and a padded-out vague one still fails.
 */

export interface ValidationResult {
  verdict: 'pass' | 'reject';
  /** Every reason a brief failed, not just the first — so a retry can fix them all at once. */
  reasons: string[];
}

/** Generic filler that commits to nothing. Any of these standing alone is a reject. */
const VAGUE_PHRASES = [
  /\byour work\b/i,
  /\bsomething good\b/i,
  /\ba video\b/i,
  /\bpost (something|content)\b/i,
  /\blook(s)? good\b/i,
  /\bwhatever you (like|want|feel)\b/i,
  /\bshowcase\b/i,
  /\bhighlight(s)?\b/i,
];

/** A field is concrete if it names a specific position, action, or constraint. */
function isVague(field: string): boolean {
  const trimmed = field.trim();
  if (trimmed.length < 8) return true;
  if (VAGUE_PHRASES.some((p) => p.test(trimmed))) return true;
  return false;
}

export interface ValidateOptions {
  /** From the playbook's `output.duration_sec` — a brief outside this range is off-format. */
  durationBoundsSec?: [number, number];
}

export function validateBrief(draft: DraftCaptureBrief, opts: ValidateOptions = {}): ValidationResult {
  const reasons: string[] = [];

  // 1 ── Every field the spec names must be present AND concrete. Schema-level
  //      presence is necessary but not sufficient — "video" is a present string.
  const concreteFields: Array<[keyof DraftCaptureBrief, string]> = [
    ['subject', 'subject'],
    ['framing', 'camera framing/position'],
    ['motion', 'camera motion'],
    ['audio', 'audio direction'],
    ['lighting', 'lighting direction'],
  ];
  for (const [key, label] of concreteFields) {
    const value = draft[key];
    if (typeof value === 'string' && isVague(value)) {
      reasons.push(`${label} is too vague to film without thinking: "${value}"`);
    }
  }

  // 2 ── do_not must carry real constraints, not an empty gesture.
  const doNots = draft.do_not.filter((d) => d.trim().length >= 4);
  if (doNots.length === 0) {
    reasons.push('do_not list has no concrete constraints');
  }

  // 3 ── Duration must fit what the playbook actually asked for, when known.
  if (opts.durationBoundsSec) {
    const [min, max] = opts.durationBoundsSec;
    if (draft.duration_sec < min || draft.duration_sec > max) {
      reasons.push(`duration_sec ${draft.duration_sec} is outside the playbook's ${min}-${max}s range`);
    }
  }

  // 4 ── Effort must be physically plausible: filming takes at least as long as
  //      the requested clip, and §6.3's weekly session budgets ~60-90s per brief.
  if (draft.estimated_effort_sec < draft.duration_sec) {
    reasons.push('estimated_effort_sec is shorter than the clip itself');
  }

  return reasons.length === 0 ? { verdict: 'pass', reasons: [] } : { verdict: 'reject', reasons };
}
