import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CarouselStoryboard, VideoStoryboard } from '@/components/command-center/draft-panel/Storyboard';
import type { ResolvedBeat } from '@/components/command-center/draft-panel/types';

/**
 * The storyboard, rendered.
 *
 * `DP video` and `DP carousel` draw a list nothing in the app can reach yet:
 * `content.draft` writes the beats, and by the time it has, the panel has moved
 * to its editor phase. So the scene and slide cards render correctly or they do
 * not, and until something routes a post with beats into this form, no amount
 * of clicking the running app would tell you which.
 *
 * `renderToStaticMarkup` rather than a DOM harness: this asserts what the cards
 * *say* — the time ranges, the badges, the fit note — and those are computed,
 * not styled. Geometry is checked against the prototype in the browser; the
 * arithmetic is checked here, where it is cheap and does not need jsdom.
 */

const scene = (over: Partial<ResolvedBeat> & { beatId: string }): ResolvedBeat =>
  ({ kind: 'generated_video', script: 'Line.', ...over }) as ResolvedBeat;

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el).replace(/<!--.*?-->/g, '');

describe('VideoStoryboard', () => {
  it('runs the clock forward across scenes rather than restarting each one', () => {
    const out = html(
      createElement(VideoStoryboard, {
        beats: [
          scene({ beatId: 'a', durationSec: 4, script: 'Your landing page is losing you money.' }),
          scene({ beatId: 'b', durationSec: 6, script: 'First mistake: your hero section.' }),
          scene({ beatId: 'c', durationSec: 14, script: 'Comment AUDIT.' }),
        ],
      }),
    );

    expect(out).toContain('0:00–0:04');
    expect(out).toContain('0:04–0:10');
    expect(out).toContain('0:10–0:24');
    expect(out).toContain('Scene 3');
  });

  it('shows the label and the kind as two separate badges', () => {
    const out = html(
      createElement(VideoStoryboard, {
        beats: [
          scene({ beatId: 'a', durationSec: 4, label: 'Hook' }),
          { kind: 'generated_broll', beatId: 'b', url: 'u', prompt: 'Stock footage.', durationSec: 6 },
        ],
      }),
    );

    expect(out).toContain('Hook');
    expect(out).toContain('Talking head');
    expect(out).toContain('B-roll + text overlay');
  });

  it('says a scene has no voiceover instead of drawing an empty script box', () => {
    const out = html(
      createElement(VideoStoryboard, {
        beats: [{ kind: 'text', beatId: 'a', text: 'Music only.', durationSec: 4 }],
      }),
    );

    expect(out).toContain('No voiceover');
    expect(out).toContain('runs without a voiceover');
    expect(out).not.toContain('Voiceover script');
  });

  /**
   * The note the design only ever drew as "fits scene length".
   *
   * A note that cannot say anything else is worth nothing, so the overrun case
   * is the one worth pinning: 30 words at ~2.6 w/s is ~11.5s, which does not
   * fit a four-second scene.
   */
  it('reports an overrunning script rather than always saying it fits', () => {
    const long = Array.from({ length: 30 }, () => 'word').join(' ');
    const fits = html(createElement(VideoStoryboard, { beats: [scene({ beatId: 'a', durationSec: 60, script: long })] }));
    const over = html(createElement(VideoStoryboard, { beats: [scene({ beatId: 'a', durationSec: 4, script: long })] }));

    expect(fits).toContain('fits scene length');
    expect(over).toContain('over by');
    expect(over).not.toContain('fits scene length');
  });

  it('omits a range for a legacy beat with no duration instead of showing 0:00', () => {
    const out = html(createElement(VideoStoryboard, { beats: [scene({ beatId: 'a' })] }));
    expect(out).toContain('Scene 1');
    expect(out).not.toContain('0:00');
  });

  it('hides the add-scene strip when there is no handler for it', () => {
    const without = html(createElement(VideoStoryboard, { beats: [scene({ beatId: 'a', durationSec: 4 })] }));
    const withIt = html(
      createElement(VideoStoryboard, { beats: [scene({ beatId: 'a', durationSec: 4 })], onAddScene: () => {} }),
    );

    expect(without).not.toContain('Add scene');
    expect(withIt).toContain('Add scene');
  });

  it('draws one line, not placeholder cards, when the post has no beats', () => {
    const out = html(createElement(VideoStoryboard, { beats: [] }));
    expect(out).toContain('The storyboard appears here');
    expect(out).not.toContain('Scene 1');
  });

  /**
   * The editor phase opens each card onto its `BeatRow`; the trigger phase has
   * nothing to open. A card that offered "Edit scene" with no `renderDetail`
   * would be the dead-control defect again, one layer down.
   */
  it('offers no way in when there is nothing to open', () => {
    const out = html(createElement(VideoStoryboard, { beats: [scene({ beatId: 'a', durationSec: 4 })] }));
    expect(out).not.toContain('Edit scene');
  });

  it('offers Edit scene, closed, when a detail is supplied', () => {
    const out = html(
      createElement(VideoStoryboard, {
        beats: [scene({ beatId: 'a', durationSec: 4 })],
        renderDetail: () => createElement('p', null, 'the controls'),
      }),
    );

    expect(out).toContain('Edit scene');
    // Closed on first render: `BeatRow` seeds its textarea on mount, so cards
    // are mounted on demand rather than kept open and hidden.
    expect(out).not.toContain('the controls');
  });

  it('keeps the add-scene form out of the way until its strip is used', () => {
    const out = html(
      createElement(VideoStoryboard, {
        beats: [scene({ beatId: 'a', durationSec: 4 })],
        onAddScene: () => {},
        addSlot: null,
      }),
    );

    expect(out).toContain('Add scene');
    expect(out).not.toContain('Seconds');
  });
});

