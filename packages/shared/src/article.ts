/**
 * "an AI agency", not "a AI agency".
 *
 * The category is free text from the genome, so it is as likely to start with a
 * vowel as not, and the article was hardcoded to "a". It appeared in every logo
 * prompt for every vowel-initial niche — "a AI agency", "a esthetician", "a
 * optician" — which is small, and is the sort of small that makes a product
 * read as machine-written.
 *
 * Letters, not phonetics: "an hour" and "a university" are the exceptions this
 * deliberately gets wrong rather than shipping a pronunciation dictionary for
 * one word in one prompt. The common case is a category like "AI agency" or
 * "accounting firm", and those it gets right.
 */
export function article(noun: string): string {
  return /^[aeiou]/i.test(noun.trim()) ? 'an' : 'a';
}
