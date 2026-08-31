/**
 * SENSITIVE-KEYWORD ESCALATION — `Settings WS EI Sales`'s one hard guarantee.
 *
 * The design's wording is *"Messages containing these will always be
 * escalated"*, and **always** is the entire value of the feature. That is why
 * this is a deterministic function over the message text rather than a line in
 * the classifier's prompt: a prompt instruction is something a model weighs
 * against everything else it was told, and the cases the owner puts on this list
 * — refund, lawsuit, scam, complaint — are exactly the ones where an agent
 * answering confidently and wrongly is the expensive outcome.
 *
 * It runs *after* the classifier and overrides it. Running before, as a
 * short-circuit, would save a model call and lose the intent score and the
 * reason, both of which a person triaging the message still wants to see.
 *
 * ── Why word boundaries and not `includes` ────────────────────────────────
 *
 * Substring matching on a list like this is a trap. `fake` is a plausible entry
 * and appears inside "fakes" (fine) but also inside no end of innocent words in
 * other languages the inbox will genuinely receive; `scam` sits inside
 * "scamper". A false escalation is much cheaper than a missed one, but a rule
 * that fires on unrelated words teaches the owner to shorten the list, which
 * costs the real matches. Boundaries keep it predictable enough to trust.
 *
 * Multi-word entries are supported and matched as a phrase, because "charge
 * back" is a thing an owner will reasonably want on the list.
 */

/** Escapes a keyword for use inside a RegExp — an owner may type `?` or `$`. */
function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The first escalation keyword present in `text`, or undefined.
 *
 * Returns the match rather than a boolean so the `why` can name it. "This was
 * escalated" is not actionable; "this was escalated because it says *refund*"
 * tells the owner both what happened and how to change it.
 */
export function matchEscalationKeyword(text: string, keywords: readonly string[] | undefined): string | undefined {
  if (!keywords?.length) return undefined;

  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (!trimmed) continue;

    /**
     * `\b` would fail on a keyword that starts or ends with punctuation, and on
     * scripts with no ASCII word boundary at all — which an inbox in a
     * multilingual market will genuinely see. Lookarounds on "not a letter or
     * digit" behave the same as `\b` for ordinary words and keep working for the
     * rest.
     */
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(trimmed)}(?![\\p{L}\\p{N}])`, 'iu');
    if (pattern.test(text)) return trimmed;
  }

  return undefined;
}
