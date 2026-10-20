/**
 * BRAND KIT FROM A CRAWL — the palette, the fonts and the logo a site already
 * shows everyone who visits it.
 *
 * ── What this closes ─────────────────────────────────────────────────────
 *
 * `docs/GAPS.md`: *"Nothing proposes a brand palette from a crawl. The brand
 * kit's 'generated preset' control is inert. `genome.bootstrap_from_url`
 * already reads the site; extracting a palette from it is the missing half."*
 * The Brand Kit step's own copy says "This is your brand kit generated from
 * your URL" above a toggle that was permanently disabled.
 *
 * ── Why the browser does the reading ─────────────────────────────────────
 *
 * A brand's colours are not in its HTML. They are in a stylesheet, often
 * behind CSS custom properties, often minified, and increasingly emitted per
 * component by a build step. Parsing CSS ourselves would mean reimplementing
 * the cascade badly. The crawler already has a real Chromium with the page
 * laid out and the cascade resolved, so the honest extractor is
 * `getComputedStyle` on the elements that carry brand colour — which is why
 * this runs as a function serialised into the page rather than over the HTML.
 *
 * Images are blocked during the crawl (`screen()`), which costs nothing here:
 * a blocked `<img>` still has its `src` in the DOM, and that is all a logo
 * needs to be.
 */

/*
 * Minimal shapes for the browser APIs the probe touches.
 *
 * `packages/genome` runs in Node and its `lib` has no DOM, deliberately — the
 * same reason `crawl.ts` declares `BrowserGlobals` rather than widening the
 * compiler options for one function. These describe only what is used, so an
 * API that changes shape surfaces as a type error here rather than as
 * `undefined` inside a page.
 */
interface ProbeElement {
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<ProbeElement>;
  getBoundingClientRect(): { width: number; height: number };
}
interface ProbeStyle {
  readonly length: number;
  [index: number]: string;
  backgroundColor: string;
  color: string;
  borderTopColor: string;
  fontFamily: string;
  getPropertyValue(property: string): string;
}
interface ProbeRule {
  style?: ProbeStyle;
}
interface ProbeSheet {
  readonly cssRules: ArrayLike<ProbeRule>;
}
interface ProbeDocument {
  readonly documentElement: ProbeElement;
  readonly body: ProbeElement | null;
  readonly baseURI: string;
  readonly styleSheets: ArrayLike<ProbeSheet>;
  querySelector(selector: string): ProbeElement | null;
  querySelectorAll(selector: string): ArrayLike<ProbeElement>;
}
interface ProbeWindow {
  document: ProbeDocument;
  innerWidth: number;
  innerHeight: number;
  getComputedStyle(element: ProbeElement): ProbeStyle;
  URL: { new (url: string, base?: string): { toString(): string } };
}

/**
 * One observed colour, with the two things that decide whether to believe it.
 *
 * `declared` means the site named it in a `--brand*` custom property — its own
 * statement, believed without further evidence. `area` is the share of the
 * viewport it covers, which is what tells a cream background apart from a
 * link's blue when saturation cannot.
 */
export interface Swatch {
  color: string;
  weight: number;
  /** Fraction of the viewport, 0..1. Zero for text and borders. */
  area: number;
  declared: boolean;
}

/** What a crawl can observe about a site's visual identity. */
export interface CrawledKit {
  /** Brand colours as `#rrggbb`, most prominent first. Never more than six. */
  colors: string[];
  fonts?: { display?: string; body?: string };
  /** Absolute URL of the best logo candidate found. */
  logoUrl?: string;
}

/**
 * The function that runs *inside the page*.
 *
 * Returned as a string-serialisable function with no imports and no closure
 * over anything in this module — Playwright evaluates it in the browser, where
 * none of this file exists. Everything it needs is defined within it.
 *
 * It returns raw observations; ranking and filtering happen back in Node in
 * {@link rankKit}, so the judgement calls are unit-testable without a browser.
 */
