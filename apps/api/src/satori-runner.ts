import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ToolError } from '@sparksocial/shared';
import type { StaticRunner } from '@sparksocial/compose';
import type { BrandKit, TimedBeat } from '@sparksocial/compose';
import { resolveKit } from '@sparksocial/compose';
import { loadBrandFonts } from './font-loader.js';

/**
 * SATORI, ACTUALLY EXECUTED — `compose.static`'s render step.
 *
 * No browser, no bundler, no separate composition file to `bundle()` the way
 * `remotion-runner.ts` needs — Satori takes a plain JSX-shaped element tree
 * (built here, not registered anywhere) and rasterizes it to SVG in-process;
 * `@resvg/resvg-js` (a native binding, no headless Chrome) turns that SVG
 * into a PNG buffer. The whole thing is one function call, not a subprocess.
 *
 * ── The font ─────────────────────────────────────────────────────────────
 * Satori cannot use system fonts — it needs real font bytes up front, same
 * requirement `content.generate_image`'s "no fake fallback" reasoning would
 * apply to if this were a font *lookup* instead of a static asset already in
 * the repo. `apps/api/assets/fonts/AsgardTrial-FitBold.ttf` is the brand's own
 * display face (`compose.render`'s own doc comment says Remotion applies
 * "the brand's own type and layout" — this is that same identity, not a
 * generic placeholder), confirmed to actually parse: `Onest-Variable.ttf`
 * (the brand's other, variable-weight font) fails inside Satori's font
 * parser — empirically, not theoretically, checked directly against this
 * exact package before picking a font, the same "confirmed feasible in this
 * environment" posture `remotion-runner.ts`'s own comment takes for Chrome.
 * Loaded once and cached, same pattern `remotion-runner.ts` uses for its
 * bundle.
 */
/*
 * ── Why the font lives in this app and not the web one ───────────────────
 *
 * This read `../../web/src/fonts/AsgardTrial-FitBold.ttf`, which works in a
 * checkout and does not exist in the deployed image: `apps/api/Dockerfile`
 * copies `packages` and `apps/api`, and nothing else. Every static render in
 * production failed with `ENOENT ... /app/apps/web/src/fonts/...` — so no
 * image or carousel has ever been rendered there, and the Draft Panel has
 * only ever had per-beat generated media to show.
 *
 * It failed quietly, too: `content.get` wraps its render read in
 * `.catch(() => [])` and `content.list` falls back to a beat's own image, so
 * "no renders exist" and "the renderer is broken" look identical from the UI.
 *
 * The real defect is the layering: `apps/api` reaching into `apps/web` for an
 * asset is a dependency nothing in the build or the type system can see, and
 * the Dockerfile is free to stop satisfying it without any test noticing. The
 * API owns its own copy now, so the path cannot drift from what ships.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(__dirname, '../assets/fonts/AsgardTrial-FitBold.ttf');
const FONT_NAME = 'AsgardFit';

let fontData: Promise<Buffer> | undefined;
const getFont = () => (fontData ??= readFile(FONT_PATH));

/**
 * Satori's element shape — a JSX tree without JSX syntax, same
 * `React.createElement` posture `composition.ts` takes for the same reason
 * (no JSX support in this monorepo's root tsconfig). A child is either
 * another element or a plain string — exactly what real JSX compiles text
 * content down to (`<div>{text}</div>` → `createElement('div', null, text)`),
 * not a synthetic `{type:'text',...}` wrapper; Satori's parser choked on that
 * wrapper (empirically — "more than one child" from a node that should have
 * had exactly one) until this was fixed to pass strings straight through.
 */
type SatoriChild = SatoriNode | string;
type SatoriNode = { type: string; props: Record<string, unknown> };
const el = (type: string, props: Record<string, unknown>, ...children: SatoriChild[]): SatoriNode => ({
  type,
  props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) },
});

