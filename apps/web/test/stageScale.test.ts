import { describe, expect, it } from 'vitest';
import { stageScale } from '../src/components/onboarding/Stage';

/**
 * The stage must fit inside the viewport, on both axes.
 *
 * "Meet Spark" and the completion screen are splash screens: they present
 * themselves whole or they have failed at the one thing they do. The stage used
 * to scale on width alone and then reserve `contentHeight * scale` with a
 * spacer, so any window shorter than the scaled canvas scrolled.
 *
 * That is not an edge case, which is the point of the first test below: the
 * canvas is 1728x1117, so an ordinary maximised 1440x900 laptop window — call it
 * 800px of usable viewport after browser chrome — scaled to 0.83 and asked for
 * 930px. Every one of those users scrolled.
 *
 * The rule is a single `Math.min`, and it is tested here rather than through the
 * component because the defect was arithmetic, not rendering: no DOM is needed
 * to state it, and a test that needed one would not have been written.
 */

const CANVAS_H = 1117;

describe('stageScale', () => {
  it('fits the height on a laptop window, where scaling on width alone used to scroll', () => {
    const scale = stageScale(1440, 800, CANVAS_H);

    // What the old width-only rule produced, and what it cost.
    expect(1440 / 1728).toBeCloseTo(0.833, 3);
    expect(CANVAS_H * (1440 / 1728)).toBeGreaterThan(800);

    // The fitted scale puts the whole canvas inside the viewport.
    expect(CANVAS_H * scale).toBeLessThanOrEqual(800);
  });

  it('is bound by width when the window is wide and short, and by height when tall and narrow', () => {
    // Tall and narrow: width is the binding constraint.
    expect(stageScale(1000, 4000, CANVAS_H)).toBeCloseTo(1000 / 1728, 5);

    // Short and wide: height is.
    expect(stageScale(4000, 600, CANVAS_H)).toBeCloseTo(600 / CANVAS_H, 5);
  });

  it('never upscales past 1:1, however much room there is', () => {
    expect(stageScale(3840, 2160, CANVAS_H)).toBe(1);
  });

  it('still fits at phone size, where the canvas is many times the viewport', () => {
    const scale = stageScale(375, 812, CANVAS_H);
    expect(1728 * scale).toBeLessThanOrEqual(375);
    expect(CANVAS_H * scale).toBeLessThanOrEqual(812);
  });

  it('honours a taller contentHeight, for a screen whose art runs past the canvas', () => {
    const tall = 1600;
    const scale = stageScale(1440, 800, tall);
    expect(tall * scale).toBeLessThanOrEqual(800);
  });
});
