import { describe, expect, it } from 'vitest';
import { matchBrandFont, BRAND_FONTS } from '../src/brandFonts.js';

/**
 * Onboarding failed on the font the site actually used.
 *
 * `brandKit.ts` reads the family off the page's own CSS and onboarding wrote
 * it into `brandFonts`, validated against six ids. So a brand whose site used
 * anything else — nearly every real site — failed its first save with the enum
 * error on screen:
 *
 *   brandFonts.display: Invalid enum value. Expected 'inter' | … received 'Asgard Trial'
 *
 * Widening the column was the wrong fix. The six are the faces both renderers
 * can fetch; storing a name nothing resolves trades a loud error for a quiet
 * wrong font.
 */
describe('a crawled family maps to a face we can render', () => {
  it('always returns an id the renderer knows, or nothing', () => {
    const ids = new Set(BRAND_FONTS.map((f) => f.id));
    for (const family of [
      'Asgard Trial',
      'Plus Jakarta Sans',
      'Söhne',
      'Circular Std',
      'GT America',
      'Recoleta',
      'Bebas Neue',
      'JetBrains Mono',
    ]) {
      const got = matchBrandFont(family);
      if (got !== undefined) expect(ids).toContain(got);
    }
  });

  /* The two from the report. Neither is in the list, both must resolve. */
  it('handles the two that broke it', () => {
    expect(matchBrandFont('Asgard Trial')).toBe('inter');
    expect(matchBrandFont('Plus Jakarta Sans')).toBe('dm_sans');
  });

  it('recognises a site already using one of ours', () => {
    expect(matchBrandFont('Inter')).toBe('inter');
    expect(matchBrandFont('DM Sans')).toBe('dm_sans');
    expect(matchBrandFont('Playfair Display')).toBe('playfair');
  });

  /*
   * `font-family: sans-serif` is a stylesheet saying it did *not* choose. A
   * match there would be inventing a decision the site never made.
   */
  it('declines a generic family', () => {
    expect(matchBrandFont('sans-serif')).toBeUndefined();
    expect(matchBrandFont('system-ui')).toBeUndefined();
    expect(matchBrandFont('-apple-system')).toBeUndefined();
    expect(matchBrandFont(undefined)).toBeUndefined();
    expect(matchBrandFont('   ')).toBeUndefined();
  });

  /* Licensing and cut are not identity — "Trial", "Variable", "Pro". */
  it('ignores suffixes that are not the typeface', () => {
    expect(matchBrandFont('Inter Variable')).toBe('inter');
    expect(matchBrandFont('"Lora" ')).toBe('lora');
  });

  it('reads the shape out of a name it does not know', () => {
    expect(matchBrandFont('Tiempos Text Serif')).toBe('lora');
    expect(matchBrandFont('Druk Condensed')).toBe('oswald');
    expect(matchBrandFont('Berkeley Mono')).toBe('space_grotesk');
  });

  /*
   * Everything else is a custom sans, which most brand faces are. Inter is the
   * neutral one, so it is the least wrong default.
   */
  it('falls back to the neutral face for an unknown sans', () => {
    expect(matchBrandFont('Söhne')).toBe('inter');
  });
});