/**
 * One beat, one frame — unlike Remotion's `Sequence`-based timeline, Satori
 * has no concept of time at all, so this renders only the FIRST beat, same
 * "frame 0" semantics `compose.render`'s `renderStill` call already applies
 * (a still is one frame; a beat list longer than one only matters for a
 * carousel's per-beat calls, which `compose.static`'s own handler already
 * makes one at a time).
 */
/**
 * §8.6's "Apply Brand Kit", drawn.
 *
 * `resolveKit` decides what the palette *means* (ground, type, accent by
 * position) so this file and the Remotion composition cannot disagree about it.
 * What is left here is where those colours go, and the answer is deliberately
 * conservative: the ground replaces the hardcoded near-black, the type colour
 * replaces the hardcoded white, and the logo is a corner mark. No tinting of
 * photography, no coloured overlays on video frames — a brand colour applied to
 * somebody's product photo is a ruined product photo, and §8.6 asks for a kit
 * applied, not a filter.
 */
function beatToNode(beat: TimedBeat | undefined, width: number, height: number, kit?: BrandKit): SatoriNode {
  const { ground, type: typeColor, logoUrl, displayFont, bodyFont } = resolveKit(kit);
  const base = { display: 'flex', width, height, backgroundColor: ground };
  /**
   * The vendored face is appended to each stack rather than replacing it, so a
   * brand that chose nothing still renders in the face this runner has always
   * used and a brand that chose something gets it with a working backstop.
   */
  const display = `${displayFont}, ${FONT_NAME}`;
  const body = `${bodyFont}, ${FONT_NAME}`;

  if (!beat || beat.kind === 'audio') {
    return el('div', { style: base });
  }
  if (beat.kind === 'image' || beat.kind === 'video') {
    // Satori has no <video> — a video-kind beat reaching this path (an asset
    // beat whose media happens to be video, rendered for a still) shows its
    // URL as a poster-frame placeholder rather than crashing; `compose.static`
    // refuses `video` media-type playbooks outright, so this is a defensive
    // fallback for a mixed-media asset beat only, not the expected path.
    return el(
      'div',
      { style: { ...base, position: 'relative' } },
      el('img', { src: beat.url, width, height, style: { objectFit: 'cover' } }),
      beat.kind === 'image' && 'caption' in beat && beat.caption
        ? captionNode(beat.caption, body)
        : el('div', {}),
      logoUrl ? logoNode(logoUrl, width) : el('div', {}),
    );
  }
  /*
    ── A text beat whose words were moved into the picture ─────────────────

    `zipTimeline` blanks a still's copy when the beat has a backdrop, and says
    why: "a still post's copy is its caption — the platform prints it under the
    image — so burning it across the photograph shows the same sentence twice
    and ruins the picture to do it." Sound reasoning, and it hands this
    function a beat with `text: ''` and a `backdrop`.

    This file never looked at `backdrop`. So the words were dropped because the
    picture would carry them, and the picture was never drawn: four of the six
    slides of the first carousel rendered in production came back as empty
    brand-coloured frames with a logo in the corner. The two that rendered
    their words were the two with no backdrop.

    Measured on the deployed post: beats 1-4 carry backdrops and rendered
    blank, beats 5-6 do not and rendered their text. Locally, Satori lays out
    all six strings perfectly — it was never a text problem.

    The fallback matters as much as the fix. A beat with neither words nor a
    usable picture renders its original copy rather than nothing: an empty
    frame is the one output that is wrong under every interpretation.
  */
  const backdrop = 'backdrop' in beat ? beat.backdrop : undefined;
  if (beat.kind === 'text' && backdrop?.kind === 'image' && backdrop.urls[0]) {
    return el(
      'div',
      { style: { ...base, position: 'relative' } },
      el('img', { src: backdrop.urls[0], width, height, style: { objectFit: 'cover' } }),
      logoUrl ? logoNode(logoUrl, width) : el('div', {}),
    );
  }

  // kind === 'text'
  return el(
    'div',
    {
      style: {
        ...base,
        position: 'relative',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
        textAlign: 'center',
      },
    },
    /*
      `originalText` where the beat has been blanked and has no picture to
      carry it — see the backdrop note above. A video backdrop lands here too:
      Satori cannot draw one, and the words are a better frame than nothing.
    */
    el(
      'div',
      { style: { color: typeColor, fontSize: 64, fontFamily: display, lineHeight: 1.3 } },
      beat.text || ('originalText' in beat ? (beat.originalText as string) : '') || '',
    ),
    logoUrl ? logoNode(logoUrl, width) : el('div', {}),
  );
}

