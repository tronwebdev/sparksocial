import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, Video, registerRoot, Composition, type AnyZodObject } from 'remotion';
import { framesFor, resolveKit, type BrandKit, type TimedBeat } from './timeline.js';
import type { Watermark } from '@sparksocial/shared/brandKit';

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
    const el = h(Sequence, { key: beat.beatId, from, durationInFrames }, renderBeat(beat, kit, width));
    from += durationInFrames;
    return el;
  });
  return h(
    AbsoluteFill,
    { style: { backgroundColor: kit.ground } },
    /**
     * M4's fonts, as a stylesheet rather than a prop.
     *
     * Chromium resolves a family only if the page can load it, and the brand's
     * chosen face is not in the container. One `@font-face` per chosen family,
     * pointing at Google's CSS2 endpoint, is what makes `kit.displayFont` mean
     * anything — without it the stack falls straight through to `system-ui` and
     * the picker would be a control that changed nothing on video.
     *
     * `@import` inside a `<style>` rather than a `<link>`: Remotion renders this
     * tree, not a document, so there is no `<head>` to put a link in. A failed
     * fetch degrades to the system stack, which is the frame this composition
     * drew before fonts existed.
     */
    kit.fontFaces.length > 0
      ? h('style', {
          key: 'brand-fonts',
          dangerouslySetInnerHTML: {
            __html: kit.fontFaces
              .map(
                (f) =>
                  `@import url("https://fonts.googleapis.com/css2?family=${encodeURIComponent(
                    f.family,
                  ).replace(/%20/g, '+')}:wght@${f.weight}&display=block");`,
              )
              .join('\n'),
          },
        })
      : null,
    sequences,
    /**
     * Outside the sequences, so the mark is present for the whole video rather
     * than appearing and vanishing with each beat. That is also why it is not
     * rendered inside `renderBeat` the way Satori's still does it — a still has
     * one beat and no timeline to be inconsistent across.
     */
    kit.logoUrl && kit.watermark.enabled ? logoOverlay(kit.logoUrl, width, kit.watermark) : null,
  );
};

type ResolvedKit = ReturnType<typeof resolveKit>;