export function kitProbe(): {
  swatches: Swatch[];
  fonts: { display?: string; body?: string };
  logos: string[];
} {
  const view = globalThis as unknown as ProbeWindow;
  const doc = view.document;
  const getComputedStyle = (el: ProbeElement) => view.getComputedStyle(el);
  const swatches: Swatch[] = [];
  const push = (color: string | null | undefined, weight: number, extra: Partial<Swatch> = {}) => {
    if (color) swatches.push({ color, weight, area: 0, declared: false, ...extra });
  };

  /*
   * How much of the viewport an element covers, as a fraction.
   *
   * The signal that separates a brand colour from an accident. A link's blue
   * is a few hundred pixels; a jewellery site's cream is most of the page.
   * Chroma cannot tell those apart and area can.
   */
  const viewport = Math.max(1, view.innerWidth * view.innerHeight);
  const areaOf = (el: ProbeElement): number => {
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (r.width * r.height) / viewport));
  };

  /*
   * CSS custom properties on `:root` are where a design system keeps its
   * palette, and they are the highest-quality signal available: a variable
   * literally named `--brand-primary` is the site telling us its own answer.
   * Weighted far above anything observed, and read from the inline
   * `style` attribute plus the cascade's resolved value.
   */
  const rootStyle = getComputedStyle(doc.documentElement);
  const seenVars = new Set<string>();
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: ArrayLike<ProbeRule>;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // Cross-origin stylesheet; its computed effects still show below.
    }
    for (const rule of Array.from(rules)) {
      const style = rule.style;
      if (!style) continue;
      for (const prop of Array.from({ length: style.length }, (_, i) => style[i] ?? '')) {
        if (!prop.startsWith('--') || seenVars.has(prop)) continue;
        seenVars.add(prop);
        const named = /brand|primary|accent|secondary|theme/i.test(prop);
        const value = rootStyle.getPropertyValue(prop).trim() || style.getPropertyValue(prop).trim();
        /* Declared in a stylesheet variable: the site stating its own palette,
           which needs no area to be believed. */
        push(value, named ? 100 : 12, { declared: named });
      }
    }
  }

  /*
   * Observed colour, weighted by how much a reader would call it "the brand's
   * colour". A call-to-action's fill is the strongest ordinary signal on a
   * marketing page; body text is the weakest, because almost every site on
   * earth sets it to near-black.
   */
  const weighted: [string, number][] = [
    ['button, .btn, [role="button"], a.button, input[type="submit"]', 40],
    ['header, nav, .navbar, .header', 25],
    ['footer', 10],
    ['h1, h2', 8],
    ['a', 6],
  ];

  for (const [selector, weight] of weighted) {
    const nodes = Array.from(doc.querySelectorAll(selector)).slice(0, 20);
    for (const node of nodes) {
      const style = getComputedStyle(node);
      const area = areaOf(node);
      /* A fill covers the element; text and borders do not, so only the
         background claims the area. */
      push(style.backgroundColor, weight, { area });
      push(style.color, Math.round(weight / 3));
      push(style.borderTopColor, Math.round(weight / 4));
    }
  }

  /*
   * The page's own large surfaces, which is where a neutral identity lives.
   *
   * Nothing sampled these before, so a brand whose palette is cream and
   * off-white had no chance of being read: its colours were only ever on
   * `body` and the big section wrappers, and the probe was looking at buttons.
   */
  for (const selector of ['body', 'main', 'section', 'article', '[class*="hero"]']) {
    for (const node of Array.from(doc.querySelectorAll(selector)).slice(0, 8)) {
      push(getComputedStyle(node).backgroundColor, 6, { area: areaOf(node) });
    }
  }

  /* Fonts: what the headings and the prose are actually set in. */
  const first = (family: string) =>
    family.split(',')[0]?.trim().replace(/^["']|["']$/g, '') || undefined;
  const heading = doc.querySelector('h1') ?? doc.querySelector('h2');
  const fonts = {
    display: heading ? first(getComputedStyle(heading).fontFamily) : undefined,
    body: doc.body ? first(getComputedStyle(doc.body).fontFamily) : undefined,
  };

  /*
   * Logo candidates, best guess first. An `<img>` inside the masthead whose
   * own markup calls it a logo is the strongest; a touch icon is a clean
   * square but often a mark rather than a wordmark; `og:image` is last because
   * it is usually a social share card with a photograph in it.
   */
  const logos: string[] = [];
  const addLogo = (value: string | null | undefined) => {
    if (!value) return;
    try {
      const absolute = new view.URL(value, doc.baseURI).toString();
      if (!logos.includes(absolute)) logos.push(absolute);
    } catch {
      /* A malformed src is not a logo. */
    }
  };

  /*
   * The widest candidate the markup offers, not the one the masthead happens
   * to render.
   *
   * A header logo is served at header size — Missoma's is
   * `...MISSOMAMONOGRAM-48x48_....webp?crop=center&height=32&width=32`, a 32px
   * favicon — and storing that as the brand's mark gives every later render a
   * 32px image to scale up. `srcset` is where a site lists the same image at
   * its other sizes, so the largest `w` descriptor there is a free upgrade and
   * is exactly what the standard is for. Falls back to `src` when there is no
   * `srcset`, which is then de-sized back in Node by `fullSizeLogo`.
   */
  const widest = (el: ProbeElement): string => {
    const src = el.getAttribute('src') ?? el.getAttribute('href') ?? '';
    const srcset = el.getAttribute('srcset');
    if (!srcset) return src;

    let best = src;
    let bestWidth = 0;
    for (const entry of srcset.split(',')) {
      const [url, descriptor] = entry.trim().split(/\s+/);
      if (!url) continue;
      /* `640w` is a width; `2x` is a density. Density-only sets carry no size
         information worth ranking, so they keep the `src`. */
      const match = /^(\d+)w$/.exec(descriptor ?? '');
      const width = match?.[1] ? Number(match[1]) : 0;
      if (width > bestWidth) {
        bestWidth = width;
        best = url;
      }
    }
    return best;
  };

  const masthead = doc.querySelector('header, nav, .navbar, .header') ?? doc.body;
  for (const img of Array.from(masthead?.querySelectorAll('img, svg image') ?? []).slice(0, 15)) {
    const src = img.getAttribute('src') ?? img.getAttribute('href') ?? '';
    const hint = `${src} ${img.getAttribute('alt') ?? ''} ${img.getAttribute('class') ?? ''}`;
    if (/logo|brand|wordmark/i.test(hint)) addLogo(widest(img));
  }
  for (const link of Array.from(doc.querySelectorAll('link[rel~="apple-touch-icon"], link[rel~="icon"]'))) {
    addLogo(link.getAttribute('href'));
  }
  addLogo(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'));

  return { swatches, fonts, logos };
}

/* ── ranking, back in Node, where it can be tested ────────────────────── */
/** Query parameters that only ask a CDN to shrink the image. */
const SIZING_PARAMS = new Set(['width', 'height', 'w', 'h', 'crop', 'size', 'fit', 'dpr', 'resize', 'max-w', 'max-h']);

/**
 * Parameters whose presence means the URL is signed, and must not be touched.
 *
 * Editing the query of a signed URL does not produce a bigger image, it
 * produces a 403 — the signature covers the string. Better a small logo than a
 * broken one, so anything that looks signed is returned exactly as found.
 */
const SIGNED_HINTS = /^(x-amz-|x-goog-|sig|signature|token|expires|se|sp|sv|key)/i;

/**
 * The logo at its own size, rather than at the size the masthead asked for.
 *
 * Measured: Missoma's header mark is stored as
 * `.../MISSOMAMONOGRAM-48x48_<hash>.webp?crop=center&height=32&v=...&width=32`.
 * That is the site's own display sizing, and ingesting it made the brand's
 * `brand_kit` asset a 32px favicon — satisfying the role gate while being
 * useless to anything that renders it.
 *
 * Only the sizing parameters go. `v` is Shopify's cache-busting version and
 * `format` changes the encoding, not the dimensions; dropping either would
 * either break the URL or change what comes back for no gain. Imgix and
 * friends use the same `w`/`h` names, so this covers more than one vendor
 * without knowing which it is talking to.
 *
 * Path-segment resizers (Cloudinary's `/w_32,h_32/`) are deliberately not
 * handled: rewriting a path means guessing at a vendor's URL grammar, and
 * guessing wrong yields a 404 rather than a smaller picture. `srcset` in the
 * probe is the vendor-neutral half of this fix and catches those.
 */
export function fullSizeLogo(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const keys = [...parsed.searchParams.keys()];
  if (keys.some((k) => SIGNED_HINTS.test(k))) return url;

  const sizing = keys.filter((k) => SIZING_PARAMS.has(k.toLowerCase()));
  if (sizing.length === 0) return url;

  for (const key of sizing) parsed.searchParams.delete(key);
  return parsed.toString();
}



/**
 * `rgb(12, 34, 56)` / `#abc` / `#aabbcc` → `#aabbcc`.
 *
 * Anything else — `transparent`, a gradient, `currentColor`, a CSS variable
 * that resolved to nothing — returns undefined and is dropped. A palette is
 * only useful if every entry is a colour a picker can show.
 */
export function toHex(value: string): string | undefined {
  const text = value.trim().toLowerCase();

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/.exec(text);
  if (rgb) {
    // A fully transparent colour is not a colour; it is the absence of one.
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return undefined;
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))));
    return `#${[r, g, b].map((n) => n!.toString(16).padStart(2, '0')).join('')}`;
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    const digits = hex[1]!;
    if (digits.length === 3 || digits.length === 4) {
      const rgbPart = digits.slice(0, 3);
      return `#${[...rgbPart].map((c) => c + c).join('')}`;
    }
    return `#${digits.slice(0, 6)}`;
  }

  return undefined;
}

