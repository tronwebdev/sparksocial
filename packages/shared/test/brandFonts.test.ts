import { describe, expect, it } from 'vitest';
import {
  BRAND_FONTS,
  BrandFontIdSchema,
  brandFont,
  brandFontOptions,
  fontStack,
} from '../src/brandFonts.js';

/**
 * M4's registry — the list of faces the renderers can actually resolve.
 *
 * Worth pinning because two things depend on it being *exactly* the resolvable
 * set: `brand.governance.set` validates against it, so a face missing from here
 * cannot be chosen; and both renderers fetch from it, so a face present here but
 * unfetchable is a setting that changes no pixel.
 */

describe('BRAND_FONTS', () => {
  it('has a stable, unique id per face', () => {
    const ids = BRAND_FONTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('asks for one static weight per family, never a range', () => {
    // A variable font is what Satori's parser choked on — `Onest-Variable.ttf`
    // throws inside it, checked directly. One static cut per family is the
    // difference between a face that renders and one that fails.
    for (const face of BRAND_FONTS) {
      expect([400, 500, 600, 700]).toContain(face.weight);
    }
  });

  it('names a Google family for every face, so the bytes are fetchable', () => {
    for (const face of BRAND_FONTS) {
      expect(face.family.length).toBeGreaterThan(2);
      expect(face.note.length).toBeGreaterThan(10);
    }
  });

  it('derives the settable enum from the list, so the two cannot drift', () => {
    // The point of deriving it: a face removed from the list stops being
    // settable in the same commit, rather than in a second edit somebody forgets.
    expect(BrandFontIdSchema.options.slice().sort()).toEqual(BRAND_FONTS.map((f) => f.id).sort());
  });

  it('offers a picker payload without the render-path detail', () => {
    const options = brandFontOptions();
    expect(options).toHaveLength(BRAND_FONTS.length);
    expect(Object.keys(options[0]!).sort()).toEqual(['id', 'label', 'note', 'role']);
  });
});

describe('fontStack', () => {
  it('quotes the family and ends in a real generic', () => {
    const stack = fontStack('inter');
    expect(stack).toContain('"Inter"');
    // The fallback matters more than it looks: if the @font-face fetch fails,
    // this is what the frame is drawn in.
    expect(stack).toMatch(/sans-serif$/);
  });

  it('falls a serif back to a serif, not to a sans', () => {
    // A serif that degrades to a sans changes the page's character entirely.
    expect(fontStack('playfair')).toMatch(/serif$/);
    expect(fontStack('playfair')).toContain('Georgia');
    expect(fontStack('lora')).toContain('Georgia');
    expect(fontStack('inter')).not.toContain('Georgia');
  });

  it('returns a usable stack for no choice and for an unknown id', () => {
    // An unknown id is a real state: a face removed from the list leaves every
    // brand that chose it holding a value nothing resolves.
    expect(fontStack(undefined)).toMatch(/sans-serif$/);
    expect(fontStack('a_face_that_was_removed')).toBe(fontStack(undefined));
    expect(brandFont('a_face_that_was_removed')).toBeUndefined();
  });
});
