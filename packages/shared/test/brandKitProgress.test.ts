import { describe, expect, it } from 'vitest';
import { brandKitProgress } from '../src/brandKitProgress.js';

/**
 * The cockpit's brand-kit chip (`DASH-B-01`, M1).
 *
 * Derived on read, so the only way it can be wrong is arithmetic or a bad
 * emptiness test — and one of the four fields has a real trap in it, which is
 * most of what this file is about.
 */

const FULL = {
  brandColors: ['#0C0C0C'],
  logoUrl: 'https://example.com/logo.png',
  toneVector: { formal: 0.4, playful: 0.6, technical: 0.3, bold: 0.7 },
  timezone: 'Africa/Lagos',
};

describe('brandKitProgress', () => {
  it('is finished when all four are set, and offers no next step', () => {
    const out = brandKitProgress(FULL);
    expect(out.completed).toBe(4);
    expect(out.total).toBe(4);
    expect(out.pct).toBe(100);
    expect(out.next).toBeUndefined();
  });

  it('is zero for a brand nobody has configured', () => {
    const out = brandKitProgress({});
    expect(out.completed).toBe(0);
    expect(out.pct).toBe(0);
    expect(out.steps.every((s) => !s.done)).toBe(true);
  });

  it('treats UTC as unanswered', () => {
    /**
     * The column is `notNull` with a `UTC` default, so presence cannot
     * distinguish "chose UTC" from "never asked". Reading it as unanswered
     * overstates the work for a brand genuinely in UTC and understates readiness
     * for nobody — and the opposite error publishes at 3am with nothing on
     * screen suggesting why.
     */
    expect(brandKitProgress({ ...FULL, timezone: 'UTC' }).completed).toBe(3);
    expect(brandKitProgress({ ...FULL, timezone: 'Europe/London' }).completed).toBe(4);
  });

  it('treats an empty colour array as unset, not as a choice', () => {
    expect(brandKitProgress({ ...FULL, brandColors: [] }).completed).toBe(3);
  });

  it('names the first outstanding step as next, in checklist order', () => {
    const out = brandKitProgress({ timezone: 'Africa/Lagos' });
    expect(out.next?.id).toBe('colors');

    const withColors = brandKitProgress({ brandColors: ['#000'], timezone: 'Africa/Lagos' });
    expect(withColors.next?.id).toBe('logo');
  });

  it('says why each outstanding step matters', () => {
    // The chip's whole job is converting "50%" into an action, so every step
    // carries the consequence of leaving it undone.
    for (const step of brandKitProgress({}).steps) {
      expect(step.because.length).toBeGreaterThan(10);
      expect(step.label.length).toBeGreaterThan(2);
    }
  });

  it('rounds to whole percentages', () => {
    // Four steps divide evenly, but the percentage is what a chip renders and a
    // fractional one would show as "75.00000000000001%" the first time the list
    // grows to three or six.
    expect(brandKitProgress({ brandColors: ['#000'] }).pct).toBe(25);
    expect(brandKitProgress({ brandColors: ['#000'], logoUrl: 'x' }).pct).toBe(50);
  });
});
