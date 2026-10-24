/**
 * BRAND TYPE — M4, the resolvable half.
 *
 * The decision of 22 August was that the brand kit is a *record*, so fonts are a
 * reference the renderer resolves rather than a file somebody uploads. That has a
 * consequence worth stating before the list: the control can only offer faces the
 * renderers can actually get hold of, and the two renderers can get hold of very
 * different things.
 *
 * ── What each renderer can resolve, measured ───────────────────────────────
 *
 * Satori (`compose.static`) cannot use a system font at all — it needs real font
 * bytes handed to it up front. Of the three faces vendored in this repo, only two
 * parse inside it, checked directly rather than assumed: `AsgardTrial-FitBold.ttf`
 * parses, `CS-Mollwish.otf` parses but is a wordmark face with almost no glyph
 * coverage (2.8KB of output against Asgard's 27KB for the same string), and
 * `Onest-Variable.ttf` throws inside Satori's parser — a variable font it cannot
 * read. So the vendored set yields exactly **one** usable face, and a picker with
 * one entry is not a control.
 *
 * Remotion (`compose.render`) draws in headless Chromium, which resolves whatever
 * the page can load. It currently asks for `sans-serif` and gets whatever the
 * container happens to have.
 *
 * ── So the list is Google Fonts, resolved at render time ───────────────────
 *
 * Every face here is a Google Fonts family: open-licensed, fetchable by both
 * renderers from one URL, and no new files in the repo. The bytes are resolved
 * through the CSS2 API rather than pinned `fonts.gstatic.com` paths, because
 * Google rotates those filenames and a pinned URL becomes a render that silently
 * falls back a year from now.
 *
 * The vendored Asgard stays as the *fallback* — which is what Satori renders with
 * today, so a brand that picks nothing renders exactly as it does now.
 *
 * ── Where this lives, and why ──────────────────────────────────────────────
 *
 * In `shared`, like `campaignAutonomy.ts`, because four places need the same
 * answers and they sit on different sides of the build order: `compose` resolves
 * a stack for the renderers, `agency` validates the setting, `apps/api` fetches
 * the bytes, and `apps/web` draws the picker. An id meaning one face to the
 * picker and another to the renderer would be worse than no picker.
 *
 * Deep-importable (`@sparksocial/shared/brandFonts`) and deliberately free of
 * Node imports, because `compose/src/timeline.ts` reaches it and that file is
 * bundled for a browser — see its own header on the `node:crypto` break that
 * rule exists to prevent.
 *
 * Pure data and pure functions. The fetching and caching live in
 * `apps/api/src/font-loader.ts`, beside the runner that needs the bytes.
 */

import { z } from 'zod';

export type BrandFontId = 'inter' | 'dm_sans' | 'space_grotesk' | 'playfair' | 'lora' | 'oswald';

export interface BrandFontFace {
  id: BrandFontId;
  /** What the owner picks from. */
  label: string;
  /** Which job it is good at, in a few words — the picker shows this. */
  note: string;
  /** Google Fonts family name, as the CSS2 API spells it. */
  family: string;
  /**
   * The weight to fetch. One weight per face rather than a range: Satori is
   * handed one buffer per family and a variable font is what it choked on, so
   * asking for a single static cut is the difference between a face that renders
   * and one that throws.
   */
  weight: 400 | 500 | 600 | 700;
  /** Whether it reads well at paragraph length, or only as a headline. */
  role: 'display' | 'body' | 'both';
}

/**
 * Six, chosen to span the range a small business actually asks for — neutral,
 * warm, technical, editorial, readable-serif, condensed — rather than to be a
 * catalogue. A long list makes the choice harder and every entry is a family the
 * render path has to be able to fetch.
 *
 * DM Sans is in the list because the prototype's own brand card names it: its
 * typography row reads "Font Styles: Asgard, DM Sans".
 */
