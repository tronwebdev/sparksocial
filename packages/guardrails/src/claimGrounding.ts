import { PASS, type CheckResult } from './types.js';

/**
 * CLAIM GROUNDING — engine spec §10:
 *
 *   *"Any factual claim about a product, price, result, or feature must trace to
 *   a `knowledge` or `social_proof` asset. Ungrounded specifics are stripped or
 *   the draft is rejected."*
 *
 * Outcomes doc §1.1 names this the #1 credibility risk for SaaS: *"a founder who
 * catches SPARK describing a feature that doesn't exist churns immediately and
 * tells people."*
 *
 * A production implementation extracts claims with an LLM and checks each one
 * against retrieved knowledge with entailment, not string matching. This module
 * ships a real, deterministic approximation instead of a stub: it extracts the
 * *specific, checkable* substrings a claim is actually made of — numbers,
 * percentages, currency amounts, and named superlatives ("fastest", "#1",
 * "only") — and requires each one to appear in the grounding corpus verbatim.
 * That is precisely the category of claim the spec's own example turns on
 * ("cut response time from 6 hours to 4 minutes"), and it is swappable for a
 * semantic extractor behind the same `CheckResult` contract without touching
 * any caller.
 */

// Captures the digit together with its unit — "6 hours", "40000 teams", "30%" —
// not the bare digit alone. A number's specificity as a *claim* comes from what
// it's measuring; "6" grounds nothing, "6 hours" is exactly the kind of thing
// the outcomes doc's own example turns on ("cut response time from 6 hours to
// 4 minutes").
const UNITS =
  'percent|x|×|hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?|teams?|users?|customers?|clients?|posts?|leads?|trials?|calls?|emails?|replies?|dollars?';
const NUMERIC_CLAIM = new RegExp(`\\b\\d[\\d,.]*\\s?(%|${UNITS})?\\b`, 'gi');
const CURRENCY_CLAIM = /[$€£₦]\s?\d[\d,.]*\b/gi;
const SUPERLATIVE_CLAIM = /\b(fastest|slowest|cheapest|only|#1|number one|best|first|largest|smallest)\b/gi;

function extractClaims(text: string): string[] {
  const found = new Set<string>();
  for (const re of [NUMERIC_CLAIM, CURRENCY_CLAIM, SUPERLATIVE_CLAIM]) {
    for (const m of text.matchAll(re)) found.add(m[0].trim().toLowerCase());
  }
  // A bare unitless number ("3 tips", list positions) isn't a claim worth
  // grounding; a number with a unit, a percent, a currency symbol, or a named
  // superlative is. Letters in the match mean a unit or superlative was
  // captured; %/currency symbols are checkable on their own.
  return [...found].filter((c) => /\d{2,}|%|\$|€|£|₦|[a-z]/i.test(c));
}

export interface ClaimGroundingInput {
  text: string;
  /** Concatenated text of the genome's `knowledge` and `social_proof` assets. */
  groundingCorpus: string;
}

export function claimGrounding(input: ClaimGroundingInput): CheckResult {
  const claims = extractClaims(input.text);
  if (claims.length === 0) return PASS;

  const corpus = input.groundingCorpus.toLowerCase();
  const ungrounded = claims.filter((c) => !corpus.includes(c));

  if (ungrounded.length === 0) return PASS;

  return {
    verdict: 'block',
    rule: 'claim_grounding',
    evidence: { ungroundedClaims: ungrounded },
    fixAction:
      `Remove or rephrase: ${ungrounded.join(', ')} — none of these trace to a knowledge ` +
      `or social_proof asset. Ingest the source, or generalize instead of stating the specific.`,
  };
}
