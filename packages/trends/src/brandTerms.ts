import type { Genome } from '@sparksocial/shared/genome';

/**
 * WHAT A BRAND IS ABOUT, AS WORDS A TREND SOURCE CAN SEARCH FOR.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * `trend.rank` fetched each source's general trending list and ranked it by
 * *format* fit alone — proof asset, geography, capture capability. Nothing
 * asked what the brand is about, so a coffee roaster's "For you" feed was
 * whatever YouTube was trending, filtered to things a roaster could film: a
 * Minecraft video and a baseball team, on 29 October.
 *
 * ── What this derives, and from where ─────────────────────────────────────
 *
 * Only the brand's own words, as text: its products' names and the leading
 * phrase of its sub-category ("Speciality coffee roastery", from "Speciality
 * coffee roastery with London shops and online/mail order"), falling back to
 * the category label. These are *search queries and match terms*, never a
 * branch — invariant 5 forbids routing on a category name, and nothing here
 * decides behaviour by what the category is; it only looks for the brand's
 * own words in a trend's title. A barbershop and a bakery go through exactly
 * the same code with different strings.
 */

/** Joining and filler words that say nothing about a subject. */
const STOP = new Set(
  (
    'a an and the of for with from in on at to by or our your their its into via ' +
    'online offline mail order orders shop shops store stores brand brands business company services service ' +
    'based led inspired style group retail locations location national shipping delivery local global'
  ).split(' '),
);

const MAX_PHRASES = 3;
const MAX_PHRASE_WORDS = 5;

export interface BrandTerms {
  /** Search phrases, OR'd by the sources that search. */
  phrases: string[];
  /** Content words, matched whole against a trend's title and tags. */
  words: Set<string>;
}

/**
 * The descriptive head of a label — "X with Y" → "X", "X (Y)" → "X" — cut to a
 * few words and never ending on a joining word ("Indian cafés and" is not a
 * query anyone would type).
 */
function head(label: string): string {
  const words = label
    .split(/\s+(?:with|for|and online|including|serving)\s+|[(,;:—–|]|\s-\s/i)[0]!
    .trim()
    .split(/\s+/)
    .slice(0, MAX_PHRASE_WORDS);
  while (words.length && STOP.has(words.at(-1)!.toLowerCase())) words.pop();
  return words.join(' ');
}

/** Singular-ish, so "restaurants" in a brand and "restaurant" in a title meet. */
export const stem = (w: string) =>
  w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;

export function brandTerms(genome: Genome): BrandTerms {
  const id = genome.identity;
  const candidates = [
    ...(genome.offer?.products ?? []).slice(0, 2).map((p) => head(p.name)),
    head(id.sub_category ?? '') || head(id.category),
  ];

  const phrases: string[] = [];
  for (const c of candidates) {
    const p = c.trim();
    if (p.length >= 3 && !phrases.some((x) => x.toLowerCase() === p.toLowerCase())) phrases.push(p);
    if (phrases.length >= MAX_PHRASES) break;
  }

  const words = new Set<string>();
  for (const p of phrases) {
    for (const w of p.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 3 && !STOP.has(w)) words.add(stem(w));
    }
  }

  return { phrases, words };
}
