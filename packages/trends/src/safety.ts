import type { Genome } from '@sparksocial/shared/genome';
import type { Trend } from './trend.js';

/**
 * BRAND-SAFETY FILTER — PRD §8.9 ("Brand safety filter"), plan §3.2
 * `trend.safety_filter`.
 *
 * This runs *before* ranking, not after, and it is a hard exclusion rather than
 * a score penalty. The asymmetry is deliberate: a missed trend costs a brand one
 * post, and a bad one costs them the account. Nothing about how fast a topic is
 * climbing should be able to outweigh "this brand must not be in this
 * conversation".
 *
 * ── Keyed on constraints, never on niche ───────────────────────────────────
 * Invariant 5. There is no list of unsafe topics per category anywhere here.
 * What makes a trend unsafe is a property of the *genome's declared
 * constraints* — its compliance profile, its licensing, its capabilities —
 * matched against what the trend demands. A clinic and a barbershop are treated
 * differently because their `compliance_profile` differs, not because anything
 * knows what a clinic is.
 */

export type SafetyReason =
  | 'compliance_profile'
  | 'requires_likeness'
  | 'controversy'
  | 'language_mismatch';

export interface SafetyVerdict {
  safe: boolean;
  reasons: SafetyReason[];
  /** Written for the user, not for a log. Surfaced in the `why`. */
  detail?: string;
}

/**
 * Topic markers that make a trend a compliance problem for a regulated brand.
 *
 * Matched against a trend's own tags and topic text — so this is a statement
 * about the *trend*, not about the business. `compliance_profile` decides
 * whether it matters.
 */
const REGULATED_MARKERS: Record<Exclude<Genome['constraints']['compliance_profile'], 'none'>, string[]> = {
  health: ['health_claim', 'medical', 'treatment', 'cure', 'diagnosis', 'supplement', 'weight_loss'],
  finance: ['investment', 'returns', 'crypto', 'trading', 'guaranteed', 'roi'],
  legal: ['legal_advice', 'lawsuit', 'settlement', 'guaranteed_outcome'],
  regulated_other: ['claim', 'guaranteed'],
};

/**
 * Markers that are a bad idea for essentially any brand to join.
 *
 * Kept short on purpose. A long denylist becomes a censor that quietly removes
 * the trends the product exists to find; these are the categories where
 * participation reliably reads as opportunism rather than personality.
 */
const CONTROVERSY_MARKERS = ['controversy', 'tragedy', 'disaster', 'politics', 'election', 'death'];

/** Trends whose format only works if a licensed person appears on camera. */
const LIKENESS_MARKERS = ['face_reveal', 'talking_head', 'grwm', 'dance', 'lipsync'];

export function assessSafety(genome: Genome, trend: Trend): SafetyVerdict {
  const haystack = [trend.topic.toLowerCase(), ...trend.tags.map((t) => t.toLowerCase())];
  const hits = (markers: string[]) => markers.filter((m) => haystack.some((h) => h.includes(m)));

  const reasons: SafetyReason[] = [];
  const details: string[] = [];

  const profile = genome.constraints.compliance_profile;
  if (profile !== 'none') {
    const matched = hits(REGULATED_MARKERS[profile]);
    if (matched.length > 0) {
      reasons.push('compliance_profile');
      details.push(`${profile} brands cannot make claims about ${matched.join(', ')}`);
    }
  }

  const controversial = hits(CONTROVERSY_MARKERS);
  if (controversial.length > 0) {
    reasons.push('controversy');
    details.push(`joining ${controversial.join(', ')} reads as opportunism`);
  }

  // A likeness-dependent format is unsafe for a brand with no licensed person
  // — not because the topic is bad, but because the only way to participate
  // would be to fake it. §10's likeness gate, applied one step earlier.
  const needsLikeness = hits(LIKENESS_MARKERS);
  if (needsLikeness.length > 0 && genome.dimensions.talent_availability !== 'yes_licensed') {
    reasons.push('requires_likeness');
    details.push('this format needs a licensed person on camera');
  }

  // A trend in a language the brand does not publish in cannot be joined
  // credibly, and machine-translating into it is how an account stops sounding
  // like itself.
  if (!genome.identity.languages.includes(trend.language)) {
    reasons.push('language_mismatch');
    details.push(`this brand does not publish in ${trend.language}`);
  }

  return {
    safe: reasons.length === 0,
    reasons,
    ...(details.length ? { detail: details.join('; ') } : {}),
  };
}