/**
 * The mark, bottom-left, at 12% of the frame width.
 *
 * Bottom-left rather than a corner a platform decorates: TikTok and Reels both
 * put controls and captions bottom-right, and a top corner collides with the
 * account header. 12% is small enough not to compete with the content and large
 * enough to survive a feed-sized thumbnail.
 *
 * Satori cannot measure a remote image, so the height is `auto` with only the
 * width constrained — a fixed box would squash any logo that is not square, and
 * a wordmark squashed to a square is worse than no mark.
 */
function logoNode(url: string, width: number): SatoriNode {
  return el('div', {
    style: {
      display: 'flex',
      position: 'absolute',
      left: Math.round(width * 0.06),
      bottom: Math.round(width * 0.06),
    },
  }, el('img', { src: url, width: Math.round(width * 0.12) }));
}

/**
 * The scrim behind a caption stays neutral even with a kit applied: its job is
 * legibility over arbitrary photography, and a brand-coloured scrim on a photo
 * that happens to be the same hue makes the caption vanish.
 *
 * The letters are white for the same reason. They took the kit's type colour,
 * which is chosen to read on the brand's *ground* — a dark type colour (a
 * near-black, a deep purple) on this 55% black scrim is the unreadable caption
 * the scrim exists to prevent.
 */
function captionNode(caption: string, bodyFont: string): SatoriNode {
  return el(
    'div',
    {
      style: {
        display: 'flex',
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        justifyContent: 'center',
        paddingBottom: 96,
      },
    },
    el(
      'div',
      {
        style: {
          display: 'flex',
          color: '#FFFFFF',
          fontSize: 40,
          fontFamily: bodyFont,
          background: 'rgba(12,12,12,0.55)',
          padding: '16px 32px',
          borderRadius: 12,
        },
      },
      caption,
    ),
  );
}

export interface SatoriRunnerOptions {
  /** Where finished renders are uploaded. Without it, returns `data:` URIs — fine for dev, not for a real deploy. */
  publish?: (buffer: Buffer, kind: 'image') => Promise<string>;
}

export function createSatoriRunner(opts: SatoriRunnerOptions = {}): StaticRunner {
  return {
    async renderStill({ beats, width, height, brandKit }) {
      const font = await getFont();
      const node = beatToNode(beats[0], width, height, brandKit);

      /**
       * M4: the brand's own faces, fetched as bytes, with the vendored face
       * always present behind them.
       *
       * Order matters to Satori — it draws a glyph with the first font in the
       * list that has it — so the brand's faces come first and the vendored one
       * is the backstop for anything they are missing. Keeping it in the list
       * rather than swapping it out is what makes a font fetch that failed, or a
       * glyph the chosen face does not carry, render *something* instead of a
       * missing-glyph box.
       */
      const brandFonts = await loadBrandFonts(resolveKit(brandKit).fontFaces);

      let svg: string;
      try {
        svg = await satori(node as never, {
          width,
          height,
          fonts: [
            ...brandFonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight as 400, style: 'normal' as const })),
            { name: FONT_NAME, data: font, weight: 400, style: 'normal' },
          ],
        });
      } catch (e) {
        throw new ToolError('UPSTREAM_FAILED', `Satori render failed: ${e instanceof Error ? e.message : String(e)}`, {});
      }

      const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
      const png = resvg.render().asPng();

      return opts.publish ? await opts.publish(png, 'image') : `data:image/png;base64,${png.toString('base64')}`;
    },
  };
}
