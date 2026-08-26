/**
 * Deep import, not the barrel, and this is load-bearing.
 *
 * `composition.ts` imports this file, and Remotion *bundles* that entry for a
 * browser with webpack. `@sparksocial/shared`'s barrel re-exports
 * `oauthState.ts`, which imports `node:crypto` — unbundlable for a browser — so
 * pulling the barrel in here failed every video render with
 *
 *   Module build failed: UnhandledSchemeError: Reading from "node:crypto"
 *   is not handled by plugins (Unhandled scheme).
 *
 * `compose.render` had therefore never produced a video; the unit tests inject a
 * fake runner and never bundle, so nothing caught it. Found by running the
 * Assemble pipeline end to end for the first time.
 *
 * Anything this file imports has to survive being bundled for a browser. Keep
 * the imports narrow and never reach for the barrel.
 */
import { ToolError } from '@sparksocial/shared/types';
import type { ResolvedBeat } from '@sparksocial/generate';
// Pure data and pure functions, no Node imports — safe on the bundled path this
// file's own header warns about.
import { brandFont, fontStack, type BrandFontFace, type BrandFonts } from '@sparksocial/shared/brandFonts';

/**
 * `content.draft`'s `ResolvedBeat[]` (persisted on `content_items.copy`) knows
 * *what* each beat is — an asset reference, written text, a generated image/
 * video/audio URL — but not *how long* it plays; duration lives on the
 * playbook record, not the draft. This module re-joins the two by `beatId`,
 * the same "derive, don't duplicate" rule `assemble/src/plan.ts` already
 * follows for beat resolution.
 *
 * The other join `compose.render` needs: an `asset`-kind beat carries only an
 * `assetId`, not a URL — the Asset Graph's own storage location. That comes
 * from `ctx.db.assets.info()`, passed in already resolved so this module stays
 * pure and testable without a store.
 */

export type TimedBeat =
  | { kind: 'image'; beatId: string; durationSec: number; url: string; caption?: string }
  | { kind: 'video'; beatId: string; durationSec: number; url: string; caption?: string }
  | { kind: 'text'; beatId: string; durationSec: number; text: string }
  /** A narration track meant to underlay the composition, not its own visual slot — see the module comment on `generated_audio`. */
  | { kind: 'audio'; beatId: string; durationSec: number; url: string };

export interface AssetLookup {
  url: string;
  mediaType: string;
}

export function zipTimeline(args: {
  resolvedBeats: ResolvedBeat[];
  playbookBeats: Array<{ id: string; duration_sec: number }>;
  assetInfo: Record<string, AssetLookup>;
}): TimedBeat[] {
  const durationByBeatId = new Map(args.playbookBeats.map((b) => [b.id, b.duration_sec]));

  return args.resolvedBeats.map((beat): TimedBeat => {
    /**
     * The beat's own duration wins, and the playbook join is the fallback.
     *
     * This inverted on 24 August, when the draft took ownership of its structure
     * (`ResolvedBeat` in packages/generate/src/draft.ts). Before it, duration
     * came only from the playbook and any beat the playbook did not declare threw
     * — which is what made adding a scene impossible, since a scene somebody adds
     * has no playbook entry by construction.
     *
     * The guard that remains is narrower and still worth having: a beat with
     * *neither* its own duration nor a playbook entry is a genuinely unresolvable
     * row, and guessing a length for it would render a post at a duration nobody
     * chose. The drift case the old message described — the playbook changing
     * under a draft — is now handled rather than refused: a draft that knows its
     * own timing renders as it was drafted, which is what an approved post should
     * do. The cost is that the band check has to run against the draft's totals
     * instead, which is `assertDraftDuration`'s job.
     */
    const durationSec = beat.durationSec ?? durationByBeatId.get(beat.beatId);
    if (durationSec === undefined) {
      throw new ToolError(
        'INVALID_INPUT',
        `Beat "${beat.beatId}" has no duration of its own and is not in this playbook's beat list.`,
        { beatId: beat.beatId },
      );
    }

    if (beat.kind === 'text') {
      return { kind: 'text', beatId: beat.beatId, durationSec, text: beat.text };
    }

    if (beat.kind === 'generated_image') {
      return { kind: 'image', beatId: beat.beatId, durationSec, url: beat.url };
    }

    if (beat.kind === 'generated_video' || beat.kind === 'generated_broll') {
      return { kind: 'video', beatId: beat.beatId, durationSec, url: beat.url };
    }

    if (beat.kind === 'generated_audio') {
      return { kind: 'audio', beatId: beat.beatId, durationSec, url: beat.url };
    }

    if (beat.kind === 'dubbed_media') {
      return { kind: beat.mediaType, beatId: beat.beatId, durationSec, url: beat.url };
    }

    // kind === 'asset'
    const info = args.assetInfo[beat.assetId];
    if (!info) {
      throw new ToolError('NOT_FOUND', `Asset "${beat.assetId}" for beat "${beat.beatId}" is gone from the Asset Graph.`, {
        beatId: beat.beatId,
        assetId: beat.assetId,
      });
    }
    if (info.mediaType === 'audio') {
      throw new ToolError('INVALID_INPUT', `Beat "${beat.beatId}" points at an audio asset — beats render visually.`, {
        beatId: beat.beatId,
        assetId: beat.assetId,
      });
    }
    return {
      kind: info.mediaType === 'video' ? 'video' : 'image',
      beatId: beat.beatId,
      durationSec,
      url: info.url,
      ...(beat.caption ? { caption: beat.caption } : {}),
    };
  });
}