/**
 * Is this colour a page background rather than a brand colour?
 *
 * Every site is mostly white, near-white, near-black and grey. Those are the
 * highest-frequency colours on almost any page and they say nothing about the
 * brand — a palette of `#ffffff, #fafafa, #111111` is a correct observation
 * and a useless answer. Chroma is what separates "this is the brand's blue"
 * from "this is the paper".
 */
export function isNeutral(hex: string): boolean {
  const { r, g, b } = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  if (max - min <= 18) return true;            // grey, white, black
  if (max <= 24) return true;                   // effectively black
  if (min >= 238) return true;                  // effectively white
  return false;
}

/**
 * Colours a browser supplies when a page has *not* chosen one.
 *
 * `#0000ee` is the UA default for an unvisited link. It is not a design
 * decision, it is the absence of one — and it is strongly saturated, so it
 * sails past `isNeutral` and outranks a real palette.
 *
 * Found on missoma.com, whose identity is gold and cream and whose extracted
 * palette came back `#0000ee, #0a4563, #1a73e8`: browser link blue, and Google
 * blue off an embedded widget. Nothing on that page is blue.
 */
const UA_DEFAULTS = new Set(['#0000ee', '#0000ff', '#551a8b', '#ee0000', '#1a73e8', '#4285f4']);

