import type { ComplianceProfile } from '@sparksocial/shared';
import { PASS, type CheckResult } from './types.js';

/**
 * COMPLIANCE PROFILE — engine spec §10:
 *
 *   *"`health`/`finance`/`legal`/`regulated_other` genomes carry forbidden-phrase
 *   lists and required disclaimers. Block on violation. Do not ship these
 *   verticals without this in place — we would be generating liability for
 *   customers at scale."*
 *
 * "Block on violation" is not softened to a flag anywhere in this module — a
 * regulated-vertical draft that trips a forbidden phrase or is missing a
 * required disclaimer never reaches Review as a maybe, it is rejected outright.
 */

const FORBIDDEN_PHRASES: Record<Exclude<ComplianceProfile, 'none'>, RegExp[]> = {
  health: [/\bcure[sd]?\b/i, /\bguarantee[sd]?\b/i, /\bFDA[- ]approved\b/i, /\bno side effects\b/i, /\btreats?\b/i],
  finance: [/\bguaranteed returns?\b/i, /\brisk[- ]free\b/i, /\bno risk\b/i, /\bcan'?t lose\b/i],
  legal: [/\bguaranteed (win|outcome|result)\b/i, /\bwe will win\b/i, /\bcase closed\b/i],
  regulated_other: [/\bguarantee[sd]?\b/i, /\brisk[- ]free\b/i],
};

const REQUIRED_DISCLAIMERS: Record<Exclude<ComplianceProfile, 'none'>, string> = {
  health: 'not intended to diagnose, treat, cure, or prevent any disease',
  finance: 'not financial advice',
  legal: 'not legal advice',
  regulated_other: 'terms and conditions apply',
};

export interface ComplianceInput {
  text: string;
  profile: ComplianceProfile;
  /** Extra genome-authored phrases (§3.2's `voice.required_disclaimers`), checked verbatim. */
  extraRequiredDisclaimers?: string[];
}

export function complianceProfile(input: ComplianceInput): CheckResult {
  if (input.profile === 'none') return PASS;

  const required = [REQUIRED_DISCLAIMERS[input.profile], ...(input.extraRequiredDisclaimers ?? [])];

  // The health disclaimer's own boilerplate ("...diagnose, treat, cure, or
  // prevent any disease") contains the word "cure" — scanning the raw text
  // would block every compliant draft on its own required disclaimer. Strip
  // each required disclaimer out before running the forbidden-phrase check, so
  // the ban list is only ever evaluated against the brand's own copy.
  let bodyForScan = input.text;
  for (const d of required) {
    bodyForScan = bodyForScan.replace(new RegExp(escapeRegExp(d), 'ig'), '');
  }

  const forbidden = FORBIDDEN_PHRASES[input.profile].find((re) => re.test(bodyForScan));
  if (forbidden) {
    return {
      verdict: 'block',
      rule: 'compliance_profile',
      evidence: { profile: input.profile, matched: forbidden.source },
      fixAction: `Remove the phrase matching ${forbidden.source} — forbidden for "${input.profile}" genomes.`,
    };
  }

  const lower = input.text.toLowerCase();
  const missing = required.filter((d) => !lower.includes(d.toLowerCase()));

  if (missing.length > 0) {
    return {
      verdict: 'block',
      rule: 'compliance_profile',
      evidence: { profile: input.profile, missingDisclaimers: missing },
      fixAction: `Append the required disclaimer(s): ${missing.join('; ')}.`,
    };
  }

  return PASS;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
