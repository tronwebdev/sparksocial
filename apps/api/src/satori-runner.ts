import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ToolError } from '@sparksocial/shared';
import type { StaticRunner } from '@sparksocial/compose';
import type { TimedBeat } from '@sparksocial/compose';

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
 * the repo. `apps/web/src/fonts/AsgardTrial-FitBold.ttf` is the brand's own
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
const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(__dirname, '../../web/src/fonts/AsgardTrial-FitBold.ttf');
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
function beatToNode(beat: TimedBeat | undefined, width: number, height: number): SatoriNode {
  const base = { display: 'flex', width, height, backgroundColor: '#0C0C0C' };

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
      beat.kind === 'image' && 'caption' in beat && beat.caption ? captionNode(beat.caption) : el('div', {}),
    );
  }
  // kind === 'text'
  return el(
    'div',
    {
      style: {
        ...base,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
        textAlign: 'center',
      },
    },
    el('div', { style: { color: '#FFFFFF', fontSize: 64, fontFamily: FONT_NAME, lineHeight: 1.3 } }, beat.text),
  );
}

function captionNode(caption: string): SatoriNode {
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
          fontFamily: FONT_NAME,
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
    async renderStill({ beats, width, height }) {
      const font = await getFont();
      const node = beatToNode(beats[0], width, height);

      let svg: string;
      try {
        svg = await satori(node as never, {
          width,
          height,
          fonts: [{ name: FONT_NAME, data: font, weight: 400, style: 'normal' }],
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
