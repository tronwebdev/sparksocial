import { describe, expect, it } from 'vitest';
import { checkMediaQuality, DEFAULT_THRESHOLDS } from '../src/qualityCheck.js';

const clean = { blurScore: 0.1, exposureScore: 0.1, shakeScore: 0.1, durationSec: 20 };

describe('checkMediaQuality', () => {
  it('accepts clean footage', () => {
    expect(checkMediaQuality(clean).verdict).toBe('accept');
  });

  it('rejects on blur alone and names the specific reason (§6.3)', () => {
    const result = checkMediaQuality({ ...clean, blurScore: 0.9 });
    expect(result.verdict).toBe('reshoot');
    expect(result.reasons[0]).toContain('too blurry');
  });

  it('rejects on poor exposure', () => {
    expect(checkMediaQuality({ ...clean, exposureScore: 0.9 }).verdict).toBe('reshoot');
  });

  it('rejects on shake', () => {
    expect(checkMediaQuality({ ...clean, shakeScore: 0.9 }).verdict).toBe('reshoot');
  });

  it('rejects footage that is too short to cut a clip from', () => {
    const result = checkMediaQuality({ ...clean, durationSec: 1 });
    expect(result.verdict).toBe('reshoot');
    expect(result.reasons[0]).toContain('too short');
  });

  it('rejects footage that is too long', () => {
    const result = checkMediaQuality({ ...clean, durationSec: 200 });
    expect(result.reasons[0]).toContain('too long');
  });

  it('names every failing metric, not just the first', () => {
    const result = checkMediaQuality({ blurScore: 0.9, exposureScore: 0.9, shakeScore: 0.1, durationSec: 20 });
    expect(result.reasons).toHaveLength(2);
  });

  it('passes exactly at the threshold boundary (inclusive)', () => {
    expect(checkMediaQuality({ ...clean, blurScore: DEFAULT_THRESHOLDS.maxBlur }).verdict).toBe('accept');
  });

  it('respects custom thresholds', () => {
    const strict = { ...DEFAULT_THRESHOLDS, maxBlur: 0.05 };
    expect(checkMediaQuality(clean, strict).verdict).toBe('reshoot');
  });
});
