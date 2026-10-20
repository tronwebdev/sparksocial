import { describe, expect, it } from 'vitest';
import { fullSizeLogo, isNeutral, pickLogo, rankKit, toHex } from '../src/brandKit.js';
import type { LogoCandidate } from '../src/brandKit.js';

/**
 * The brand-kit extractor's judgement, without a browser.
 *
 * `kitProbe` runs inside Chromium and is not unit-testable; everything it
 * decides is therefore deliberately *not* in it. It returns raw observations
 * and `rankKit` makes every call that could be wrong — which of these colours
 * is the brand's, which is the paper, which two are the same colour twice.
 */

/**
 * `area` and `declared` default to "observed, small" — the shape most of these
 * cases are about. Both are given explicitly where the test is about them.
 */
const probe = (
  swatches: Array<{ color: string; weight: number; area?: number; declared?: boolean }>,
  fonts: { display?: string; body?: string } = {},
  logos: LogoCandidate[] = [],
) => ({
  swatches: swatches.map((s) => ({ area: 0, declared: false, ...s })),
  fonts,
  logos,
});

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
  /*
   * The wiring, not just the function.
   *
   * `fullSizeLogo` was unit-tested and `rankKit` did not call it, and both
   * suites passed — the exact shape of gap this file's header warns about.
   * This asserts the de-sizing actually reaches `CrawledKit.logoUrl`, which is
   * the only value `saveKit` ever sees.
   */
  it('de-sizes the logo it returns, not merely the one it was given', () => {
    const kit = rankKit(
      probe([{ color: 'rgb(10,69,99)', weight: 5, area: 0.3, declared: true }], {}, [
        {
          url: 'https://www.missoma.com/cdn/shop/files/MONOGRAM.webp?crop=center&height=32&v=174&width=32',
          hint: 'MONOGRAM.webp logo',
          kind: 'masthead',
        },
      ]),
    );

    expect(kit.logoUrl).toBe('https://www.missoma.com/cdn/shop/files/MONOGRAM.webp?v=174');
  });

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

  /*
   * This test used to say the probe "ordered by confidence" and assert the
   * first element won. It did not order them — `pickLogo` does, and does it
   * here rather than in the browser so it can be argued with.
   */
  it('picks the masthead logo over the favicon', () => {
    const kit = rankKit(
      probe([], {}, [
        { url: 'https://x.test/favicon.ico', hint: 'favicon.ico', kind: 'icon' },
        { url: 'https://x.test/logo.svg', hint: 'logo.svg logo', kind: 'masthead' },
      ]),
    );
    expect(kit.logoUrl).toBe('https://x.test/logo.svg');
  });

  it('skips the white variant Dishoom actually served', () => {
    const kit = rankKit(
      probe([], {}, [
        {
          url: 'https://www.dishoom.com/assets/header/logo-events-page-white.svg',
          hint: 'logo-events-page-white.svg logo',
          kind: 'masthead',
        },
        { url: 'https://www.dishoom.com/assets/header/logo.svg', hint: 'logo.svg logo', kind: 'masthead' },
      ]),
    );
    expect(kit.logoUrl).toBe('https://www.dishoom.com/assets/header/logo.svg');
  });

  it('omits the logo rather than inventing one', () => {
    expect(rankKit(probe([])).logoUrl).toBeUndefined();
  });
});

/**
 * The missoma.com failure, and what fixed it.
 *
 * Measured on the deployed crawler, 20 Oct. Missoma's identity is gold, cream
 * and off-white; the extracted palette came back
 *
 *     #0000ee, #0a4563, #1a73e8
 *
 * `#0000ee` is the browser's default unvisited-link colour — the absence of a
 * design decision, and strongly saturated, so it sailed past `isNeutral` and
 * outranked everything. `#1a73e8` is Google blue off an embedded widget.
 * Nothing on that page is blue.
 *
 * Two causes, and chroma was both of them: it admitted an accident because it
 * was saturated, and it discarded the real identity because it was not.
 */