/** Standard export dimensions per aspect ratio — Remotion needs literal pixels, not a ratio string. */
export const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export function dimensionsFor(aspect: string): { width: number; height: number } {
  const dims = ASPECT_DIMENSIONS[aspect];
  if (!dims) {
    throw new ToolError('INVALID_INPUT', `No export dimensions defined for aspect ratio "${aspect}".`, { aspect });
  }
  return dims;
}

const FPS = 30;

/** Total frames for a beat list at the render fps — the composition's duration and, for a still (`image`/`carousel` media type), which single frame to render (0). */
export function framesFor(beats: Array<{ durationSec: number }>, fps = FPS): number {
  return Math.max(1, Math.round(beats.reduce((sum, b) => sum + b.durationSec, 0) * fps));
}

/**
 * §8.6's "Apply Brand Kit", as the renderers see it.
 *
 * `brands.logo_url` and `brands.brand_colors` have existed on the row, and
 * `brand.governance.set` has written them, and no renderer ever read either —
 * so the toggle §8.6 describes had nothing on the other side of it. Both
 * `compose.static` and `compose.render` now resolve this from the brand and
 * hand it to their runner.
 *
 * ── Why the palette is positional and short ───────────────────────────────
 *
 * `brandColors` is an ordered list a person typed, not a semantic map, so the
 * meanings are assigned by position and documented rather than guessed at from
 * lightness: **first is the ground, second is the type on it, third is the
 * accent.** Anything beyond the third is ignored by the renderers rather than
 * being blended into something nobody chose. A brand that gives one colour gets
 * that ground and keeps the default type colour, which is the only combination
 * guaranteed to stay legible without knowing what the colour is.
 */
export interface BrandKit {
  /** Drawn as a corner mark on media beats and above the type on text beats. Absent means no mark. */
  logoUrl?: string;
  /** Ordered: ground, type, accent. Empty means "use the defaults". */
  colors: string[];
  /**
   * M4's fonts — a *reference* to a resolvable face, never an uploaded file. See
   * `@sparksocial/shared/brandFonts` for which faces each renderer can actually
   * get hold of, and why that question decides what the picker may offer.
   */
  fonts?: BrandFonts;
}

/** The renderers' fallbacks — the values both files used as literals before a brand kit could reach them. */
export const DEFAULT_GROUND = '#0C0C0C';
export const DEFAULT_TYPE = '#FFFFFF';

/**
 * WCAG 2.1 relative luminance of a `#rrggbb` colour.
 *
 * Returns `null` for anything it cannot parse, so a malformed kit colour falls
 * back to the default pairing instead of being scored as black.
 */
function relativeLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const channels = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Black or white against `ground`, whichever WCAG contrast ratio is higher.
 *
 * Only ever those two. The thing genuinely worth refusing to guess is a *brand*
 * colour — inventing a hue nobody chose is how a render stops looking like the
 * brand — and this invents nothing.
 */
function readableTypeOn(ground: string): string {
  const l = relativeLuminance(ground);
  if (l === null) return DEFAULT_TYPE;
  // Contrast against white is 1.05/(L+0.05); against black, (L+0.05)/0.05.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#FFFFFF' : '#0C0C0C';
}

/**
 * Resolves a kit to the two colours a renderer actually needs.
 *
 * A brand that named a second colour gets it as given — they can see their own
 * palette, and this is not the place to overrule it. A brand that named only a
 * ground gets black or white against it, whichever is more readable.
 *
 * That last part used to be `DEFAULT_TYPE` unconditionally, under a comment
 * saying contrast was deliberately not derived because "a wrong guess produces
 * white text on cream". The behaviour it described *was* white text on cream:
 * `DEFAULT_TYPE` is `#FFFFFF`, so a brand supplying a single light ground —
 * `#F5F0E6` is the case in the test below — rendered unreadable type and
 * published it without a word. Always picking white is as much a guess as
 * picking by luminance; it is just the guess that is wrong half the time.
 *
 * Deriving it cannot do worse than the constant on any input: for a dark ground
 * the luminance test returns `#FFFFFF`, which is what the constant gave anyway.
 */
export function resolveKit(kit: BrandKit | undefined): {
  ground: string;
  type: string;
  accent?: string;
  logoUrl?: string;
  /** CSS stack for headlines and text-only beats. Always a usable value. */
  displayFont: string;
  /** CSS stack for captions and running text. Always a usable value. */
  bodyFont: string;
  /** The faces the renderer has to fetch bytes for, deduped. Empty means "nothing to load". */
  fontFaces: BrandFontFace[];
} {
  const colors = kit?.colors ?? [];
  const ground = colors[0] ?? DEFAULT_GROUND;

  /**
   * The body face falls back to the display face rather than to the system
   * stack. A brand that named one font meant that font — rendering its headline
   * in Playfair and its caption in whatever the container has is worse than
   * rendering both in Playfair, and it is not what anyone picking one font
   * expected to happen.
   */
  const display = kit?.fonts?.display;
  const body = kit?.fonts?.body ?? display;

  const faces = [brandFont(display), brandFont(body)].filter((f): f is BrandFontFace => Boolean(f));

  return {
    ground,
    type: colors[1] ?? readableTypeOn(ground),
    ...(colors[2] ? { accent: colors[2] } : {}),
    ...(kit?.logoUrl ? { logoUrl: kit.logoUrl } : {}),
    displayFont: fontStack(display),
    bodyFont: fontStack(body),
    fontFaces: [...new Map(faces.map((f) => [f.id, f])).values()],
  };
}
