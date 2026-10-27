import { describe, expect, it } from 'vitest';
import { brandImageClause } from '../src/brandContext.js';

/**
 * Every assertion here comes from an image that was actually generated on the
 * deployed site, for a brand whose palette was `#0097FD` and whose owner had
 * just answered "No one is going on camera":
 *
 *   * it came back purple;
 *   * it starred a photorealistic presenter;
 *   * and a vaguer prompt produced a card branded **"LeadNova"**, a company
 *     that does not exist, with a wordmark and a tagline.
 *
 * The tool was passing the caller's prompt to the vendor untouched, and the
 * Draft Panel's button sends the beat's bare copy. The model was not
 * misbehaving — it was asked to illustrate one sentence and invented the rest.
 */

const brand = {
  name: 'Clientforce',
  category: 'B2B SaaS',
  oneLiner: 'An AI revenue workforce you hire against an outcome.',
  colors: ['#0097FD', '#146b33'],
  talent: 'no',
};

describe('the brand is named, so the model stops inventing one', () => {
  it('names the business and what it does', () => {
    const c = brandImageClause(brand);
    expect(c).toContain('Clientforce');
    expect(c).toContain('An AI revenue workforce');
  });

  it('gets the article right for a vowel-initial category', () => {
    expect(brandImageClause({ name: 'Acme', category: 'esthetician studio' })).toContain('an esthetician studio');
    expect(brandImageClause({ name: 'Acme', category: 'barbershop' })).toContain('a barbershop');
  });

  /*
   * The instruction that matters most, and the reason naming the brand is not
   * enough on its own: told only a name, the model draws the name as a logo.
   */
  it('forbids inventing a logo even when it knows the brand', () => {
    expect(brandImageClause(brand)).toMatch(/do not invent or draw a logo/i);
    expect(brandImageClause(brand)).toMatch(/wordmark/i);
  });

  it('forbids it for a brand it knows nothing about too', () => {
    expect(brandImageClause({})).toMatch(/do not invent or draw a logo/i);
  });
});

describe('the palette', () => {
  it('names the brand colours', () => {
    const c = brandImageClause(brand);
    expect(c).toContain('#0097FD');
    expect(c).toContain('#146b33');
  });

  it('allows neutrals but forbids a different accent — the purple that was returned', () => {
    expect(brandImageClause(brand)).toMatch(/do not introduce a different accent colour/i);
  });

  /*
   * Past about four, a palette instruction stops steering and reads as a list
   * of suggestions — the same cap `brand.logo.generate` applies to its own.
   */
  it('caps how many colours it will name', () => {
    const many = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'];
    const c = brandImageClause({ ...brand, colors: many });
    expect(c).toContain('#444444');
    expect(c).not.toContain('#555555');
  });

  it('ignores anything that is not a colour rather than passing it through', () => {
    const c = brandImageClause({ ...brand, colors: ['#0097FD', 'rebeccapurple', '', 'transparent'] });
    expect(c).toContain('#0097FD');
    expect(c).not.toContain('rebeccapurple');
  });

  it('says nothing about colour when the brand has no palette yet', () => {
    expect(brandImageClause({ name: 'Acme' })).not.toMatch(/palette/i);
  });
});

describe('talent_availability decides whether a person may appear', () => {
  it('forbids people when the brand said nobody is going on camera', () => {
    expect(brandImageClause(brand)).toMatch(/no people/i);
    expect(brandImageClause(brand)).toMatch(/stock-photo models/i);
  });

  it('allows them when somebody is willing', () => {
    for (const talent of ['yes_licensed', 'yes_unlicensed']) {
      expect(brandImageClause({ ...brand, talent })).not.toMatch(/no people/i);
    }
  });

  /*
   * Absent is not a refusal. A brand that has not answered has not said no,
   * and silently forbidding people would make un-onboarded brands' imagery
   * quietly different for a reason nothing surfaces.
   */
  it('does not treat an unanswered question as a no', () => {
    expect(brandImageClause({ ...brand, talent: undefined })).not.toMatch(/no people/i);
  });
});

describe('a brand with nothing recorded', () => {
  it('still returns the rules that are not about knowing the brand', () => {
    const c = brandImageClause({});
    expect(c).toMatch(/do not invent/i);
    expect(c.trim()).not.toBe('');
  });

  it('does not emit a dangling "This is for"', () => {
    expect(brandImageClause({})).not.toMatch(/This is for/);
  });

  it('handles a category with no name', () => {
    expect(brandImageClause({ category: 'jewellery retailer' })).toContain('a jewellery retailer');
  });
});

describe('lettering in a generated image stays legible', () => {
  it('asks for white or near-black text with contrast, palette or not', () => {
    for (const c of [brandImageClause(brand), brandImageClause({ name: 'Acme' }), brandImageClause({})]) {
      expect(c).toMatch(/white or near-black/i);
      expect(c).toMatch(/strong contrast/i);
    }
  });

  it('keeps the brand colours off the letters on a dark or busy photo — the purple that was unreadable', () => {
    const c = brandImageClause({ ...brand, colors: ['#5B2A86', '#1A1A1A'] });
    expect(c).toMatch(/never set text in a brand colour over a dark or busy background/i);
    expect(c).toMatch(/palette for surfaces, objects and accents/i);
  });

  it('puts text over a photograph on a band', () => {
    expect(brandImageClause(brand)).toMatch(/solid or darkened band/i);
  });
});
