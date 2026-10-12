/**
 * Pull a brand's own prohibitions out of its knowledge document.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * A real knowledge base carries a section of things the business must never
 * say: no health claims, not organic, no awards. That section grounded nothing
 * and enforced nothing. The writer reads the document as facts and writes
 * straight past it — asked for "awards we have won" it claims them for a brand
 * whose own document says it has won nothing — and `claim_grounding` does not
 * catch it either, because "recognition in the local community" is too vague to
 * register as a checkable claim.
 *
 * Telling the model harder does not work; that was tried and measured. The
 * mechanism that does work is `claimsToAvoid` / `bannedPhrases`, which the
 * guardrail layer *blocks* on. This is the bridge between the sentence somebody
 * wrote in their brand guidelines and the list that actually stops a post.
 *
 * ── Deterministic, not a model call ───────────────────────────────────────
 *
 * This writes to a setting that blocks publishing. A non-deterministic
 * extractor would give a brand a different rule set each time it re-attached
 * the same file, and a bad sample would be invisible until a legitimate post
 * was blocked by a rule nobody wrote. A pure function over text can be read,
 * unit-tested against real documents, and argued with.
 *
 * It will miss things a model would catch. That is the accepted trade: what it
 * does find is exactly what the document said, and everything it misses stays
 * where it was — in the document, unenforced, which is the status quo rather
 * than a regression.
 *
 * ── It only ever adds ─────────────────────────────────────────────────────
 *
 * `merge` is a union. Nothing here can remove or weaken a restriction the owner
 * set by hand, so a bad parse can only ever make the guardrail stricter — an
 * over-blocked post is visible and fixable, a silently un-blocked one is not.
 */

/** A conservative ceiling. A malformed document must not flood governance. */
export const MAX_EXTRACTED = 25;

/**
 * Headings under which a list of prohibitions is expected.
 *
 * Matched on the heading text, not on position, because the section sits
 * wherever the author put it. Deliberately narrow: a heading has to be *about*
 * prohibition, or every "What we do not offer" list becomes a publishing rule.
 * Which is why the verbs are all about *speech* — say, claim, use, avoid. "We
 * do not say" is a rule; "we do not offer" is a menu.
 *
 * The first set missed **"Things we do not say"**, which is about as plain as
 * that heading gets: it required the word "never" or the word "claim", so a
 * brand whose knowledge base spelled its own prohibitions out under that
 * heading had every one of them ignored. Caught by attaching a real document
 * and reading `restrictionsAdded` back — it was empty, and nothing had failed.
 */
