import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platformTakes } from '@sparksocial/shared';

const read = (rel: string) => readFileSync(join(process.cwd(), 'apps/web/src/components/command-center/draft-panel', rel), 'utf8');

/** Source with the comments taken out — they quote the bugs by name. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const PREVIEW = code('PostPreview.tsx');
const PANEL = code('DraftPanel.tsx');
const DRAWER = code('DraftDrawer.tsx');

/**
 * Three things the panel said that were not true of the post in it.
 *
 * All three were reported from the deployed site, and all three are the same
 * shape: a control or a view that ignores the draft's own format.
 */
describe('a carousel previews as a carousel', () => {
  /*
   * `mediaOf` took `renders[0]` for every format. For a video that is the
   * composed cut and correct; a carousel's renders are its slides, so the
   * first one is slide 1 and the other five were dropped. A six-slide post
   * previewed as a single image, which is how it was reported.
   */
  it('keeps every slide of a rendered carousel', () => {
    expect(PREVIEW).toContain("draft.mediaType === 'carousel' ? rendered : rendered.slice(0, 1)");
  });

  it('shows one slide at a time, with both ways to move', () => {
    expect(PREVIEW).toContain('CarouselDeck');
    expect(PREVIEW).toContain('aria-roledescription="carousel"');
    expect(PREVIEW).toContain('Previous slide');
    expect(PREVIEW).toContain('Go to slide');
    // Keyboard, because six slides is six clicks at a 28px target otherwise.
    expect(PREVIEW).toContain("e.key === 'ArrowRight'");
  });

  it('still stacks media that is a set rather than a sequence', () => {
    expect(PREVIEW).toContain('grid grid-cols-1 gap-[10px]');
  });
});

describe('there is one "Publish to"', () => {
  it('lives in the preview, where the caption it must fit is', () => {
    expect(PREVIEW).toContain('Publish to');
    expect(PREVIEW).toContain('onSelect(p)');
  });

  it('is gone from the panel, which had the second one', () => {
    // The panel kept a row of buttons under its own identical heading.
    expect(PANEL).not.toMatch(/Publish to<\/p>/);
    expect(PANEL).not.toContain('{PLATFORMS.map((p) => (');
  });

  it('greys out a platform that cannot carry the format, and says why', () => {
    expect(PREVIEW).toContain('platformTakes');
    expect(PREVIEW).toContain('disabled={!takes.ok}');
  });
});

describe('the format table', () => {
  it('refuses a carousel where the platform has no such post', () => {
    expect(platformTakes('x', 'carousel').ok).toBe(false);
    expect(platformTakes('youtube_shorts', 'image').ok).toBe(false);
  });

  /*
   * TikTok publishes photo carousels; our adapter only implements the video
   * flow and says so in its own header. The reason string has to own that
   * rather than blame TikTok.
   */
  it('owns our own gap instead of blaming the platform', () => {
    const r = platformTakes('tiktok', 'carousel');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/aren't wired up yet/);
  });

  it('allows what it has no opinion about', () => {
    expect(platformTakes('reddit', 'text').ok).toBe(true);
    expect(platformTakes('instagram', 'carousel').ok).toBe(true);
  });
});

describe('the post-type rail reports once a draft is open', () => {
  it('disables the formats this draft is not', () => {
    expect(DRAWER).toContain('disabled={fixed && !on}');
    expect(DRAWER).toContain('cursor-not-allowed');
  });

  it('points at repurpose, which is the operation that actually exists', () => {
    expect(DRAWER).toMatch(/repurpose/i);
  });

  it('is only fixed when there is a draft to fix it to', () => {
    expect(PANEL).toContain('typeFixed={draft !== null && draft !== undefined}');
  });
});

/**
 * The preview's layout, which was one prototype applied to four formats.
 *
 * Measured at the 1728 stage: `prevText` is a single column — "Post preview"
 * 821,147, engagement row y543, counts y609. `prevImage` and `prevCarousel`
 * are two — media 822,184 in a 324x405 frame, and a 493-wide column from
 * x1195. Both media prototypes agree to the pixel, so it is one layout for
 * both and not a carousel special case.
 */
describe('the preview follows the prototype for its own format', () => {
  it('splits media posts into the design’s two columns', () => {
    expect(PREVIEW).toContain("const twoColumn = draft.mediaType !== 'text'");
    // 324 + 49 + 493 = 866 on an 868-wide pane.
    expect(PREVIEW).toContain('gap-[49px]');
    expect(PREVIEW).toContain('w-[324px] shrink-0');
  });

  it('stacks them below the canvas width instead of squeezing', () => {
    expect(PREVIEW).toContain('max-canvas:flex-col');
  });

  it('keeps the post card for text, which is what its prototype draws', () => {
    expect(PREVIEW).toContain('PostCard');
    expect(PREVIEW).toContain("'Like', 'Comment', 'Share'");
  });

  it('heads the phase the way the design does', () => {
    expect(PREVIEW).toContain('Review your post');
    // "Generated" is true of a post with pixels and false of one without, so
    // it is read rather than printed.
    expect(PREVIEW).toContain("media.length > 0 ? 'Generated'");
  });
});

describe('the editor says what the draft is', () => {
  it('carries the title, the format and the meta row', () => {
    expect(PANEL).toContain('postTitle(draft)');
    expect(PANEL).toContain('{draft.mediaType} Post');
    expect(PANEL).toContain('Brand template');
  });

  it('prefers the post’s own first line to the placeholder', () => {
    expect(PANEL).toContain("return 'Untitled Post';");
    expect(PANEL).toContain("b.kind === 'text' && b.text.trim()");
  });
});
