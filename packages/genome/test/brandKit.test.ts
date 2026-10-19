import { describe, expect, it } from 'vitest';
import { isNeutral, rankKit, toHex } from '../src/brandKit.js';

/**
 * The brand-kit extractor's judgement, without a browser.
 *
 * `kitProbe` runs inside Chromium and is not unit-testable; everything it
 * decides is therefore deliberately *not* in it. It returns raw observations
 * and `rankKit` makes every call that could be wrong — which of these colours
 * is the brand's, which is the paper, which two are the same colour twice.
 */

const probe = (
  swatches: { color: string; weight: number }[],
  fonts: { display?: string; body?: string } = {},
  logos: string[] = [],
) => ({ swatches, fonts, logos });

describe('toHex', () => {
  it('reads the rgb() form a browser actually returns', () => {
    expect(toHex('rgb(255, 87, 34)')).toBe('#ff5722');
    expect(toHex('rgba(255, 87, 34, 0.8)')).toBe('#ff5722');
  });

  it('expands shorthand hex', () => {
    expect(toHex('#F52')).toBe('#ff5522');
  });

  it('drops the alpha channel from an 8-digit hex', () => {
    expect(toHex('#ff5722cc')).toBe('#ff5722');
  });

  /*
   * A fully transparent colour is not a colour. `rgba(0,0,0,0)` is what every
   * unstyled element reports as its background, so without this the most
   * common observation on any page would be "black".
   */
  it('refuses a fully transparent colour', () => {
    expect(toHex('rgba(0, 0, 0, 0)')).toBeUndefined();
  });

  it('refuses the things that are not a single colour', () => {
    for (const value of ['transparent', 'currentColor', 'linear-gradient(red, blue)', '', 'none']) {
      expect(toHex(value)).toBeUndefined();
    }
  });
});

describe('isNeutral — the paper is not the brand', () => {
  it('rejects white, near-white, black and grey', () => {
    for (const hex of ['#ffffff', '#fafafa', '#000000', '#111111', '#808080', '#2b2b2d']) {
      expect(isNeutral(hex)).toBe(true);
    }
  });

  it('keeps a saturated colour even when it is dark or pale', () => {
    for (const hex of ['#ff5722', '#0b5cff', '#06402b', '#ffd7e0']) {
      expect(isNeutral(hex)).toBe(false);
    }
  });
});

describe('rankKit', () => {
  it('ranks a declared --brand variable above anything merely observed', () => {
    const kit = rankKit(
      probe([
        { color: '#0b5cff', weight: 100 }, // --brand-primary
        { color: '#cc0044', weight: 40 },  // a button fill
      ]),
    );
    expect(kit.colors[0]).toBe('#0b5cff');
  });

  it('drops the page background even when it is the most frequent colour', () => {
    const kit = rankKit(
      probe([
        ...Array.from({ length: 30 }, () => ({ color: 'rgb(255,255,255)', weight: 40 })),
        { color: '#ff5722', weight: 12 },
      ]),
    );
    expect(kit.colors).toEqual(['#ff5722']);
  });

  /*
   * A palette of six near-identical blues is a correct observation of a site
   * using a tint ramp, and useless as a brand kit.
   */
  it('collapses colours a person would not tell apart', () => {
    const kit = rankKit(
      probe([
        { color: '#0b5cff', weight: 90 },
        { color: '#0d5eff', weight: 80 },
        { color: '#0a5bfe', weight: 70 },
        { color: '#ff5722', weight: 60 },
      ]),
    );
    expect(kit.colors).toEqual(['#0b5cff', '#ff5722']);
  });

  it('proposes at most six', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      color: `hsl-not-a-colour-${i}`,
      weight: 1,
    }));
    const real = [
      '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#8800ff',
    ].map((color, i) => ({ color, weight: 50 - i }));
    expect(rankKit(probe([...many, ...real])).colors).toHaveLength(6);
  });

  it('returns nothing rather than guessing when the page has no brand colour', () => {
    expect(rankKit(probe([{ color: '#ffffff', weight: 99 }])).colors).toEqual([]);
  });

  /*
   * `system-ui` is a stylesheet saying it has NOT chosen a typeface.
   * Reporting it as the brand's font invents a decision the site never made —
   * and the Brand Kit step already shows "System, default" for that state.
   */
  it('does not report a generic family as the brand’s font', () => {
    const kit = rankKit(probe([], { display: 'system-ui', body: '-apple-system' }));
    expect(kit.fonts).toBeUndefined();
  });

  it('keeps a real typeface', () => {
    const kit = rankKit(probe([], { display: 'Satoshi', body: 'system-ui' }));
    expect(kit.fonts).toEqual({ display: 'Satoshi', body: undefined });
  });

  it('takes the first logo candidate, which the probe ordered by confidence', () => {
    const kit = rankKit(probe([], {}, ['https://x.test/logo.svg', 'https://x.test/favicon.ico']));
    expect(kit.logoUrl).toBe('https://x.test/logo.svg');
  });

  it('omits the logo rather than inventing one', () => {
    expect(rankKit(probe([])).logoUrl).toBeUndefined();
  });
});
