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
  getComputedStyle(element: ProbeElement): ProbeStyle;
  URL: { new (url: string, base?: string): { toString(): string } };
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
  swatches: { color: string; weight: number }[];
  fonts: { display?: string; body?: string };
  logos: string[];
} {
  const view = globalThis as unknown as ProbeWindow;
  const doc = view.document;
  const getComputedStyle = (el: ProbeElement) => view.getComputedStyle(el);
  const swatches: { color: string; weight: number }[] = [];
  const push = (color: string | null | undefined, weight: number) => {
    if (color) swatches.push({ color, weight });
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
        push(value, named ? 100 : 12);
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
      push(style.backgroundColor, weight);
      push(style.color, Math.round(weight / 3));
      push(style.borderTopColor, Math.round(weight / 4));
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

  const masthead = doc.querySelector('header, nav, .navbar, .header') ?? doc.body;
  for (const img of Array.from(masthead?.querySelectorAll('img, svg image') ?? []).slice(0, 15)) {
    const src = img.getAttribute('src') ?? img.getAttribute('href') ?? '';
    const hint = `${src} ${img.getAttribute('alt') ?? ''} ${img.getAttribute('class') ?? ''}`;
    if (/logo|brand|wordmark/i.test(hint)) addLogo(src);
  }
  for (const link of Array.from(doc.querySelectorAll('link[rel~="apple-touch-icon"], link[rel~="icon"]'))) {
    addLogo(link.getAttribute('href'));
  }
  addLogo(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'));

  return { swatches, fonts, logos };
}

/* ── ranking, back in Node, where it can be tested ────────────────────── */

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
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  if (max - min <= 18) return true;            // grey, white, black
  if (max <= 24) return true;                   // effectively black
  if (min >= 238) return true;                  // effectively white
  return false;
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

  for (const { color, weight } of probe.swatches) {
    const hex = toHex(color);
    if (!hex || isNeutral(hex)) continue;
    totals.set(hex, (totals.get(hex) ?? 0) + weight);
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
    ...(probe.logos[0] ? { logoUrl: probe.logos[0] } : {}),
  };
}
