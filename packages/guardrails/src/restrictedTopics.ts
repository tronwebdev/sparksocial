import { PASS, type CheckResult } from './types.js';

/**
 * RESTRICTED TOPICS AND CLAIMS — PRD §9's "Guardrails enforcement":
 *
 *   *"Restricted topics/claims trigger: Needs Review (soft) or Blocked (hard)
 *   depending on strict mode and rule type. All flagged items show: what rule
 *   triggered, recommended fix action."*
 *
 * These are named in PRD §4, §8.2, §8.8, §8.12 and §9 — five sections — and
 * existed in no layer of the system: no column, no tool, no screen, no check.
 * §9's entire enforcement paragraph therefore had nothing to enforce, and the
 * PRD's own first-listed risk ("wrong or off-brand autoposting") had no
 * mitigation behind it beyond a compliance list hardcoded by vertical.
 *
 * ── Two rule types, and why they escalate differently ──────────────────────
 *
 * A **restricted topic** is a subject the brand does not discuss. A **claim to
 * avoid** is an assertion it will not make about a subject it is otherwise
 * happy to discuss ("guaranteed", "the cheapest", "clinically proven"). §9
 * distinguishes them, and the distinction is load-bearing rather than
 * taxonomic: a claim is a promise a customer can act on and hold the brand to,
 * so it is the more dangerous of the two even when strict mode is off.
 *
 *   - strict mode off → a topic flags, a claim flags
 *   - strict mode on  → a topic blocks, a claim blocks
 *
 * A flag routes to Needs Review through `policy.ts` rule 7
 * (`guardrail.flagged`); a block stops the call in `invoke.ts` and never
 * reaches a feed. Both carry `rule` and `fixAction`, because §9 requires a
 * flagged item to say what tripped and what to do about it.
 *
 * ── Whole-word matching, and why not a substring ───────────────────────────
 *
 * A brand that restricts "arms" must not have every "pharmacy" blocked, and a
 * brand that avoids "free" must not lose "freedom". So each entry is matched on
 * word boundaries, case-insensitively, and a multi-word entry matches as a
 * phrase with flexible internal whitespace. Regex-special characters in a
 * user-supplied phrase are escaped — a brand that restricts "C++" is stating a
 * topic, not writing a pattern.
 */

export interface RestrictedTopicsInput {
  text: string;
  /** Subjects this brand does not post about. */
  restrictedTopics?: string[];
  /** Assertions this brand does not make. */
  claimsToAvoid?: string[];
  /** §9's strict compliance mode: block rather than flag. */
  strictMode: boolean;
}

export function restrictedTopics(input: RestrictedTopicsInput): CheckResult {
  const topicHit = firstMatch(input.text, input.restrictedTopics);
  const claimHit = firstMatch(input.text, input.claimsToAvoid);

  // Claims are reported ahead of topics when both trip. The fix differs — a
  // claim is usually one word to soften, a topic means the post should not
  // exist — and naming the cheaper fix first is what makes the message useful.
  if (claimHit) {
    return {
      verdict: input.strictMode ? 'block' : 'flag',
      rule: `claim_to_avoid:${claimHit}`,
      evidence: { matched: claimHit, kind: 'claim' },
      fixAction: `This brand does not claim "${claimHit}". Rewrite the sentence without it${
        input.strictMode ? '' : ', or approve the draft if the claim is genuinely supportable'
      }.`,
    };
  }

  if (topicHit) {
    return {
      verdict: input.strictMode ? 'block' : 'flag',
      rule: `restricted_topic:${topicHit}`,
      evidence: { matched: topicHit, kind: 'topic' },
      fixAction: `"${topicHit}" is a restricted topic for this brand. Draft this post about something else${
        input.strictMode ? '' : ', or approve it if this instance is fine'
      }.`,
    };
  }

  return PASS;
}

/** The first configured phrase that appears in the text, or undefined. */
function firstMatch(text: string, phrases?: string[]): string | undefined {
  for (const phrase of phrases ?? []) {
    const trimmed = phrase.trim();
    if (!trimmed) continue;
    if (phraseRegex(trimmed).test(text)) return trimmed;
  }
  return undefined;
}

/**
 * Word-boundary, case-insensitive, whitespace-flexible.
 *
 * `\b` is skipped where the phrase does not start or end with a word character
 * — `\bC++\b` never matches anything, because `+` is not a word character and
 * there is no boundary after it.
 */
function phraseRegex(phrase: string): RegExp {
  const escaped = escapeRegExp(phrase).replace(/\s+/g, '\\s+');
  const leading = /^\w/.test(phrase) ? '\\b' : '';
  const trailing = /\w$/.test(phrase) ? '\\b' : '';
  return new RegExp(`${leading}${escaped}${trailing}`, 'i');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
