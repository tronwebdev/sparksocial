/**
 * NICHE RESOLUTION — putting a crawl's free-text category onto the onboarding
 * list.
 *
 * In `@sparksocial/shared` rather than beside the component because `apps/web`
 * has no test collection (`vitest.config.ts` gathers `packages/**` and
 * `apps/**\/test`), and this is the kind of mapping that is wrong in ways a
 * type checker cannot see. Same move as `timezones.ts` and `audioPeaks.ts`.
 */

/** The twelve options the Brand Details select offers. */
export const NICHES = [
  'Trades and services',
  'Food and drink',
  'Health and fitness',
  'Beauty and grooming',
  'Retail and e-commerce',
  'Professional services',
  'Software',
  'Property',
  'Education',
  'Hospitality',
  'Creative and events',
  'Something else',
] as const;

/**
 * Words that point at a niche, for resolving what the crawl actually returns.
 *
 * The inferred category is free text and deliberately so — `genome.identity`
 * holds what the *site* says it is, and the model is told to describe rather
 * than pick from a list. Real answers from the deployed crawler:
 * `"Jewellery brand / DTC e-commerce"`, `"B2B SaaS"`,
 * `"AI sales/revenue agent platform"`. None of them is a member of `NICHES`,
 * so the select fell through to "Choose one" and the screen looked like the
 * crawl had learned nothing.
 *
 * Keyword matching, not a model call: this is a twelve-way choice the person
 * can see and correct in one click, and a second inference pass to fill a
 * dropdown would cost money and a second way to be wrong.
 *
 * Order matters — the first hit wins, so the more specific terms come first.
 */
const NICHE_HINTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Software', ['saas', 'software', 'app', 'platform', 'api', 'developer', 'ai agent', 'tech']],
  /*
   * No bare `shop` or `brand` here, both deliberately.
   *
   * `shop` catches barbershop, coffee shop, bike shop and workshop — the test
   * for "barbershop" returned Retail before they were removed. `brand` is
   * looser still: almost every business describes itself as one. `boutique`
   * went the same way after "boutique hotel" landed here: it is an adjective,
   * not a trade. The specific
   * terms below do the work, and anything genuinely retail that misses them
   * lands on "Something else" with its own wording kept, which is a better
   * failure than a confident wrong answer.
   */
  ['Retail and e-commerce', ['e-commerce', 'ecommerce', 'dtc', 'd2c', 'retail', 'store', 'jewellery', 'jewelry', 'fashion', 'clothing']],
  ['Food and drink', ['restaurant', 'cafe', 'coffee', 'bakery', 'brewery', 'food', 'drink', 'catering', 'kitchen']],
  ['Health and fitness', ['gym', 'fitness', 'health', 'clinic', 'dental', 'physio', 'wellness', 'yoga', 'pilates']],
  ['Beauty and grooming', ['salon', 'barber', 'beauty', 'nails', 'spa', 'aesthetic', 'grooming', 'hair']],
  ['Trades and services', ['plumb', 'electric', 'builder', 'roofing', 'joiner', 'landscap', 'cleaning', 'garage', 'repair', 'trades']],
  ['Professional services', ['accounting', 'accountant', 'law', 'legal', 'solicitor', 'consult', 'agency', 'marketing', 'finance', 'insurance', 'recruit']],
  ['Property', ['estate agent', 'property', 'lettings', 'real estate', 'architect']],
  ['Education', ['school', 'tutor', 'course', 'academy', 'training', 'education', 'learning']],
  ['Hospitality', ['hotel', 'bnb', 'b&b', 'guesthouse', 'hostel', 'travel', 'tourism', 'venue']],
  ['Creative and events', ['photograph', 'video', 'design studio', 'events', 'wedding', 'florist', 'music', 'creative']],
];

/**
 * Put a free-text category onto the list, or fall back to "Something else"
 * with the original text kept.
 *
 * Never returns nothing when it was given something: a category the list
 * cannot express is exactly what "Something else" is for, and dropping it
 * would lose what the crawl learned — which is the bug this closes, one
 * option over.
 */
export function resolveNiche(category: string | undefined): { niche: string; other: string } {
  const text = category?.trim();
  if (!text) return { niche: '', other: '' };

  // An exact member of the list passes through untouched.
  if ((NICHES as readonly string[]).includes(text)) return { niche: text, other: '' };

  const haystack = text.toLowerCase();
  for (const [niche, hints] of NICHE_HINTS) {
    if (hints.some((h) => haystack.includes(h))) return { niche, other: '' };
  }

  return { niche: 'Something else', other: text };
}