const SECTION =
  /^[#*\s]*(never (claim|say|use)|must not (claim|say|use)|things we (must )?never|things we (do not|don'?t) (say|use)|(do not|don'?t) (claim|say)|words we (avoid|never use)|banned (phrase|word)|restricted (topic|phrase)|prohibit)/i;

/** `**We do not say:** "a", "b"` — the inline form, which needs no heading. */
const INLINE = /\*{0,2}we (do not|don't|never) say:?\*{0,2}\s*(.+)/i;

/**
 * Quoted phrases are the exact words to ban — `"organic"`, `"award-winning"`.
 *
 * Double quotes only. A straight apostrophe is a quote character and also the
 * commonest letter-adjacent punctuation in English, so including it split
 * `"world's best" or "award-winning"` into `world` and `or` — two useless bans,
 * one of which would refuse the word "or".
 */
const QUOTED = /["“”]([^"“”]{2,60})["“”]/g;

/**
 * The claim a bullet opens with — `**No health claims.**` → `health claims`.
 *
 * A category rather than a phrase, so it belongs in `claimsToAvoid` where the
 * guardrail reasons about meaning, not in `bannedPhrases` where it would ban
 * the literal words "health claims" and nothing else.
 */
const BULLET_CLAIM = /^[-*•]?\s*\*{0,2}(?:No|Not|Never)\s+([^.*:—]{3,60})/i;

/**
 * Is this line a heading?
 *
 * ── Why this is not just `#` ──────────────────────────────────────────────
 *
 * The input is almost never markdown. It is whatever a PDF parser produced,
 * and that has no `#`, no bullet characters and lines wrapped mid-sentence:
 *
 *   Things we must never claim
 *   No health claims. Not "gut-friendly", not "easier to digest", not low-GI.
 *   ...
 *   No "award-winning" — we have won nothing.
 *   Frequently asked
 *
 * The first version keyed on markdown headings, so against a real attached PDF
 * it found the inline "we do not say" list and missed the entire prohibition
 * section — the half that actually matters. Tested against the markdown and
 * shipped against the PDF, which is the wrong way round.
 *
 * So a heading is recognised by shape as well: a short line that does not end
 * like a sentence. `Frequently asked` closes the section; `No comparison claims
 * about named bakeries.` does not, because it ends in a full stop and begins
 * with a prohibition word.
 */
function isHeading(line: string): boolean {
  if (/^#{1,6}\s/.test(line)) return true;
  if (line.length === 0 || line.length > 60) return false;
  if (/[.!?,;:"”)]$/.test(line)) return false;
  // A prohibition of its own is never the heading that ends its section.
  if (/^[-*•]?\s*\*{0,2}(No|Not|Never)\b/i.test(line)) return false;
  return /^[*_\s]*[A-Z]/.test(line);
}

export interface Prohibitions {
  /** Categories — "health claims", "comparison claims". */
  claimsToAvoid: string[];
  /** Exact words — "organic", "award-winning". */
  bannedPhrases: string[];
}

export function extractProhibitions(text: string): Prohibitions {
  const lines = text.split(/\r?\n/);
  const claims: string[] = [];
  const phrases: string[] = [];

  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();

    if (isHeading(line)) {
      // A heading always ends the previous section, so a prohibition list
      // cannot bleed into the paragraphs that follow it.
      inSection = SECTION.test(line);
      continue;
    }

    const inline = INLINE.exec(line);
    if (inline) {
      for (const m of inline[2]!.matchAll(QUOTED)) phrases.push(m[1]!);
      continue;
    }

    if (!inSection || !line) continue;

    const bullet = BULLET_CLAIM.exec(line);
    // A bullet that is *only* quoted phrases — `No "organic" or "Fairtrade"` —
    // is already fully captured as exact phrases below. Adding it as a category
    // too would ban the literal string `"organic" or "fairtrade"`, which
    // matches nothing, and clutter a list the owner has to read.
    if (bullet && !isOnlyQuotes(bullet[1]!)) claims.push(bullet[1]!.trim().toLowerCase());
    // Quoted terms anywhere in the section are exact phrases to refuse,
    // whether or not the bullet also named a category.
    for (const m of line.matchAll(QUOTED)) phrases.push(m[1]!);
  }

  return { claimsToAvoid: tidy(claims), bannedPhrases: tidy(phrases) };
}

/** True when the text carries no words of its own outside its quotes. */
function isOnlyQuotes(text: string): boolean {
  // A fresh regex, not the shared `QUOTED`: a `/g` literal carries `lastIndex`
  // between uses, and a checker whose answer depends on what was matched
  // before it is a checker that is wrong intermittently.
  const residue = text
    .replace(/["“”]([^"“”]{2,60})["“”]/g, ' ')
    .replace(/\b(or|and|nor)\b/gi, ' ')
    .replace(/[^a-z0-9]/gi, '')
    .trim();
  return residue.length === 0;
}

/** Trim, drop empties and duplicates case-insensitively, cap. */
function tidy(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    // Strip the quotes themselves; the stored rule is the phrase, not its
    // punctuation, and `"organic"` would otherwise never match `organic`.
    const value = v.trim().replace(/^["“”']+|["“”']+$/g, '').replace(/[.,;:]+$/, '');
    if (value.length < 2 || value.length > 120) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_EXTRACTED) break;
  }
  return out;
}

/**
 * Union of what is already set and what the document said.
 *
 * Returns the additions separately so the caller can say what it changed — a
 * tool that quietly tightens a publishing rule and reports nothing is how
 * somebody spends an afternoon on a post that will never go out.
 */
export function merge(existing: string[] | undefined, found: string[]): { next: string[]; added: string[] } {
  const have = new Set((existing ?? []).map((v) => v.toLowerCase()));
  const added = found.filter((v) => !have.has(v.toLowerCase()));
  return { next: [...(existing ?? []), ...added], added };
}
