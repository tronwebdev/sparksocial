import { describe, expect, it } from 'vitest';
import { thumbnailFor } from '../src/list.js';

/**
 * Which frame a list row shows itself by.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `content.list` carried a media *type* and nothing to look at, so a calendar
 * cell printed the word "Image" where the image should be. Reported as
 * "calendar cells still show no thumbnail", and it was not a rendering
 * omission — the data was never on the row.
 *
 * ── Portrait first, which is deliberate and is the opposite of the modal ──
 *
 * `previewFrame` in the Draft Review modal prefers 1:1 because that modal's
 * well is wide. A calendar tile is narrow, and the prototype's own post
 * thumbnail is 38x64 — 9:16. It is also the only place the vertical render
 * surfaces at all: `compose.render` produced one on every pass and nothing in
 * the product ever displayed it.
 */

const render = (aspect: string, storageUrl: string) => ({ aspect, storageUrl });

describe('thumbnailFor', () => {
  it('prefers the vertical render, which nothing else in the product shows', () => {
    const url = thumbnailFor(
      [render('1:1', 'https://r2.test/square.png'), render('9:16', 'https://r2.test/tall.png')],
      [],
    );

    expect(url).toBe('https://r2.test/tall.png');
  });

  it('falls back to whatever render exists when none is vertical', () => {
    expect(thumbnailFor([render('1:1', 'https://r2.test/square.png')], [])).toBe('https://r2.test/square.png');
  });

  it('prefers any render over a beat, because a render is the finished post', () => {
    const url = thumbnailFor([render('9:16', 'https://r2.test/tall.png')], [
      { kind: 'generated_image', url: 'https://r2.test/beat.png' },
    ] as never);

    expect(url).toBe('https://r2.test/tall.png');
  });

  /*
   * The case that is easy to miss: auto-illustration attaches a `backdrop` and
   * leaves the beat's `kind` as `text`, so matching on kind alone finds nothing
   * on a post that is fully illustrated.
   */
  it('finds auto-illustration behind a beat that still calls itself text', () => {
    const url = thumbnailFor([], [
      { kind: 'text', text: 'Weekend brunch', backdrop: { kind: 'image', urls: ['https://r2.test/brunch.png'] } },
    ] as never);

    expect(url).toBe('https://r2.test/brunch.png');
  });

  it('prefers a beat that is itself an image over a later backdrop', () => {
    const url = thumbnailFor([], [
      { kind: 'generated_image', url: 'https://r2.test/card.png' },
      { kind: 'text', backdrop: { kind: 'image', urls: ['https://r2.test/backdrop.png'] } },
    ] as never);

    expect(url).toBe('https://r2.test/card.png');
  });

  /*
   * A list cell cannot play a clip, and a `<video>` per cell is thirty clips
   * fetched to show stills. A video backdrop is therefore not a thumbnail.
   */
  it('does not offer a video backdrop as a thumbnail', () => {
    const url = thumbnailFor([], [
      { kind: 'text', backdrop: { kind: 'video', urls: ['https://r2.test/broll.mp4'] } },
    ] as never);

    expect(url).toBeUndefined();
  });

  it('has nothing for a slot that is planned but not yet written', () => {
    expect(thumbnailFor([], [])).toBeUndefined();
    expect(thumbnailFor([], [{ kind: 'text', text: 'words only' }] as never)).toBeUndefined();
  });
});
