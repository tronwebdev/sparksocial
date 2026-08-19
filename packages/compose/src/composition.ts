import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, Video, registerRoot, Composition, type AnyZodObject } from 'remotion';
import { framesFor, type TimedBeat } from './timeline.js';

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
}

export const BeatComposition: React.FC<BeatCompositionProps> = ({ beats }) => {
  let from = 0;
  const sequences = beats.map((beat) => {
    const durationInFrames = Math.max(1, Math.round(beat.durationSec * FPS));
    const el = h(Sequence, { key: beat.beatId, from, durationInFrames }, renderBeat(beat));
    from += durationInFrames;
    return el;
  });
  return h(AbsoluteFill, { style: { backgroundColor: '#0C0C0C' } }, sequences);
};

function renderBeat(beat: TimedBeat): React.ReactElement {
  if (beat.kind === 'image') {
    return h(
      AbsoluteFill,
      null,
      h(Img, { src: beat.url, style: { width: '100%', height: '100%', objectFit: 'cover' } }),
      beat.caption ? captionOverlay(beat.caption) : null,
    );
  }
  if (beat.kind === 'video') {
    return h(
      AbsoluteFill,
      null,
      h(Video, { src: beat.url, style: { width: '100%', height: '100%', objectFit: 'cover' } }),
      beat.caption ? captionOverlay(beat.caption) : null,
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
      { style: { color: '#FFFFFF', fontSize: 64, fontFamily: 'sans-serif', textAlign: 'center', lineHeight: 1.3 } },
      beat.text,
    ),
  );
}

function captionOverlay(caption: string): React.ReactElement {
  return h(
    AbsoluteFill,
    { style: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 96 } },
    h(
      'div',
      {
        style: {
          color: '#FFFFFF',
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
    defaultProps: { beats: [] as TimedBeat[], width: 1080, height: 1920 },
    calculateMetadata: ({ props }) => ({
      durationInFrames: framesFor(props.beats),
      width: props.width,
      height: props.height,
    }),
  });
}

registerRoot(BeatsRoot);
