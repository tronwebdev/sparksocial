import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLUID_MAX_VW, FLUID_MIN_VW, floorOf, fluid } from '../tailwind.config';

/**
 * THE TYPE SCALE, now fluid — and the one property that must never break.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * Every size in the scale is a value measured off a `.dc.html` capture, and
 * every capture is drawn at one width. Held literally — as they were — a 32px
 * heading is 32px on a 1728px monitor and 32px on a 390px phone, which is how
 * the dashboard's agent name ended up 34px past the edge of its own card.
 *
 * Worth being precise about what was true before, because it was easy to
 * misread: the scale was already written in `rem`, and `rem` resolves against
 * the *root* font size, which nothing in this app ever changes. `1.75rem`
 * therefore behaved exactly like a hard 28px at every viewport. "Already in
 * rem" was true and meant nothing for responsiveness.
 *
 * ── The property that matters most ───────────────────────────────────────
 *
 * At `canvas` and above, every size is exactly the number the capture
 * specifies. The frontend rules make those captures the source of truth, and a
 * fluid scale that drifted at the design width would quietly undo every screen
 * built against them. So the measured value is the clamp's *maximum*, reached
 * at `FLUID_MAX_VW`, and the first test here is that it is hit exactly rather
 * than approximately.
 *
 * Verified in a browser as well as here: at 1728 and at 1300 every one of the
 * 17 sampled sizes computed to its captured value to the pixel.
 */

/** What `clamp(min, Arem + Bvw, max)` resolves to at a given viewport. */
function resolve(css: string, viewport: number, root = 16): number {
  const plain = /^([\d.]+)rem$/.exec(css);
  if (plain) return Number(plain[1]) * root;

  const m = /^clamp\(([\d.]+)rem, (-?[\d.]+)rem \+ (-?[\d.]+)vw, ([\d.]+)rem\)$/.exec(css);
  if (!m) throw new Error(`unparseable size: ${css}`);

  const [min, intercept, slope, max] = [Number(m[1]) * root, Number(m[2]) * root, Number(m[3]) / 100, Number(m[4]) * root];
  return Math.min(max, Math.max(min, intercept + slope * viewport));
}

/**
 * How close is close enough, in pixels.
 *
 * Three decimals, not more. The clamp's coefficients are decimal strings in
 * CSS, so an exact match is not available at any precision — chasing it just
 * moves the error from ten-thousandths to millionths of a pixel. A browser
 * renders at 1/64px at best, so 0.001px is already a thousand times finer than
 * anything visible, while any arithmetic mistake worth catching — a wrong
 * breakpoint, a flipped sign, the floor used as the cap — is off by whole
 * pixels and fails this comfortably.
 */
const PX_TOLERANCE = 3;

/** The scale as `tailwind.config.ts` declares it. */
const SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 32, 36, 40, 48, 64];

/**
 * The type scale and the layout contract must switch at the same width.
 *
 * Every other test in this file computes its expectation from `FLUID_MAX_VW`,
 * which makes them self-consistent and blind to the one change that matters:
 * moving that constant to 1728 passes all of them while leaving type still
 * growing at 1300, where `max-canvas:` has already stopped reflowing. Found by
 * trying it.
 *
 * So this reads the breakpoint out of the config's own `screens.canvas` rather
 * than trusting the constant, and ties the two together.
 */
describe('type reaches full size exactly where the layout stops reflowing', () => {
  const CONFIG = readFileSync(join(__dirname, '../tailwind.config.ts'), 'utf8');

  it('uses the canvas breakpoint as its ceiling', () => {
    const canvas = /screens:\s*\{[^}]*canvas:\s*'(\d+)px'/s.exec(CONFIG);
    expect(canvas, 'screens.canvas is no longer declared').not.toBeNull();
    expect(FLUID_MAX_VW).toBe(Number(canvas![1]));
  });
});

describe('fluid type keeps the captured value at the design width', () => {
  it('resolves to exactly the captured size at canvas', () => {
    for (const px of SIZES) {
      expect(resolve(fluid(px), FLUID_MAX_VW), `${px}px at ${FLUID_MAX_VW}`).toBeCloseTo(px, PX_TOLERANCE);
    }
  });

  it('stays at the captured size above canvas, rather than growing', () => {
    // A heading that kept growing to 1728 and beyond would be a different
    // design from the one in the capture, at the exact width the capture
    // describes.
    for (const px of [20, 28, 32, 48, 64]) {
      expect(resolve(fluid(px), 1728)).toBeCloseTo(px, PX_TOLERANCE);
      expect(resolve(fluid(px), 2560)).toBeCloseTo(px, PX_TOLERANCE);
    }
  });

  it('reaches its floor at the narrow end and goes no lower', () => {
    for (const px of SIZES) {
      expect(resolve(fluid(px), FLUID_MIN_VW), `${px}px at ${FLUID_MIN_VW}`).toBeCloseTo(floorOf(px), PX_TOLERANCE);
      expect(resolve(fluid(px), 280)).toBeCloseTo(floorOf(px), PX_TOLERANCE);
    }
  });
});

describe('the floor protects small text and spends the headroom on large', () => {
  /*
   * 16px and under is already at the readable limit; shrinking it with the
   * viewport makes a phone worse, not better. Headings carry the reduction
   * because they have the most room to lose and the most to gain from fitting.
   */
  it('does not shrink body text or anything smaller', () => {
    for (const px of [8, 10, 12, 14, 15, 16]) {
      expect(floorOf(px)).toBe(px);
      expect(fluid(px)).toBe(`${px / 16}rem`);
    }
  });

  it('shrinks a heading by more than a label, in proportion to its headroom', () => {
    const give = (px: number) => (px - floorOf(px)) / px;

    expect(give(64)).toBeGreaterThan(give(32));
    expect(give(32)).toBeGreaterThan(give(20));
    expect(give(20)).toBeGreaterThan(give(16));
  });

  it('never floors anything below 16px, however large it started', () => {
    for (const px of SIZES) expect(floorOf(px)).toBeGreaterThanOrEqual(Math.min(px, 16));
  });
});

/**
 * The accessibility property, which is the usual reason fluid type gets
 * reverted after it ships.
 *
 * A size defined purely in viewport units does not respond to a reader who
 * raises their default font size — the text stays put however much they ask
 * for, failing WCAG 1.4.4. Keeping a `rem` term in the preferred value is what
 * avoids that, and it is invisible until someone tests for it. Confirmed in a
 * browser too: at a 24px root, 16px text became 24px, 32px became 34.5 and
 * 64px became 57.
 */
describe('text still responds to the reader, not only to the viewport', () => {
  it('grows with the root font size at every viewport', () => {
    for (const px of [18, 28, 32, 64]) {
      const css = fluid(px);
      for (const vw of [390, 900, 1300, 1728]) {
        expect(resolve(css, vw, 24), `${px}px at ${vw}`).toBeGreaterThan(resolve(css, vw, 16));
      }
    }
  });

  it('keeps a rem term in every interpolating size', () => {
    // The guard above passes trivially if a size is a plain rem string, so this
    // checks the clamped ones carry one in the *preferred* value specifically.
    for (const px of [18, 20, 28, 32, 48, 64]) {
      expect(fluid(px)).toMatch(/clamp\([\d.]+rem, -?[\d.]+rem \+ -?[\d.]+vw, [\d.]+rem\)/);
    }
  });
});
