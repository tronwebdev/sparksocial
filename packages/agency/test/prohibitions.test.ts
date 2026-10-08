import { describe, expect, it } from 'vitest';
import { extractProhibitions, merge, MAX_EXTRACTED } from '../src/prohibitions.js';

/**
 * Turning a brand's written prohibitions into rules that actually block.
 *
 * The section exists in every real knowledge base and enforced nothing. The
 * writer reads the document as facts and goes past it; `claim_grounding` does
 * not catch a vague boast. `claimsToAvoid` / `bannedPhrases` do block, and this
 * is the bridge.
 */

const DOC = `
# Brand guidelines

## How we talk

**We do not say:** "artisanal", "hand-crafted", "passionate about coffee".

## Things we must never claim

- **No health claims.** Not antioxidants, not metabolism, not "good for you".
- **No unsourced origin stories.** If we cannot name the farm, we do not tell it.
- **Not "organic" or "Fairtrade"** — we hold neither certification.
- **No comparison claims** about named competitors.
- **No "world's best" or "award-winning"** unless we name the award and the year.

## Frequently asked

**Do you grind?** Yes, to order. We never charge for it.
`;

describe('extractProhibitions', () => {
  it('takes the exact words from quotes', () => {
    const out = extractProhibitions(DOC);
    for (const phrase of ['artisanal', 'hand-crafted', 'good for you', 'organic', 'Fairtrade', 'award-winning']) {
      expect(out.bannedPhrases).toContain(phrase);
    }
  });

  it('takes the category from the bullet, without its quotes', () => {
    const out = extractProhibitions(DOC);
    expect(out.claimsToAvoid).toContain('health claims');
    expect(out.claimsToAvoid).toContain('comparison claims');
  });

  it('does not add a bullet that is only quoted phrases', () => {
    /*
     * `No "organic" or "Fairtrade"` is fully captured as two exact phrases.
     * Adding it as a category too would store the literal string
     * `organic" or "fairtrade`, which matches nothing and clutters a list the
     * owner has to read and trust.
     */
    const out = extractProhibitions(DOC);
    for (const c of out.claimsToAvoid) expect(c).not.toMatch(/"/);
    expect(out.claimsToAvoid.some((c) => c.includes(' or '))).toBe(false);
  });

  it("does not split on an apostrophe", () => {
    // `"world's best"` once came out as `world` and `or` — two useless bans,
    // one of which would have refused the word "or".
    const out = extractProhibitions(DOC);
    expect(out.bannedPhrases).toContain("world's best");
    expect(out.bannedPhrases).not.toContain('or');
    expect(out.bannedPhrases).not.toContain('world');
  });

  it('ignores prose outside a prohibition section', () => {
    // "We never charge for it" sits under Frequently asked and is a fact about
    // grinding, not a publishing rule. A heading match is required.
    const out = extractProhibitions(DOC);
    expect(out.claimsToAvoid.some((c) => c.includes('charge'))).toBe(false);
  });

  it('returns nothing for a document with no such section', () => {
    const out = extractProhibitions('# About us\n\nWe bake bread at 4am.\n');
    expect(out.claimsToAvoid).toEqual([]);
    expect(out.bannedPhrases).toEqual([]);
  });

  it('caps what a malformed document can add', () => {
    const many = ['## Things we must never claim', ...Array.from({ length: 80 }, (_, i) => `- No claim number ${i} here`)].join('\n');
    expect(extractProhibitions(many).claimsToAvoid.length).toBeLessThanOrEqual(MAX_EXTRACTED);
  });
});

describe('merge', () => {
  it('only ever adds', () => {
    /*
     * The safety property. A bad parse can make the guardrail stricter — an
     * over-blocked post is visible and fixable — but must never remove a rule
     * the owner set by hand, which would fail open and silently.
     */
    const { next, added } = merge(['no refunds'], ['health claims']);
    expect(next).toContain('no refunds');
    expect(added).toEqual(['health claims']);
  });

  it('does not duplicate what is already set, whatever the case', () => {
    const { next, added } = merge(['Health Claims'], ['health claims']);
    expect(added).toEqual([]);
    expect(next).toEqual(['Health Claims']);
  });
});

/**
 * The shape the extractor actually meets in production.
 *
 * This is real text from a PDF reader, not markdown: no `#`, no bullet
 * characters, lines wrapped mid-sentence, and the next section announced by a
 * bare line. The first version keyed on markdown headings, so against an
 * attached PDF it found the inline "we do not say" list and missed the entire
 * prohibition section — tested against the source markdown and shipped against
 * the PDF, which is the wrong way round.
 */
const PDF_TEXT = [
  'e your morning". Every one of them',
  'could describe anybody.',
  'We do not use exclamation marks in captions.',
  '',
  'Things we must never claim',
  'No health claims. Not "gut-friendly", not "easier to digest", not low-GI. Sourdough is bread we sell, not a',
  'supplement.',
  'Not "organic". Trenoweth flour is not certified and neither are we.',
  'No allergen safety claims. We bake wheat, rye, butter and nuts in one small room. We cannot promise',
  'anything is free of any of them.',
  'No comparison claims about named bakeries.',
  'No "award-winning" — we have won nothing.',
  'Frequently asked',
  'Do you sell out? Most Saturdays by 11am. Forty collection slots are held back for orders placed the night',
  'before.',
].join('\n');

describe('extractProhibitions — PDF-extracted text', () => {
  it('finds the section without markdown headings', () => {
    const out = extractProhibitions(PDF_TEXT);
    expect(out.claimsToAvoid).toContain('health claims');
    expect(out.claimsToAvoid).toContain('allergen safety claims');
    expect(out.bannedPhrases).toContain('award-winning');
    expect(out.bannedPhrases).toContain('gut-friendly');
    expect(out.bannedPhrases).toContain('organic');
  });

  it('stops at the next bare heading', () => {
    /*
     * `Frequently asked` ends the section; nothing from the Q&A below it may
     * become a publishing rule. "Most Saturdays by 11am" is a fact about
     * selling out, not something the brand may never say.
     */
    const out = extractProhibitions(PDF_TEXT);
    for (const c of out.claimsToAvoid) expect(c).not.toMatch(/saturday|collection|sell out/i);
    for (const p of out.bannedPhrases) expect(p).not.toMatch(/saturday|11am/i);
  });
});

/**
 * "Things we do not say" — as plain as a prohibition heading gets, and the
 * pattern missed it. It demanded the word "never" or the word "claim", so a
 * brand that wrote its rules under that heading had every one of them ignored.
 *
 * Found by attaching a real knowledge base and reading `restrictionsAdded`
 * back: it was empty, and nothing had failed or logged a thing.
 */
describe('extractProhibitions — headings people actually write', () => {
  const body = [
    'Things we do not say',
    '',
    '- Never call our work "artisan" or "bespoke". We are a workshop.',
    '- Never describe a repair as "like new".',
    '- No medical claims.',
    '',
    'Proof we can show',
    '',
    '- The workshop itself.',
  ].join('\n');

  it('reads a section headed “Things we do not say”', () => {
    const out = extractProhibitions(body);
    expect(out.bannedPhrases).toEqual(expect.arrayContaining(['artisan', 'bespoke', 'like new']));
    expect(out.claimsToAvoid.length).toBeGreaterThan(0);
  });

  it('stops at the next heading rather than swallowing the rest', () => {
    const out = extractProhibitions(body);
    expect(out.claimsToAvoid.join(' ')).not.toContain('workshop itself');
  });

  for (const heading of [
    'Words we avoid',
    'Banned phrases',
    'Restricted topics',
    "Things we don't say",
    'Do not say',
  ]) {
    it(`recognises “${heading}”`, () => {
      const out = extractProhibitions(`${heading}\n\n- Never say "guaranteed".\n`);
      expect(out.bannedPhrases).toContain('guaranteed');
    });
  }

  /**
   * The narrowness is the point: a menu is not a publishing rule. "We do not
   * offer" lists what the business does not sell, and turning that into banned
   * phrases would stop it writing about its own products.
   */
  it('still ignores a section about what the business does not sell', () => {
    const out = extractProhibitions('What we do not offer\n\n- We do not offer "carbon repair".\n');
    expect(out.bannedPhrases).not.toContain('carbon repair');
  });
});
