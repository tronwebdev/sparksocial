/**
 * Every colour the app's source writes, checked against every colour the
 * prototypes use.
 *
 *   node scripts/fidelity/palette.mjs              # app colours with no exact prototype match
 *   node scripts/fidelity/palette.mjs --gradients  # gradients, side by side
 *   node scripts/fidelity/palette.mjs --near 6     # only near-misses within 6 (per channel, 0-255)
 *
 * ── Why a static pass at all ─────────────────────────────────────────────
 *
 * The rendered comparison (`colours.mjs`) is the accurate one, but it only
 * sees the screens and states somebody opened. A colour typed into a
 * component that renders only on an error, a hover or a fourth wizard step is
 * invisible to it. Reading the source sees all of them. What it cannot see is
 * *where* a colour lands — so its output is a list of leads, and a near-miss
 * (`#838384` beside the prototype's `#838383`) is the one kind of lead that is
 * almost always a real defect: nobody chooses a colour one unit away on
 * purpose.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PROTO_DIR = join(ROOT, 'ui build');
const APP_DIRS = [join(ROOT, 'apps', 'web', 'src'), join(ROOT, 'apps', 'web', 'tailwind.config.ts')];

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const RGB = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)/g;
const GRADIENT = /(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/g;

export function parseColour(raw) {
  const s = raw.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? Math.round((n(6) / 255) * 100) / 100 : 1];
  }
  const m = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(s);
  if (!m) return undefined;
  let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  a = Math.round(a * 100) / 100;
  return [Number(m[1]), Number(m[2]), Number(m[3]), a];
}

export const key = (c) => `${c[0]},${c[1]},${c[2]},${c[3]}`;
export const hexOf = (c) =>
  `#${c
    .slice(0, 3)
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}${c[3] < 1 ? `@${Math.round(c[3] * 100)}%` : ''}`;
export const dist = (a, b) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]) * 255);

function walk(path, out = []) {
  const st = statSync(path);
  if (st.isFile()) {
    out.push(path);
    return out;
  }
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(path, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css|mjs)$/.test(name) && !name.endsWith('.generated.ts')) out.push(p);
  }
  return out;
}

/** Colours in a text, with the line each sits on. Comment lines are skipped — prose quotes colours. */
function coloursIn(text) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
    for (const re of [HEX, RGB]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        // `#123` inside a URL fragment or an id is not a colour.
        if (m[0].startsWith('#') && /[\w/-]$/.test(line.slice(0, m.index))) continue;
        const c = parseColour(m[0]);
        if (c) found.push({ c, line: i + 1, raw: m[0] });
      }
    }
  });
  return found;
}

function gradientsIn(text) {
  const out = [];
  GRADIENT.lastIndex = 0;
  let m;
  while ((m = GRADIENT.exec(text))) out.push(m[0].replace(/\s+/g, ' '));
  return out;
}

export function protoPalette() {
  const palette = new Map();
  const gradients = new Map();
  for (const f of readdirSync(PROTO_DIR).filter((n) => n.endsWith('.dc.html'))) {
    const text = readFileSync(join(PROTO_DIR, f), 'utf8');
    for (const { c } of coloursIn(text)) {
      const k = key(c);
      if (!palette.has(k)) palette.set(k, { c, files: new Set() });
      palette.get(k).files.add(f.replace('.dc.html', ''));
    }
    for (const g of gradientsIn(text)) {
      if (!gradients.has(g)) gradients.set(g, new Set());
      gradients.get(g).add(f.replace('.dc.html', ''));
    }
  }
  return { palette, gradients };
}

function appUsages() {
  const usages = new Map();
  const gradients = new Map();
  for (const f of APP_DIRS.flatMap((d) => walk(d))) {
    const text = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f);
    for (const { c, line, raw } of coloursIn(text)) {
      const k = key(c);
      if (!usages.has(k)) usages.set(k, { c, at: [] });
      usages.get(k).at.push(`${rel}:${line} ${raw}`);
    }
    for (const g of gradientsIn(text)) {
      if (!gradients.has(g)) gradients.set(g, []);
      gradients.get(g).push(rel);
    }
  }
  return { usages, gradients };
}

const isCli = process.argv[1]?.endsWith('palette.mjs');
if (isCli) {
  const args = process.argv.slice(2);
  const nearArg = args.indexOf('--near');
  const nearMax = nearArg >= 0 ? Number(args[nearArg + 1]) : Infinity;
  const proto = protoPalette();
  const app = appUsages();

  if (args.includes('--gradients')) {
    console.log(`── prototype gradients (${proto.gradients.size}) ──`);
    for (const [g, files] of proto.gradients) console.log(`  ${g}\n      in ${[...files].join(', ')}`);
    console.log(`\n── app gradients with no identical prototype gradient (${[...app.gradients.keys()].filter((g) => !proto.gradients.has(g)).length}) ──`);
    for (const [g, files] of app.gradients) if (!proto.gradients.has(g)) console.log(`  ${g}\n      in ${[...new Set(files)].join(', ')}`);
  } else {
    const protoColours = [...proto.palette.values()];
    const rows = [];
    for (const { c, at } of app.usages.values()) {
      if (proto.palette.has(key(c))) continue;
      let best;
      let bestD = Infinity;
      for (const p of protoColours) {
        const d = dist(c, p.c);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (bestD > nearMax) continue;
      rows.push({ c, at, best, d: bestD });
    }
    rows.sort((a, b) => a.d - b.d);
    console.log(`prototype palette: ${proto.palette.size} colours · app colours: ${app.usages.size} · not in any prototype: ${rows.length}\n`);
    for (const r of rows) {
      console.log(`${hexOf(r.c).padEnd(14)} nearest ${hexOf(r.best.c).padEnd(14)} Δ${String(r.d).padEnd(4)} (${[...r.best.files].slice(0, 3).join(', ')})`);
      for (const a of r.at.slice(0, 4)) console.log(`      ${a}`);
      if (r.at.length > 4) console.log(`      …and ${r.at.length - 4} more`);
    }
  }
}