export const BRAND_FONTS: readonly BrandFontFace[] = [
  { id: 'inter', label: 'Inter', note: 'Neutral and modern. Reads as clean rather than as anything.', family: 'Inter', weight: 600, role: 'both' },
  { id: 'dm_sans', label: 'DM Sans', note: 'Warmer than Inter, still plain. Good default for a local business.', family: 'DM Sans', weight: 500, role: 'both' },
  { id: 'space_grotesk', label: 'Space Grotesk', note: 'Technical, slightly odd letterforms. Suits software and studios.', family: 'Space Grotesk', weight: 600, role: 'both' },
  { id: 'playfair', label: 'Playfair Display', note: 'High-contrast serif. Headlines only — it thins out at small sizes.', family: 'Playfair Display', weight: 700, role: 'display' },
  { id: 'lora', label: 'Lora', note: 'Serif that holds up in paragraphs. Reads considered.', family: 'Lora', weight: 500, role: 'both' },
  { id: 'oswald', label: 'Oswald', note: 'Condensed and loud. Fits a lot of words on a poster.', family: 'Oswald', weight: 600, role: 'display' },
];

/**
 * The two faces a brand kit names. Either may be absent, and absent means "the
 * default".
 *
 * `string` rather than `BrandFontId`, deliberately. This is what a jsonb column
 * actually holds, and it can hold an id that is no longer in the list — a face
 * removed from `BRAND_FONTS` leaves every brand that had chosen it with a value
 * nothing resolves. `brandFont()` returns `undefined` for those and `resolveKit`
 * falls back, which is the right behaviour; typing the field as the narrow union
 * would be a claim the database cannot keep, and the cast that made it compile
 * would hide exactly that case.
 */
export interface BrandFonts {
  /** Headlines and text-only beats. */
  display?: string;
  /** Captions and running text. */
  body?: string;
}

/**
 * A font family read off a real website, mapped to the nearest face we can
 * actually render.
 *
 * ── The bug this exists for ───────────────────────────────────────────────
 *
 * `brandKit.ts` reads the site's own CSS and comes back with whatever the
 * designer chose — "Plus Jakarta Sans", "Asgard Trial", "Söhne". Onboarding
 * wrote that straight into `brandFonts`, which is validated against the six
 * ids below, so every brand whose site used a font that is not one of six
 * failed its first save with
 *
 *   brandFonts.display: Invalid enum value. Expected 'inter' | … received 'Asgard Trial'
 *
 * on screen. Which is to say: it failed for nearly every real site.
 *
 * ── Why the enum is not the thing to widen ───────────────────────────────
 *
 * It would be easy to let the column hold any string, and wrong. The list is
 * six because those are the faces both renderers can fetch — Satori needs real
 * bytes and chokes on a variable font, and a family name it cannot resolve is
 * a render that silently falls back. Storing "Plus Jakarta Sans" would turn a
 * loud validation error into a quiet wrong-font, which is worse.
 *
 * ── So: match, and say nothing rather than guess wildly ──────────────────
 *
 * The crawl is a *proposal* — `saveKit` only applies it when the brand has no
 * fonts yet — so proposing the closest renderable face is exactly its job.
 * Exact names first, then the handful of aliases that are genuinely the same
 * design, then a classification by what the name says about the shape, and
 * `undefined` when nothing matches. Absent means "the default", which is a
 * better answer than a face nobody chose.
 */
const FONT_ALIASES: Record<string, BrandFontId> = {
  // The list itself, so a site already using one of ours is recognised.
  inter: 'inter',
  'dm sans': 'dm_sans',
  'space grotesk': 'space_grotesk',
  'playfair display': 'playfair',
  lora: 'lora',
  oswald: 'oswald',

  /*
   * Faces that are close enough that a reader would not call it a different
   * brand. Deliberately short: a long alias table is a list of opinions, and
   * the classifier below handles the rest without pretending to recognise
   * something it does not.
   */
  'plus jakarta sans': 'dm_sans',
  'plus jakarta display': 'dm_sans',
  poppins: 'dm_sans',
  nunito: 'dm_sans',
  'nunito sans': 'dm_sans',
  rubik: 'dm_sans',
  manrope: 'inter',
  roboto: 'inter',
  'helvetica neue': 'inter',
  helvetica: 'inter',
  arial: 'inter',
  'sf pro text': 'inter',
  'sf pro display': 'inter',
  'segoe ui': 'inter',
  'open sans': 'inter',
  lato: 'inter',
  montserrat: 'inter',
  'work sans': 'inter',
  'source sans pro': 'inter',
  'ibm plex sans': 'inter',
  figtree: 'dm_sans',
  outfit: 'space_grotesk',
  sora: 'space_grotesk',
  'space mono': 'space_grotesk',
  satoshi: 'space_grotesk',
  'general sans': 'space_grotesk',
  georgia: 'lora',
  'times new roman': 'lora',
  garamond: 'lora',
  'eb garamond': 'lora',
  merriweather: 'lora',
  'pt serif': 'lora',
  'source serif pro': 'lora',
  'dm serif display': 'playfair',
  'bodoni moda': 'playfair',
  didot: 'playfair',
  'abril fatface': 'playfair',
  'bebas neue': 'oswald',
  anton: 'oswald',
  'archivo narrow': 'oswald',
  teko: 'oswald',
};

