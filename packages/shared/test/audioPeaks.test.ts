import { describe, expect, it } from 'vitest';
import { reduceToPeaks } from '../src/audioPeaks.js';

/**
 * The bar heights behind the voice waveform.
 *
 * The component needs an `AudioContext` and a canvas and cannot be unit
 * tested; this is the part of it that can be wrong in ways that still *look*
 * like a waveform, which is the dangerous kind of wrong. A control added so a
 * muted microphone is visible is worthless if it paints a convincing picture
 * of a silent take.
 */

/** A sine, which is what a steady tone actually gives you. */
const tone = (length: number, amplitude = 1) =>
  Array.from({ length }, (_, i) => Math.sin((i / 16) * Math.PI * 2) * amplitude);

describe('silence looks like silence', () => {
  it('reports zero for a buffer of zeroes rather than normalising noise up', () => {
    expect(reduceToPeaks(new Array(1000).fill(0), 8)).toEqual(new Array(8).fill(0));
  });

  /*
   * The bug this guards. Normalising against the loudest bucket divides by
   * that value, and for a silent clip it is zero — so without the guard every
   * bar becomes NaN, `Math.max(2, NaN * h)` is NaN, and the canvas silently
   * paints nothing. A muted microphone would look exactly like a broken
   * component, which is the one distinction this feature exists to make.
   */
  it('never produces NaN, which paints nothing and reports no error', () => {
    for (const bar of reduceToPeaks(new Array(100).fill(0), 16)) {
      expect(Number.isNaN(bar)).toBe(false);
    }
  });
});

describe('a real signal', () => {
  it('normalises the loudest bucket to 1', () => {
    const peaks = reduceToPeaks(tone(1600), 16);
    expect(Math.max(...peaks)).toBeCloseTo(1, 5);
  });

  it('keeps every bar inside 0..1', () => {
    for (const bar of reduceToPeaks(tone(1600), 16)) {
      expect(bar).toBeGreaterThanOrEqual(0);
      expect(bar).toBeLessThanOrEqual(1);
    }
  });

  /*
   * Why average and not peak. A clip that is loud at the start and quiet at
   * the end must *look* like that; peak-per-bucket returns ~1 for both halves,
   * because a quiet passage of speech still contains loud samples.
   */
  it('shows a quiet passage as quieter than a loud one', () => {
    const loud = tone(800, 1);
    const quiet = tone(800, 0.1);
    const peaks = reduceToPeaks([...loud, ...quiet], 2);

    expect(peaks[0]).toBeCloseTo(1, 5);
    expect(peaks[1]!).toBeLessThan(0.2);
  });

  it('rescales a quietly recorded take so it is still legible', () => {
    const faint = reduceToPeaks(tone(1600, 0.02), 16);
    // Same shape as a loud one, because the question is "did I speak", not
    // "how loud was I".
    expect(Math.max(...faint)).toBeCloseTo(1, 5);
  });
});

describe('the awkward inputs', () => {
  /*
   * A clip shorter than the bar count makes `floor(length / buckets)` zero,
   * and a bucket size of zero divides by zero. Every bar came back NaN.
   */
  it('survives a clip shorter than the number of bars', () => {
    const peaks = reduceToPeaks([0.5, -0.5, 0.25], 56);
    expect(peaks).toHaveLength(56);
    for (const bar of peaks) expect(Number.isNaN(bar)).toBe(false);
  });

  it('returns nothing for a nonsensical bar count instead of looping', () => {
    expect(reduceToPeaks(tone(100), 0)).toEqual([]);
    expect(reduceToPeaks(tone(100), -3)).toEqual([]);
  });

  it('handles an empty buffer', () => {
    const peaks = reduceToPeaks([], 8);
    expect(peaks).toEqual(new Array(8).fill(0));
  });

  it('treats negative samples as amplitude, not as quiet', () => {
    // A waveform swings either side of zero; summing signed values averages a
    // tone to roughly nothing.
    const peaks = reduceToPeaks([-1, -1, -1, -1], 1);
    expect(peaks[0]).toBeCloseTo(1, 5);
  });
});