/**
 * How much of the page is painted in this colour, as a share of the viewport.
 *
 * The signal `isNeutral` was standing in for, badly. The question that
 * actually separates a brand colour from the paper is not "is it saturated"
 * but "how much of the page is it" — and the two disagree exactly where it
 * matters: a jewellery brand's cream *is* its palette and a link's blue is
 * not, while chroma says the opposite about both.
 *
 * So a neutral is kept when it covers enough of the page to be a deliberate
 * choice, and a saturated colour has to earn its place either by being
 * declared in a custom property or by covering some real area.
 */
const AREA_FLOOR = 0.015; // 1.5% of the viewport

/**
 * Plain white and plain black, which no amount of area makes a decision.
 *
 * Admitting large neutrals let a *tinted* neutral in — a jewellery brand's
 * cream, which is what this was for — and also let `#ffffff` in, which then
 * led the palette for both missoma.com and stripe.com. A palette beginning
 * "white" is not wrong so much as useless: every page is mostly white, and
 * nothing downstream can act on it.
 *
 * The distinction is the tint. `#f6f1e7` is a choice someone made; `#ffffff`
 * and `#fafafa` are what you get for not making one. So: achromatic *and*
 * extreme is paper, at any size.
 */
function isPaper(hex: string): boolean {
  const { r, g, b } = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const achromatic = max - min <= 8;
  return achromatic && (min >= 244 || max <= 12);
}
/** `#rrggbb` to its three channels. */
function channels(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** Two colours a person would not tell apart should not both be in a palette of six. */
function tooClose(a: string, b: string): boolean {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.abs(ar! - br!) + Math.abs(ag! - bg!) + Math.abs(ab! - bb!) < 60;
}

/** How many colours a kit proposes. Six is what the Brand Kit step draws. */
const MAX_COLORS = 6;

/**
 * Turn raw observations into a palette.
 *
 * Exported and pure so the whole judgement — what counts as neutral, how
 * weights accumulate, how near-duplicates collapse — is testable without a
 * browser, which is the same split `crawl.ts` uses for `admit` and `screen`.
 */
export function rankKit(probe: ReturnType<typeof kitProbe>): CrawledKit {
  const totals = new Map<string, number>();

  for (const { color, weight, area, declared } of probe.swatches) {
    const hex = toHex(color);
    if (!hex) continue;

    /* Never a design decision; see `UA_DEFAULTS` and `isPaper`. */
    if (UA_DEFAULTS.has(hex) || isPaper(hex)) continue;

    /*
     * Three ways in, in order of how much they are worth believing:
     *
     *   1. the site declared it in a `--brand*` variable;
     *   2. it covers enough of the page to be deliberate — which is how a
     *      cream or off-white identity gets in, where `isNeutral` alone threw
     *      it away as "the paper";
     *   3. it is saturated enough to be an accent rather than a background.
     *
     * Chroma is now the *last* test rather than the only one. On missoma.com
     * it was the only one, and it chose browser link blue over the brand.
     */
    const believable = declared || area >= AREA_FLOOR || !isNeutral(hex);
    if (!believable) continue;

    /*
     * Area is worth weight, not just admission. A colour covering a third of
     * the page is more the brand's than a button nobody scrolled to, and
     * without this a large neutral would be admitted and then ranked last.
     */
    totals.set(hex, (totals.get(hex) ?? 0) + weight + Math.round(area * 120));
  }

  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);

  const colors: string[] = [];
  for (const hex of ordered) {
    if (colors.length >= MAX_COLORS) break;
    if (!colors.some((picked) => tooClose(picked, hex))) colors.push(hex);
  }

  /*
   * A generic family is not a brand font. `system-ui` and friends are what a
   * stylesheet says when it has *not* chosen a typeface, so reporting them as
   * the brand's own would be inventing a decision the site never made.
   */
  const generic = /^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|ui-\w+|inherit|initial)$/i;
  const keep = (family: string | undefined) => (family && !generic.test(family) ? family : undefined);
  const fonts = { display: keep(probe.fonts.display), body: keep(probe.fonts.body) };

  return {
    colors,
    ...(fonts.display || fonts.body ? { fonts } : {}),
    ...(probe.logos[0] ? { logoUrl: fullSizeLogo(probe.logos[0]) } : {}),
  };
}