/** Words in a family name that say what shape it is, when the name is unknown. */
const SERIF_HINT = /serif|georgia|times|garamond|baskerville|caslon|didot|bodoni|playfair|roman/;
const CONDENSED_HINT = /condensed|narrow|compressed|impact|anton|bebas/;
const MONO_HINT = /mono|code|courier|consol/;

export function matchBrandFont(family: string | undefined): BrandFontId | undefined {
  if (!family) return undefined;

  /*
   * One family, lowercased, quotes and weight suffixes stripped. A CSS stack
   * has already been reduced to its first entry by the crawler, but the names
   * that arrive still carry things like "Trial", "Variable" and "Pro" that are
   * licensing or cut, not identity.
   */
  const name = family
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/(trial|variable|vf|pro|std|lt|mt|regular|book)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) return undefined;

  const alias = FONT_ALIASES[name];
  if (alias) return alias;

  /*
   * A generic family is not a choice — `font-family: sans-serif` means the
   * designer did not pick one, and proposing Inter off the back of it would be
   * inventing a decision.
   */
  if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|-apple-system|inherit|initial)$/.test(name)) {
    return undefined;
  }

  // Unknown name: read what the name says about the shape. Mono has no match in
  // the six, and a condensed display face is closer to Oswald than to anything.
  if (MONO_HINT.test(name)) return 'space_grotesk';
  if (CONDENSED_HINT.test(name)) return 'oswald';
  if (SERIF_HINT.test(name)) return 'lora';

  /*
   * Everything else is a sans nobody here has heard of, which most custom
   * brand faces are. Inter is the neutral one — the face that reads as clean
   * rather than as anything — so it is the least wrong default.
   */
  return 'inter';
}

export function brandFont(id: string | undefined): BrandFontFace | undefined {
  return BRAND_FONTS.find((f) => f.id === id);
}

/**
 * A CSS family stack for one choice, for the renderer that speaks CSS.
 *
 * The fallbacks matter more than they look: if the `@font-face` fetch fails, this
 * is what the frame is drawn in, and a stack ending in `sans-serif` produces
 * something legible where a bare family name produces the container's default —
 * which in a minimal image is often a serif nobody chose.
 */
export function fontStack(id: string | undefined): string {
  const face = brandFont(id);
  if (!face) return SYSTEM_SANS;
  // A serif that falls back to a sans changes the page's character entirely, so
  // the generic matches the family rather than being one constant for all six.
  const generic = SERIF_FAMILIES.has(face.id) ? SYSTEM_SERIF : SYSTEM_SANS;
  return `"${face.family}", ${generic}`;
}

const SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SYSTEM_SERIF = 'Georgia, "Times New Roman", serif';
const SERIF_FAMILIES = new Set<BrandFontId>(['playfair', 'lora']);

/**
 * The ids, as a Zod enum, so `brand.governance.set` rejects a face the render
 * path cannot fetch instead of storing a setting that changes no pixel.
 *
 * Derived from `BRAND_FONTS` rather than typed out again: a face added to the
 * list above becomes settable with no second edit, and — more to the point — a
 * face *removed* stops being settable in the same commit.
 */
export const BrandFontIdSchema = z.enum(
  BRAND_FONTS.map((f) => f.id) as [BrandFontId, ...BrandFontId[]],
);

/** The picker's own payload — labels and notes, without the render-path detail. */
export function brandFontOptions(): Array<{ id: BrandFontId; label: string; note: string; role: string }> {
  return BRAND_FONTS.map((f) => ({ id: f.id, label: f.label, note: f.note, role: f.role }));
}