describe('a brand whose palette is neutral', () => {
  it('keeps a cream that covers a third of the page', () => {
    const kit = rankKit(
      probe([
        { color: '#f6f1e7', weight: 6, area: 0.34 }, // the page, in cream
        { color: '#0000ee', weight: 6 },             // an unstyled link
      ]),
    );
    expect(kit.colors).toContain('#f6f1e7');
  });

  /*
   * The whole point. Chroma says the link is the brand colour and the cream is
   * paper; area says the opposite, and area is right.
   */
  it('ranks the cream above the link blue', () => {
    const kit = rankKit(
      probe([
        { color: '#0000ee', weight: 40 },
        { color: '#f6f1e7', weight: 6, area: 0.34 },
      ]),
    );
    expect(kit.colors[0]).toBe('#f6f1e7');
  });

  it('still drops a neutral that covers almost nothing', () => {
    const kit = rankKit(probe([{ color: '#fafafa', weight: 40, area: 0.001 }]));
    expect(kit.colors).toEqual([]);
  });
});

describe('colours a browser supplies when the page chose none', () => {
  it('refuses the default link blue however it is weighted', () => {
    expect(rankKit(probe([{ color: '#0000ee', weight: 500, declared: true }])).colors).toEqual([]);
  });

  it('refuses the other user-agent defaults too', () => {
    for (const ua of ['#0000ff', '#551a8b', '#1a73e8']) {
      expect(rankKit(probe([{ color: ua, weight: 100 }])).colors).toEqual([]);
    }
  });

  /*
   * The exact observation from missoma.com. Two of the three were accidents
   * and the third is a real colour off the page, so it is the only survivor.
   */
  it('reduces the measured missoma palette to the one real colour in it', () => {
    const kit = rankKit(
      probe([
        { color: '#0000ee', weight: 40 },
        { color: '#1a73e8', weight: 25 },
        { color: '#0a4563', weight: 12 },
      ]),
    );
    expect(kit.colors).toEqual(['#0a4563']);
  });
});

describe('a declared palette still wins', () => {
  it('believes a --brand variable without needing area', () => {
    const kit = rankKit(
      probe([
        { color: '#f6f1e7', weight: 6, area: 0.4 },
        { color: '#b8860b', weight: 100, declared: true },
      ]),
    );
    expect(kit.colors[0]).toBe('#b8860b');
  });

  it('believes a declared neutral, which area alone might not reach', () => {
    const kit = rankKit(probe([{ color: '#efe9df', weight: 100, declared: true }]));
    expect(kit.colors).toEqual(['#efe9df']);
  });
});

/**
 * Paper, which no amount of area makes a decision.
 *
 * Admitting large neutrals fixed the cream and immediately broke something
 * else: `#ffffff` led the palette for both missoma.com and stripe.com. A
 * palette beginning "white" is not wrong so much as unusable — every page is
 * mostly white and nothing downstream can act on it.
 *
 * The line is the tint. `#f6f1e7` is a choice; `#ffffff` is what you get for
 * not making one.
 */
describe('plain white and black are never the palette', () => {
  it('rejects white however much of the page it covers', () => {
    expect(rankKit(probe([{ color: '#ffffff', weight: 50, area: 0.9 }])).colors).toEqual([]);
  });

  it('rejects near-white and near-black too', () => {
    for (const paper of ['#fefefe', '#fafafa', '#000000', '#060606']) {
      expect(rankKit(probe([{ color: paper, weight: 50, area: 0.9 }])).colors).toEqual([]);
    }
  });

  /*
   * The case the area rule exists for, and the one that must survive it:
   * clientforce.io's `#f2decd` is a warm cream and a real decision.
   */
  it('keeps a tinted neutral, which is a decision someone made', () => {
    for (const tinted of ['#f6f1e7', '#f2decd', '#d9edf2']) {
      expect(rankKit(probe([{ color: tinted, weight: 6, area: 0.3 }])).colors).toEqual([tinted]);
    }
  });

  it('rejects white even when a stylesheet declared it', () => {
    expect(rankKit(probe([{ color: '#ffffff', weight: 100, declared: true }])).colors).toEqual([]);
  });
});

/**
 * THE LOGO AT ITS OWN SIZE, not at the masthead's.
 *
 * A header logo is served at header size. Missoma's is
 * `.../MISSOMAMONOGRAM-48x48_<hash>.webp?crop=center&height=32&v=...&width=32`
 * — a 32px favicon — and once `genome.bootstrap_from_url` began ingesting the
 * mark as the brand's `brand_kit` asset, that thumbnail became the asset. It
 * satisfied the role gate and was useless to anything that rendered it.
 */
