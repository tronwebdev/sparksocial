/**
 * Fernhill Roastery's mark, emitted as SVG and rendered to PNG.
 *
 * PNG because that is what the product accepts: the upload modal lists JPEG,
 * PNG, WEBP, HEIC, and video — no SVG. The vector is kept alongside it so the
 * mark can be re-rendered at any size rather than upscaled.
 *
 * ── The mark ──────────────────────────────────────────────────────────────
 *
 * A coffee bean whose centre crease is a fern frond. The two halves of the name
 * in one shape: "Fernhill", and coffee. It survives 118px — which is the size
 * the onboarding logo tile actually renders at — because it is one silhouette
 * and two colours, with no text and no detail that closes up.
 *
 * Colours are the brand kit from docs/TEST_BUSINESSES.md, not new ones:
 * espresso #2B1B12, terracotta #C2603C, cream #F2E8DC.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ESPRESSO = '#2B1B12';
const TERRACOTTA = '#C2603C';
const CREAM = '#F2E8DC';

const OUT = resolve('docs/test-assets');
mkdirSync(OUT, { recursive: true });

/**
 * The frond: leaflets along a curved stem, shrinking toward the tip.
 *
 * Generated rather than hand-placed so the taper is even — a fern drawn by hand
 * in path data tends to have one leaflet slightly wrong, and at 118px that reads
 * as a smudge rather than as a leaf.
 */
function frond({ x, y, length, count, tilt }) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const cy = y - length / 2 + t * length;
    /*
     * Tapered to nothing at BOTH ends, because the frond sits inside a bean and
     * the bean is narrow at its tip and its base. The previous curve peaked near
     * the top, where there is least room, and the largest leaflets spilled out
     * of the terracotta onto the circle behind it.
     *
     * `sin(pi t)` is zero at both ends and widest in the middle — the bean's own
     * profile. The `^0.62` fattens the middle third so it still reads as a fern
     * rather than as a thin diamond, and the slight downward bias keeps a fern's
     * direction: fuller toward the base, finer toward the tip.
     */
    const scale = Math.sin(Math.PI * t) ** 0.62 * (1 - t * 0.22);
    const leaf = length * 0.245 * scale;
    if (leaf < length * 0.035) continue;

    for (const dir of [-1, 1]) {
      /*
       * A teardrop that leaves the stem pointing up and out, rather than the
       * near-flat slivers of the first pass. Two curves: the upper edge sweeps
       * out and back, the lower edge returns along a shallower arc, so the
       * leaflet has a belly and a tip instead of a uniform thickness.
       */
      const tipX = x + dir * leaf;
      const tipY = cy - leaf * 0.52;
      parts.push(
        `<path d="M ${x} ${cy} ` +
          `C ${x + dir * leaf * 0.30} ${cy - leaf * 0.62} ${x + dir * leaf * 0.76} ${cy - leaf * 0.70} ${tipX} ${tipY} ` +
          `C ${x + dir * leaf * 0.70} ${cy - leaf * 0.16} ${x + dir * leaf * 0.34} ${cy + leaf * 0.10} ${x} ${cy} Z" ` +
          `fill="${CREAM}"/>`,
      );
    }
  }
  // The stem last, over the joins, and thick enough to survive 118px.
  parts.push(
    `<path d="M ${x} ${y - length / 2 - length * 0.06} Q ${x + length * 0.03} ${y} ${x} ${y + length / 2 + length * 0.08}" ` +
      `stroke="${CREAM}" stroke-width="${length * 0.045}" stroke-linecap="round" fill="none"/>`,
  );
  return `<g transform="rotate(${tilt} ${x} ${y})">${parts.join('')}</g>`;
}

/** The bean: wide enough to read as a bean rather than a rugby ball. */
function bean(cx, cy, rx, ry) {
  return (
    `<path d="M ${cx} ${cy - ry} ` +
    `C ${cx + rx * 1.42} ${cy - ry * 0.72} ${cx + rx * 1.42} ${cy + ry * 0.72} ${cx} ${cy + ry} ` +
    `C ${cx - rx * 1.42} ${cy + ry * 0.72} ${cx - rx * 1.42} ${cy - ry * 0.72} ${cx} ${cy - ry} Z"`
  );
}

const MARK = (size) => {
  const c = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <circle cx="${c}" cy="${c}" r="${c}" fill="${ESPRESSO}"/>
  <g transform="rotate(-18 ${c} ${c})">
    ${bean(c, c, size * 0.215, size * 0.325)} fill="${TERRACOTTA}"/>
    ${frond({ x: c, y: c, length: size * 0.50, count: 8, tilt: 0 })}
  </g>
</svg>`;
};

const WORDMARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 320" width="800" height="320">
  <g transform="translate(160 160)">
    <circle cx="0" cy="0" r="132" fill="${ESPRESSO}"/>
    <g transform="rotate(-18)">
      ${bean(0, 0, 57, 86)} fill="${TERRACOTTA}"/>
      ${frond({ x: 0, y: 0, length: 132, count: 8, tilt: 0 })}
    </g>
  </g>
  <text x="330" y="150" font-family="Georgia, 'Times New Roman', serif" font-size="96" font-weight="700" fill="${ESPRESSO}">Fernhill</text>
  <text x="332" y="222" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="44" letter-spacing="10" fill="${TERRACOTTA}">ROASTERY</text>
</svg>`;

function chrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome found — set CHROME_PATH.');
  return found;
}

function render(svg, name, w, h) {
  const svgPath = join(OUT, `${name}.svg`);
  writeFileSync(svgPath, svg, 'utf8');

  // A bare page holding the SVG at exact pixel size. `margin:0` and a matching
  // window size mean the screenshot is the artwork and nothing else.
  const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>
${svg}`;
  const htmlPath = join(OUT, `.${name}.html`);
  writeFileSync(htmlPath, html, 'utf8');

  execFileSync(
    chrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      // Transparent rather than the default white, so the mark composites on
      // any background the product puts behind it.
      '--default-background-color=00000000',
      `--window-size=${w},${h}`,
      `--screenshot=${join(OUT, `${name}.png`)}`,
      pathToFileURL(htmlPath).href,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  return join(OUT, `${name}.png`);
}

render(MARK(1024), 'fernhill-logo', 1024, 1024);
// The size the onboarding logo tile renders at. A mark that fails here fails
// where it is actually seen, whatever it looks like at 1024.
render(MARK(118), 'fernhill-logo-118-proof', 118, 118); // delete after checking
render(WORDMARK, 'fernhill-logo-wordmark', 800, 320);
console.log('rendered');
