import { describe, expect, it } from 'vitest';
import { previewFrame, type Visuals } from '../src/components/calendar/DraftReviewModal';

/**
 * Which single frame the Draft Review modal shows.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The modal asked for approval to publish an **Image** post and showed no
 * image. Measured on the deployed build against a real drafted post: two
 * finished Remotion renders in R2 (1:1 and 9:16) and a generated backdrop on
 * each beat, and the screen offering "Approve & Schedule" displayed a caption
 * and nothing else.
 *
 * Two causes, and the second is the interesting one:
 *
 *   * the modal read `content.list`, which carries a summary and no media, on
 *     the strength of a comment claiming no `content.get` existed. One does.
 *   * even given the beats, checking `kind` finds nothing — auto-illustration
 *     attaches a `backdrop` and deliberately leaves the beat as `text`, so a
 *     fully illustrated post looks textual to anything matching on kind.
 *
 * ── Why this is tested and the markup is not ─────────────────────────────
 *
 * The choice of frame is the part that can be wrong, and it is arithmetic over
 * a shape: renders before beats, square before vertical, backdrop as well as
 * kind. Rendering an `<img>` once a URL is in hand is not where the bug was.
 * `stageScale` and `typeScale` are tested here on the same reasoning.
 */

const render = (aspect: string, url: string) => ({ aspect, url, engine: 'remotion' });

describe('previewFrame', () => {
  it('prefers the composed render, because that file is the post', () => {
    const v: Visuals = {
      renders: [render('9:16', 'https://r2.test/tall.png'), render('1:1', 'https://r2.test/square.png')],
      beats: [{ kind: 'text', backdrop: { kind: 'image', urls: ['https://r2.test/backdrop.png'] } }],
    };

    // Square ahead of vertical: the modal's well is wider than it is tall.
    expect(previewFrame(v)).toEqual({ url: 'https://r2.test/square.png', kind: 'image' });
  });

  it('takes whatever render there is when none is square', () => {
    const v: Visuals = { renders: [render('9:16', 'https://r2.test/tall.png')] };
    expect(previewFrame(v)).toEqual({ url: 'https://r2.test/tall.png', kind: 'image' });
  });

  /*
   * The case that was actually broken. Auto-illustration attaches media and
   * leaves `kind` as `text`, so every branch that switched on kind fell
   * through and the post read as words only.
   */
  it('finds auto-illustration behind a beat that still calls itself text', () => {
    const v: Visuals = {
      beats: [{ kind: 'text', backdrop: { kind: 'image', urls: ['https://r2.test/brunch.png'] } }],
    };

    expect(previewFrame(v)).toEqual({ url: 'https://r2.test/brunch.png', kind: 'image' });
  });

  it('prefers a beat that is itself generated media over a later backdrop', () => {
    const v: Visuals = {
      beats: [
        { kind: 'generated_image', url: 'https://r2.test/card.png' },
        { kind: 'text', backdrop: { kind: 'image', urls: ['https://r2.test/backdrop.png'] } },
      ],
    };

    expect(previewFrame(v)).toEqual({ url: 'https://r2.test/card.png', kind: 'image' });
  });

  it('carries the backdrop kind through, so a clip is not shown in an img', () => {
    const v: Visuals = {
      beats: [{ kind: 'text', backdrop: { kind: 'video', urls: ['https://r2.test/broll.mp4'] } }],
    };

    expect(previewFrame(v)).toEqual({ url: 'https://r2.test/broll.mp4', kind: 'video' });
  });

  it('skips a beat with nothing on it and keeps looking', () => {
    const v: Visuals = {
      beats: [
        { kind: 'text' },
        { kind: 'generated_image' }, // declared, but no url yet
        { kind: 'text', backdrop: { kind: 'image', urls: ['https://r2.test/third.png'] } },
      ],
    };

    expect(previewFrame(v)).toEqual({ url: 'https://r2.test/third.png', kind: 'image' });
  });

  /*
   * A post with no picture must leave the section out rather than render an
   * empty frame — "not written yet" is a real and common state here, and an
   * empty bordered box reads as a broken image.
   */
  it('has nothing to show for a post with no media, and does not invent a frame', () => {
    expect(previewFrame({ beats: [{ kind: 'text' }] })).toBeUndefined();
    expect(previewFrame({ renders: [] })).toBeUndefined();
    expect(previewFrame({})).toBeUndefined();
    expect(previewFrame(null)).toBeUndefined();
  });
});