describe('fullSizeLogo', () => {
  it('drops the sizing parameters from the measured Shopify URL', () => {
    const url =
      'https://www.missoma.com/cdn/shop/files/MISSOMAMONOGRAM-48x48_af82cb.webp?crop=center&height=32&v=1747318795&width=32';

    const full = fullSizeLogo(url);

    expect(full).not.toContain('width=32');
    expect(full).not.toContain('height=32');
    expect(full).not.toContain('crop=');
    // `v` is Shopify's cache-busting version, not a dimension. Dropping it
    // changes which object is served, so it stays.
    expect(full).toContain('v=1747318795');
  });

  it('covers the other vendors that use the same parameter names', () => {
    expect(fullSizeLogo('https://x.test/l.png?w=64&h=64')).toBe('https://x.test/l.png');
    expect(fullSizeLogo('https://x.test/l.png?fit=cover&size=48')).toBe('https://x.test/l.png');
  });

  /*
   * The important negative. Editing the query of a signed URL does not return a
   * bigger image, it returns a 403 — the signature covers the string.
   */
  it('leaves a signed URL exactly as found, even with a width in it', () => {
    const signed =
      'https://bucket.r2.cloudflarestorage.com/logo.png?width=32&X-Amz-Signature=abc123&X-Amz-Expires=604800';

    expect(fullSizeLogo(signed)).toBe(signed);
  });

  /*
   * Measured on www.dishoom.com while checking the logo ranking: a masthead
   * mark served through Next.js's optimiser as
   * `/_next/image?url=...&w=3840&q=75`. `w` is in the strip list and Next.js
   * requires it — stripping it returns 400, turning a working logo into a
   * broken one. The `w` is already the largest size on offer, so there was
   * nothing to win either.
   */
  it('leaves an image proxy alone, because its size parameter is load-bearing', () => {
    const proxied = 'https://www.dishoom.com/_next/image?url=%2Fassets%2Fheader%2Flogo.png&w=3840&q=75';
    expect(fullSizeLogo(proxied)).toBe(proxied);
  });

  it('leaves alone a URL with nothing to strip, and anything unparseable', () => {
    expect(fullSizeLogo('https://x.test/logo.svg')).toBe('https://x.test/logo.svg');
    expect(fullSizeLogo('https://x.test/logo.png?format=webp')).toBe('https://x.test/logo.png?format=webp');
    expect(fullSizeLogo('not a url')).toBe('not a url');
  });
});

/**
 * CHOOSING THE LOGO, rather than taking the first one in the DOM.
 *
 * `rankKit` used to return `probe.logos[0]` under a comment claiming the
 * candidates were "best guess first". They were not ordered at all beyond the
 * three groups they were collected in. Measured on the deployed build: Dishoom
 * offered `logo-events-page-white.svg`, that is what became the brand's
 * `brand_kit` asset, and a white mark is invisible on anything white.
 */
