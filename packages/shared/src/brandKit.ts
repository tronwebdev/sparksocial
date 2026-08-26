import { z } from 'zod';

/**
 * THE BRAND KIT'S RENDER-AFFECTING PARTS — `SET-WS-BRAND-KITS`, PRD §8.6.
 *
 * `brands` already held the kit's *ingredients*: a logo, an ordered palette, two
 * font ids. This module adds the two things the Brand Kits screen draws that
 * decide how those ingredients are *used* — the watermark, and the text presets
 * behind the Templates tabs.
 *
 * Both live here rather than in `packages/compose` because the renderers, the
 * governance tool and the settings panel all need them, and `shared` is the only
 * package all three may import (CLAUDE.md's frontend rule).
 */

/* ── Watermark ─────────────────────────────────────────────────────────── */

/**
 * `Activate Watermark`, made real.
 *
 * The prototype draws this as a toggle, and until now it was a toggle over
 * nothing: both renderers drew the logo unconditionally whenever `brands.logo_url`
 * was set (`logoOverlay` in `packages/compose/src/composition.ts`, `logoNode` in
 * `apps/api/src/satori-runner.ts`). There was no way to have a logo on the brand
 * — which onboarding asks for, and the Draft Panel and the still renderer both
 * use elsewhere — without stamping it on every frame of every post.
 *
 * ── Why there is no position control ──────────────────────────────────────
 *
 * The mark sits bottom-left, and that is not an arbitrary default this schema
 * should let a user override casually. `satori-runner.ts` records the reasoning:
 * TikTok and Reels both put their own controls and captions bottom-right, and a
 * top corner collides with the account header. Three of the four corners are
 * places the platform will draw over. The prototype does not offer a position
 * either, so offering one here would be inventing a control whose other options
 * are known to be worse.
 *
 * `opacity` and `scale` are offered because without them this is not a
 * watermark, it is the logo overlay that already existed. A mark you cannot make
 * recede is a mark that competes with the content.
 */
export const Watermark = z.object({
  /**
   * Default `true`, which preserves exactly what every brand rendered before
   * this column existed. A migration that silently turned marks off would change
   * the output of every scheduled post without anyone asking for it.
   */
  enabled: z.boolean().default(true),
  /** 0.15–1. Floored above zero: fully transparent is `enabled: false` said confusingly. */
  opacity: z.number().min(0.15).max(1).default(1),
  /** Fraction of frame width. 0.12 is what both renderers hard-coded. */
  scale: z.number().min(0.04).max(0.3).default(0.12),
});
export type Watermark = z.infer<typeof Watermark>;

/** What the renderers get when a brand has never touched the setting. */
export const DEFAULT_WATERMARK: Watermark = { enabled: true, opacity: 1, scale: 0.12 };

/* ── Templates ─────────────────────────────────────────────────────────── */

/**
 * The Templates tabs, which turn out to be one thing five times.
 *
 * The prototype draws `Intros/outros`, `Bumpers`, `Caption presets` and
 * `Lower-Thirds` as peer tabs over a grid of `Preset 1`…`Preset 8`, and every
 * preset's content is **a line of text** ("Welcome to our channel! Stay tuned for
 * more exciting content."). So a template here is not a media file, a Premiere
 * project or a motion graphic — it is a saved string with a category and a name,
 * applied by `Use This Brand Preset`.
 *
 * That is worth stating plainly because "intro/outro template" reads like an
 * asset, and building it as one would mean an upload path, a render-time video
 * concat, and a storage bill — for a feature whose design is a text field.
 *
 * ── How each category is applied ──────────────────────────────────────────
 *
 * The application tools already exist, which is why this is data and not code:
 *
 *   `intro` / `outro` / `bumper` → `content.scene.insert` (a new timed scene)
 *   `caption`                    → `content.beat.update` (an existing beat's text)
 *   `lower_third`                → `content.scene.lower_third` (an overlay on a scene)
 *
 * `intro` and `outro` differ only in where the scene goes, and `bumper` only in
 * that it goes in the middle. They are separate categories rather than one
 * because that is how the screen groups them, and because a brand's sign-off line
 * is not interchangeable with its opener.
 */
export const KitTemplateCategory = z.enum(['intro', 'outro', 'bumper', 'caption', 'lower_third']);
export type KitTemplateCategory = z.infer<typeof KitTemplateCategory>;

export const KitTemplate = z.object({
  /** Stable across renames, so a draft can record which preset it used. */
  id: z.string().min(1).max(64),
  category: KitTemplateCategory,
  /** What the tab shows. The prototype's own are `Preset 1`…`Preset 8`. */
  name: z.string().min(1).max(60),
  /**
   * The line itself.
   *
   * Capped at 280 because these are spoken or superimposed, not read: a
   * lower-third longer than a couple of lines does not fit the lower third, and
   * an intro nobody can say in three seconds is not an intro. The cap is a
   * design constraint made enforceable rather than a storage limit.
   */
  text: z.string().min(1).max(280),
});
export type KitTemplate = z.infer<typeof KitTemplate>;

/**
 * The cap on how many a brand may keep.
 *
 * Forty is eight per category, which is exactly what the prototype's grid shows.
 * A bound exists at all because this array is read on every governance fetch and
 * shipped to the client whole; unbounded, a settings screen becomes a way to make
 * every page load slower.
 */
export const MAX_KIT_TEMPLATES = 40;

export const KIT_TEMPLATE_WORDS: Record<KitTemplateCategory, string> = {
  intro: 'Intro',
  outro: 'Outro',
  bumper: 'Bumper',
  caption: 'Caption',
  lower_third: 'Lower-third',
};

/**
 * Starter lines, offered as *suggestions* and never written without being chosen.
 *
 * The same pattern the Brand Kits screen already uses for restricted topics and
 * claims to avoid: the design shows a `Suggestions` row, and picking one is what
 * stores it. Seeding these into a brand's row at migration time would put words
 * nobody wrote into their posts.
 *
 * Deliberately generic and deliberately few. These are meant to be replaced, and
 * a long list of plausible-sounding copy invites accepting it unread — which is
 * how every brand ends up with the same sign-off.
 */
export const KIT_TEMPLATE_SUGGESTIONS: ReadonlyArray<{ category: KitTemplateCategory; text: string }> = [
  { category: 'intro', text: 'Quick one today, and it matters more than it sounds.' },
  { category: 'intro', text: "Here's the thing nobody tells you about this." },
  { category: 'outro', text: 'That is the whole idea. Tell me if you want the longer version.' },
  { category: 'outro', text: 'More like this every week. Follow along if it is useful.' },
  { category: 'bumper', text: 'One more thing worth knowing.' },
  { category: 'caption', text: 'Save this for the next time it comes up.' },
  { category: 'lower_third', text: 'What most people get wrong' },
];

/** `content.scene.lower_third`'s cap, matching `KitTemplate.text` — one line, superimposed. */
export const MAX_LOWER_THIRD = 280;
