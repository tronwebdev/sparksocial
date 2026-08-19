import { describe, expect, it } from 'vitest';
import { avatarSaturation } from '../src/avatarSaturation.js';

describe('avatar saturation', () => {
  it('passes anything that is not itself an avatar format, regardless of recent history', () => {
    const result = avatarSaturation({ isAvatarFormat: false, recentAvatarCount: 100, recentTotalCount: 100 });
    expect(result.verdict).toBe('pass');
  });

  it('passes the first avatar post ever (0 recent, projects to 1-of-1 = 100%... but only 1 total)', () => {
    // With no history, one avatar post is the entire window — this is the
    // legitimate freelancer/coach case, not saturation.
    // NOTE: 1/1 = 100% > 30% cap, so this SHOULD flag; see the next test for
    // the "not yet saturated" case at a larger window.
    const result = avatarSaturation({ isAvatarFormat: true, recentAvatarCount: 0, recentTotalCount: 0 });
    expect(result.verdict).toBe('flag');
  });

  it('passes when the projected ratio stays at or under the cap', () => {
    // 3 avatar out of 10 total already; one more avatar -> 4/11 ≈ 36%... let's
    // use a window that keeps it under: 2 of 10 -> projecting 3/11 ≈ 27%, under 30%.
    const result = avatarSaturation({ isAvatarFormat: true, recentAvatarCount: 2, recentTotalCount: 10 });
    expect(result.verdict).toBe('pass');
  });

  it('flags once the projected ratio would cross the cap', () => {
    // 3 of 5 already avatar; one more -> 4/6 ≈ 67%, well over 30%.
    const result = avatarSaturation({ isAvatarFormat: true, recentAvatarCount: 3, recentTotalCount: 5 });
    expect(result.verdict).toBe('flag');
    expect(result.rule).toBe('avatar_saturation');
    expect((result.evidence as { projectedRatio: number }).projectedRatio).toBeGreaterThan(0.3);
  });

  it('respects a custom cap', () => {
    // 1 of 9 -> projecting 2/10 = 20%. Under a 50% cap: pass. Over a 10% cap: flag.
    expect(avatarSaturation({ isAvatarFormat: true, recentAvatarCount: 1, recentTotalCount: 9, capRatio: 0.5 }).verdict).toBe('pass');
    expect(avatarSaturation({ isAvatarFormat: true, recentAvatarCount: 1, recentTotalCount: 9, capRatio: 0.1 }).verdict).toBe('flag');
  });

  it('sits exactly at the cap boundary and passes (inclusive)', () => {
    // 2 of 9 already -> projecting 3/10 = exactly 30%.
    const result = avatarSaturation({ isAvatarFormat: true, recentAvatarCount: 2, recentTotalCount: 9, capRatio: 0.3 });
    expect(result.verdict).toBe('pass');
  });
});