function renderBeat(beat: TimedBeat, kit: ResolvedKit, width: number): React.ReactElement {
  // Absent on an `audio` beat, which has no frame to superimpose onto.
  const lower = 'lowerThird' in beat && beat.lowerThird ? lowerThirdOverlay(beat.lowerThird, kit, width) : null;
  if (beat.kind === 'image') {
    return h(
      AbsoluteFill,
      null,
      h(Img, { src: beat.url, style: { width: '100%', height: '100%', objectFit: 'cover' } }),
      beat.caption ? captionOverlay(beat.caption, kit.type, kit.bodyFont) : null,
      lower,
    );
  }
  if (beat.kind === 'video') {
    return h(
      AbsoluteFill,
      null,
      /*
       * `loop`, for the same reason `videoBackdrop` loops.
       *
       * The clip and the beat are sized by different things: the beat's length
       * comes from the playbook, the clip's from whatever the generator would
       * sell — Kling takes `'5'` or `'10'` and nothing else. A thirty-second
       * body beat handed a ten-second clip played the footage once and then
       * held the last frame for twenty seconds, which reads as a video that
       * froze rather than as a short shot. Looping is the smaller lie, and it
       * is what the multi-clip path next to this one already does.
       */
      h(Video, { src: beat.url, loop: true, style: { width: '100%', height: '100%', objectFit: 'cover' } }),
      beat.caption ? captionOverlay(beat.caption, kit.type, kit.bodyFont) : null,
      lower,
    );
  }
  if (beat.kind === 'audio') {
    // No visual — a narration/VO track meant to underlay the composition.
    return h(Audio, { src: beat.url });
  }
  // kind === 'text'
  /*
   * A backdrop, when auto-illustration found or made one.
   *
   * Behind the words rather than instead of them: the beat *is* the post's
   * copy, so a brand with no footage used to get white type on a flat ground
   * for every post in its calendar — correct, and indistinguishable from a
   * placeholder.
   *
   * The scrim is not decoration. Type sits on arbitrary photography here, and
   * generated imagery is exactly where a light patch lands under white text
   * with nobody checking. Same reasoning, and the same neutral treatment, as
   * `captionOverlay` below.
   */
  const backdrop = beat.backdrop
    ? [
        beat.backdrop.kind === 'video'
          ? videoBackdrop(beat.backdrop.urls, beat.durationSec)
          : h(Img, { src: beat.backdrop.urls[0]!, style: FILL }),
        /*
         * Only under type. The scrim's whole job is legibility, so a frame with
         * no words on it gets the picture at full strength — darkening a
         * photograph by 45% for text that is not there was making every still
         * post muddier than the image it was given.
         */
        beat.text
          ? h('div', { style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' } })
          : null,
      ]
    : [];

  /*
   * Two layers, not one.
   *
   * The first version put the backdrop inside the padded, centred box that
   * holds the words, so the picture was inset by the padding and the text was
   * pushed down onto the watermark — a letterboxed photograph with the copy
   * sitting in the margin. The backdrop is full-bleed and the type layer sits
   * on top of it; only the type is padded.
   */
  return h(
    AbsoluteFill,
    null,
    ...backdrop,
    /*
     * The narration, if this beat has one.
     *
     * Rendered inside the beat's own sequence, so it starts when the scene does
     * and stops when it ends — the alternative, a post-wide track, drifts out of
     * sync the moment a scene is retimed or reordered.
     */
    beat.voiceoverUrl ? h(Audio, { src: beat.voiceoverUrl }) : null,
    /*
     * The words, when they belong in the frame.
     *
     * `zipTimeline` blanks this for a still post that has a picture: there the
     * copy is the caption the platform prints beneath the image, and printing
     * it across the photograph as well showed the same sentence twice. An empty
     * string would still render a padded, centred, invisible div over the
     * backdrop, so the layer is omitted rather than emptied.
     */
    beat.text
      ? h(
          AbsoluteFill,
          { style: { justifyContent: 'center', alignItems: 'center', padding: 80 } },
          h(
            'div',
            {
              style: {
                // Over a photograph the brand's type colour is a coin flip; white
                // on the scrim is legible whatever the picture turned out to be.
                color: beat.backdrop ? '#FFFFFF' : kit.type,
                fontSize: 64,
                fontFamily: kit.displayFont,
                textAlign: 'center',
                lineHeight: 1.3,
              },
            },
            beat.text,
          ),
        )
      : null,
    lower,
  );
}

/** The scrim stays neutral for the same reason as Satori's: legibility over arbitrary photography. */
function captionOverlay(caption: string, typeColor: string, bodyFont: string): React.ReactElement {
  return h(
    AbsoluteFill,
    { style: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 96 } },
    h(
      'div',
      {
        style: {
          color: typeColor,
          fontSize: 40,
          fontFamily: bodyFont,
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
 * Bottom-left — same placement and reasoning as `satori-runner.ts`'s `logoNode`,
 * which is also where the argument against making the corner configurable lives.
 *
 * Size and opacity now come from the brand's watermark settings rather than being
 * fixed at 12% and fully opaque. The caller gates on `enabled`, so reaching this
 * function already means a mark should be drawn.
 */
function logoOverlay(url: string, width: number, mark: Watermark): React.ReactElement {
  return h(
    AbsoluteFill,
    { style: { justifyContent: 'flex-end', alignItems: 'flex-start', padding: Math.round(width * 0.06) } },
    h(Img, { src: url, style: { width: Math.round(width * mark.scale), opacity: mark.opacity } }),
  );
}

/**
 * The lower-third — a superimposed line, stacked *above* the caption slot.
 *
 * Both live in the bottom region, and a lower-third that overlapped the caption
 * would make each unreadable on any beat that has both. So the caption keeps its
 * 96px inset and this sits at 200px, left-aligned rather than centred, which is
 * what distinguishes a name plate from a subtitle at a glance.
 *
 * The accent bar is the one place a brand's third colour is used structurally
 * rather than decoratively — it is what makes the strip read as the brand's
 * rather than as a generic caption. Falls back to the type colour, so a brand
 * with one colour still gets a bar rather than an invisible one.
 */
function lowerThirdOverlay(text: string, kit: ResolvedKit, width: number): React.ReactElement {
  return h(
    AbsoluteFill,
    { style: { justifyContent: 'flex-end', alignItems: 'flex-start', paddingBottom: 200, paddingLeft: Math.round(width * 0.06) } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'stretch', maxWidth: '82%' } },
      h('div', { style: { width: 8, background: kit.accent ?? kit.type, flexShrink: 0 } }),
      h(
        'div',
        {
          style: {
            color: kit.type,
            fontSize: 36,
            fontFamily: kit.displayFont,
            background: 'rgba(12,12,12,0.62)',
            padding: '14px 24px',
            lineHeight: 1.2,
          },
        },
        text,
      ),
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
    defaultProps: { beats: [] as TimedBeat[], width: 1080, height: 1920, brandKit: undefined as BrandKit | undefined },
    calculateMetadata: ({ props }) => ({
      durationInFrames: framesFor(props.beats),
      width: props.width,
      height: props.height,
    }),
  });
}

registerRoot(BeatsRoot);

/** Cover the frame, whatever the clip's own aspect turned out to be. */
const FILL = { width: '100%', height: '100%', objectFit: 'cover' } as const;

/**
 * Several clips across one beat, rather than one clip looped under it.
 *
 * The clip generator caps at ten seconds and a narration beat can be five
 * times that. One clip stretched over it loops the same five seconds ten
 * times, which does not read as footage — it reads as a video that is broken.
 *
 * The beat is divided evenly between whatever clips there are, so N of them
 * always cover it however long it is, and each still loops inside its own span
 * if it is shorter than its share. That is a much smaller lie: a two-second
 * shot repeating twice inside its own eight seconds is how b-roll is cut
 * anyway.
 */
function videoBackdrop(urls: string[], durationSec: number): React.ReactElement {
  const total = Math.max(1, Math.round(durationSec * FPS));
  if (urls.length === 1) {
    return h(Video, { src: urls[0]!, loop: true, muted: true, style: FILL });
  }

  const each = Math.max(1, Math.floor(total / urls.length));
  return h(
    AbsoluteFill,
    null,
    ...urls.map((url, i) =>
      h(
        Sequence,
        {
          key: `${url}-${i}`,
          from: i * each,
          // The last one absorbs the rounding, so the beat is covered to its
          // final frame rather than flickering to the ground colour at the end.
          durationInFrames: i === urls.length - 1 ? Math.max(1, total - i * each) : each,
        },
        h(Video, { src: url, loop: true, muted: true, style: FILL }),
      ),
    ),
  );
}
