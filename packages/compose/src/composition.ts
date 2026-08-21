import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, Video, registerRoot, Composition, type AnyZodObject } from 'remotion';
import { framesFor, resolveKit, type BrandKit, type TimedBeat } from './timeline.js';

/**
 * The one Remotion composition every playbook renders through — plan §6.5's
 * "beats map 1:1 onto Remotion composition props" taken literally. A new
 * playbook is a new beat-list data record, never a new composition: this file
 * does not know what a playbook is.
 *
 * `.ts`, not `.tsx` — the monorepo's root `tsconfig.json` has no JSX support
 * (`apps/web` carries its own for exactly this reason), and adding one for a
 * single package would risk the same "next dev rewrites the config" class of
 * problem CLAUDE.md already called out. `React.createElement` needs none of
 * that.
 */

const FPS = 30;
const h = React.createElement;

export interface BeatCompositionProps extends Record<string, unknown> {
  beats: TimedBeat[];
  width: number;
  height: number;
  /**
   * §8.6's "Apply Brand Kit". A prop rather than a bundle-time constant,
   * because it varies per brand and the bundle is shared — see
   * `remotion-runner.ts`'s comment on why the bundle is cached.
   */
  brandKit?: BrandKit;
}

export const BeatComposition: React.FC<BeatCompositionProps> = ({ beats, width, brandKit }) => {
  const kit = resolveKit(brandKit);
  let from = 0;
  const sequences = beats.map((beat) => {
    const durationInFrames = Math.max(1, Math.round(beat.durationSec * FPS));
    const el = h(Sequence, { key: beat.beatId, from, durationInFrames }, renderBeat(beat, kit));
    from += durationInFrames;
    return el;
  });
  return h(
    AbsoluteFill,
    { style: { backgroundColor: kit.ground } },
    sequences,
    /**
     * Outside the sequences, so the mark is present for the whole video rather
     * than appearing and vanishing with each beat. That is also why it is not
     * rendered inside `renderBeat` the way Satori's still does it — a still has
     * one beat and no timeline to be inconsistent across.
     */
    kit.logoUrl ? logoOverlay(kit.logoUrl, width) : null,
  );
};

type ResolvedKit = ReturnType<typeof resolveKit>;

function renderBeat(beat: TimedBeat, kit: ResolvedKit): React.ReactElement {
  if (beat.kind === 'image') {
    return h(
      AbsoluteFill,
      null,
      h(Img, { src: beat.url, style: { width: '100%', height: '100%', objectFit: 'cover' } }),
      beat.caption ? captionOverlay(beat.caption, kit.type) : null,
    );
  }
  if (beat.kind === 'video') {
    return h(
      AbsoluteFill,
      null,
      h(Video, { src: beat.url, style: { width: '100%', height: '100%', objectFit: 'cover' } }),
      beat.caption ? captionOverlay(beat.caption, kit.type) : null,
    );
  }
  if (beat.kind === 'audio') {
    // No visual — a narration/VO track meant to underlay the composition.
    return h(Audio, { src: beat.url });
  }
  // kind === 'text'
  return h(
    AbsoluteFill,
    { style: { justifyContent: 'center', alignItems: 'center', padding: 80 } },
    h(
      'div',
      { style: { color: kit.type, fontSize: 64, fontFamily: 'sans-serif', textAlign: 'center', lineHeight: 1.3 } },
      beat.text,
    ),
  );
}

/** The scrim stays neutral for the same reason as Satori's: legibility over arbitrary photography. */
function captionOverlay(caption: string, typeColor: string): React.ReactElement {
  return h(
    AbsoluteFill,
    { style: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 96 } },
    h(
      'div',
      {
        style: {
          color: typeColor,
          fontSize: 40,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          background: 'rgba(12,12,12,0.55)',
          padding: '16px 32px',
          borderRadius: 12,
          maxWidth: '80%',
        },
      },
      caption,
    ),
  );
}

/** Bottom-left at 12% of frame width — same placement and reasoning as `satori-runner.ts`'s `logoNode`. */
function logoOverlay(url: string, width: number): React.ReactElement {
  return h(
    AbsoluteFill,
    { style: { justifyContent: 'flex-end', alignItems: 'flex-start', padding: Math.round(width * 0.06) } },
    h(Img, { src: url, style: { width: Math.round(width * 0.12) } }),
  );
}

/**
 * The bundler's entry point (`apps/api/src/remotion-runner.ts`). A single
 * dynamic composition, `id: 'beats'`, sized from props at bundle-select time
 * via `calculateMetadata` — one entry serves every aspect ratio and beat list
 * rather than registering a composition per render.
 */
export function BeatsRoot(): React.ReactElement | null {
  // Called directly rather than through `React.createElement` — `Composition`
  // is a plain generic function (`<Schema, Props>(props) => JSX.Element`), not
  // a component type, and going through `createElement`'s overloads loses the
  // inference it needs to type `calculateMetadata` against `BeatCompositionProps`.
  return Composition<AnyZodObject, BeatCompositionProps>({
    id: 'beats',
    component: BeatComposition,
    durationInFrames: FPS, // placeholder; calculateMetadata overrides per-render
    fps: FPS,
    width: 1080,
    height: 1920,
    defaultProps: { beats: [] as TimedBeat[], width: 1080, height: 1920, brandKit: undefined as BrandKit | undefined },
    calculateMetadata: ({ props }) => ({
      durationInFrames: framesFor(props.beats),
      width: props.width,
      height: props.height,
    }),
  });
}

registerRoot(BeatsRoot);