describe('pickLogo', () => {
  const at = (url: string, over: Partial<LogoCandidate> = {}): LogoCandidate => ({
    url,
    hint: url,
    kind: 'masthead',
    ...over,
  });

  it('passes over the white variant for a sibling meant for paper', () => {
    const chosen = pickLogo([
      at('https://www.dishoom.com/assets/header/logo-events-page-white.svg'),
      at('https://www.dishoom.com/assets/header/logo.svg'),
    ]);

    expect(chosen?.url).toBe('https://www.dishoom.com/assets/header/logo.svg');
  });

  /* The convention that reads backwards: `logo-dark` is dark *ink*, for a light
     page — so it is the one to prefer, not the one to avoid. */
  it('prefers the dark-ink variant, which is the one for a light page', () => {
    const chosen = pickLogo([at('https://x.test/logo-white.svg'), at('https://x.test/logo-dark.svg')]);
    expect(chosen?.url).toBe('https://x.test/logo-dark.svg');
  });

  it('reads the measured background, so an unnamed mark on a dark header loses', () => {
    const chosen = pickLogo([
      at('https://x.test/brand.svg', { background: 'rgb(21,21,21)' }),
      at('https://x.test/other-brand.svg', { background: 'rgb(255,255,255)' }),
    ]);

    expect(chosen?.url).toBe('https://x.test/other-brand.svg');
  });

  /*
   * The background is observation and the filename is convention, so when they
   * disagree the measurement wins — including over `masthead`'s head start.
   */
  it('lets a measured dark surface outweigh a reassuring filename', () => {
    const chosen = pickLogo([
      at('https://x.test/logo-primary.svg', { background: 'rgb(0,0,0)' }),
      at('https://x.test/icon.png', { kind: 'touch_icon' }),
    ]);

    expect(chosen?.url).toBe('https://x.test/icon.png');
  });

  it('judges a surface by perceived luminance, not by an average', () => {
    // Pure blue averages to 85 and reads as dark; pure green averages the same
    // and reads as light. A mean would call these the same surface.
    const onBlue = pickLogo([at('https://x.test/a.svg', { background: 'rgb(0,0,255)' }), at('https://x.test/b.svg')]);
    expect(onBlue?.url).toBe('https://x.test/b.svg');

    const onGreen = pickLogo([at('https://x.test/a.svg', { background: 'rgb(0,255,0)' }), at('https://x.test/b.svg')]);
    expect(onGreen?.url).toBe('https://x.test/a.svg');
  });

  it('keeps the documented order of sources when nothing else separates them', () => {
    const chosen = pickLogo([
      at('https://x.test/og.png', { kind: 'og_image' }),
      at('https://x.test/icon.png', { kind: 'icon' }),
      at('https://x.test/mark.svg', { kind: 'masthead' }),
    ]);

    expect(chosen?.url).toBe('https://x.test/mark.svg');
  });

  /*
   * Penalties, never exclusions. `brand_kit` gates seven playbooks, so a brand
   * that publishes one mark and draws it on a dark header should still get it —
   * withholding it trades a working brand for a tidy one.
   */
  it('still returns a white logo when it is the only one there is', () => {
    const chosen = pickLogo([at('https://x.test/logo-white.svg', { background: 'rgb(0,0,0)' })]);
    expect(chosen?.url).toBe('https://x.test/logo-white.svg');
  });

  it('does not penalise a brand whose own name contains one of those words', () => {
    const chosen = pickLogo([at('https://whitworths.test/assets/whitworths-logo.svg')]);
    expect(chosen).toBeDefined();

    // Beaten only by something genuinely better, not treated as an inverse.
    const pair = pickLogo([
      at('https://whitworths.test/assets/whitworths-logo.svg'),
      at('https://whitworths.test/assets/icon.png', { kind: 'touch_icon' }),
    ]);
    expect(pair?.url).toBe('https://whitworths.test/assets/whitworths-logo.svg');
  });

  /*
   * DISHOOM, AS THE SITE ACTUALLY SERVES IT.
   *
   * Read from www.dishoom.com on 20 Oct: the masthead offers two marks and
   * *both* are white variants, so there is no dark sibling to fall back to —
   * which is what the first test in this block assumes and real sites do not
   * guarantee. The touch icon is then the best thing available: a full-colour
   * square on its own background, which will at least be visible.
   *
   * Note the measured surface is cream, not dark. The background signal
   * correctly says nothing here, and the filename is what carries it — the two
   * signals exist precisely because either one alone would miss a case.
   */
  it('falls back to the touch icon when every masthead mark is a white one', () => {
    const chosen = pickLogo([
      at('https://www.dishoom.com/assets/header/logo-events-page-white.svg', {
        hint: '/assets/header/logo-events-page-white.svg logo',
        background: 'rgb(240, 236, 224)',
      }),
      at('https://www.dishoom.com/_next/image?url=logo-ramadan-white.png', {
        hint: 'logo-ramadan-white.png logo',
        background: 'rgb(240, 236, 224)',
      }),
      at('https://www.dishoom.com/apple-touch-icon.png', { hint: '/apple-touch-icon.png', kind: 'touch_icon' }),
      at('https://www.dishoom.com/favicon-32x32.png', { hint: '/favicon-32x32.png', kind: 'icon' }),
    ]);

    expect(chosen?.url).toBe('https://www.dishoom.com/apple-touch-icon.png');
  });

  it('has nothing to say about an empty list', () => {
    expect(pickLogo([])).toBeUndefined();
  });
});