describe('CarouselStoryboard', () => {
  it('numbers the slides and takes the title from the first sentence', () => {
    const out = html(
      createElement(CarouselStoryboard, {
        beats: [
          { kind: 'text', beatId: 'a', text: '5 signs your pipeline is leaking deals. Bold headline on brand.', label: 'Hook' },
          { kind: 'text', beatId: 'b', text: 'Sign 1: Stale opportunities. Stat callout.' },
        ],
      }),
    );

    expect(out).toContain('Slide 1');
    expect(out).toContain('Slide 2');
    expect(out).toContain('5 signs your pipeline is leaking deals');
    expect(out).toContain('Hook');
  });

  /**
   * A beat carries one string, and the card draws a headline and a note from
   * it. Every one-sentence slide printed that sentence twice — once in ink,
   * once in grey — until the note learned to be the remainder.
   */
  it('does not print a one-sentence slide twice', () => {
    const out = html(
      createElement(CarouselStoryboard, {
        beats: [{ kind: 'text', beatId: 'a', text: '5 signs your pipeline is leaking deals' }],
      }),
    );

    expect(out.match(/5 signs your pipeline is leaking deals/g)).toHaveLength(1);
  });

  it('keeps the layout note when the slide has one', () => {
    const out = html(
      createElement(CarouselStoryboard, {
        beats: [{ kind: 'text', beatId: 'a', text: 'Sign 1: Stale opportunities. Stat callout with a line chart.' }],
      }),
    );

    expect(out).toContain('Sign 1: Stale opportunities');
    expect(out).toContain('Stat callout with a line chart');
  });

  it('shows the slide image where the post has one', () => {
    const out = html(
      createElement(CarouselStoryboard, {
        beats: [{ kind: 'generated_image', beatId: 'a', url: 'https://example.test/s1.png', prompt: 'A chart.' }],
      }),
    );

    expect(out).toContain('https://example.test/s1.png');
  });

  it('draws one line when the post has no slides', () => {
    const out = html(createElement(CarouselStoryboard, { beats: [] }));
    expect(out).toContain('The slides appear here');
    expect(out).not.toContain('Slide 1');
  });

  it('offers Edit slide only when a detail is supplied', () => {
    const beats: ResolvedBeat[] = [{ kind: 'text', beatId: 'a', text: 'Hook line.' }];
    expect(html(createElement(CarouselStoryboard, { beats }))).not.toContain('Edit slide');
    expect(
      html(createElement(CarouselStoryboard, { beats, renderDetail: () => createElement('p', null, 'x') })),
    ).toContain('Edit slide');
  });
});

/**
 * Auto-illustration attaches media to a beat instead of replacing it, so an
 * illustrated post's beats keep `kind: 'text'` and carry the picture alongside.
 * Every render path tested `kind`, so those posts displayed as plain words —
 * seventeen beats' worth on the current database, all of them with a URL sitting
 * in the column.
 */
describe('backdrops', () => {
  it('shows a picture attached to a text beat', () => {
    const out = html(
      createElement(VideoStoryboard, {
        beats: [
          {
            kind: 'text',
            beatId: 'a',
            text: 'Weekend pastries.',
            durationSec: 4,
            backdrop: { kind: 'image', urls: ['https://example.test/one.jpg'] },
          },
        ],
      }),
    );

    expect(out).toContain('https://example.test/one.jpg');
  });

  it('reads the one-clip shape written before `urls` existed', () => {
    const out = html(
      createElement(VideoStoryboard, {
        beats: [
          {
            kind: 'text',
            beatId: 'a',
            text: 'Legacy.',
            durationSec: 4,
            backdropUrl: 'https://example.test/legacy.jpg',
            backdropKind: 'image',
          },
        ],
      }),
    );

    expect(out).toContain('https://example.test/legacy.jpg');
  });

  it('plays every clip of a long scene, not just the first', () => {
    const out = html(
      createElement(VideoStoryboard, {
        beats: [
          {
            kind: 'text',
            beatId: 'a',
            text: 'Fifty seconds.',
            durationSec: 50,
            backdrop: { kind: 'video', urls: ['a.mp4', 'b.mp4', 'c.mp4'] },
          },
        ],
      }),
    );

    for (const clip of ['a.mp4', 'b.mp4', 'c.mp4']) expect(out).toContain(clip);
  });

  it('uses the backdrop as a slide thumbnail rather than the role tint', () => {
    const out = html(
      createElement(CarouselStoryboard, {
        beats: [
          {
            kind: 'text',
            beatId: 'a',
            text: 'Cover slide.',
            backdrop: { kind: 'image', urls: ['https://example.test/slide.jpg'] },
          },
        ],
      }),
    );

    expect(out).toContain('https://example.test/slide.jpg');
  });
});
