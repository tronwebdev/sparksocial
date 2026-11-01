/**
 * Colour fidelity: the prototype's paint against the live screen's, element by
 * element.
 *
 *   node scripts/fidelity/colours.mjs dashboard     # one screen, every colour difference
 *   node scripts/fidelity/colours.mjs --summary     # one line per screen with both dumps
 *
 * Reads the same dumps as `diff.mjs` (`extract.js` records text colour, box
 * background / gradient / border / shadow, and icon fill / stroke).
 *
 * ── How elements are paired ──────────────────────────────────────────────
 *
 * Text pairs by its words (`diff.mjs`'s `pair`), and the paired labels give
 * the screen's offset. Boxes and icons have no words, so they pair by
 * geometry once that offset is removed: same place within 24px, same size
 * within 8px or 6%. A box that pairs is the same card, chip or panel on both
 * sides, and every colour on it is compared.
 *
 * ── Tolerance ────────────────────────────────────────────────────────────
 *
 * 4 per channel (0-255; alpha × 255). Computed colours are exact — the
 * prototype's `#838383` reads back as `rgb(131, 131, 131)` — so anything over
 * rounding is a different colour, not noise.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pair } from './diff.mjs';

const DIR = join(process.cwd(), 'scripts', 'fidelity', 'dumps');
const TOL = 4;

const load = (n) => {
  const p = join(DIR, `${n}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined;
};

const COLOUR = /rgba?\([^)]*\)|color\(srgb[^)]*\)/g;

function rgba(c) {
  const v = (c ?? '').trim();
  let m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  m = /^color\(srgb\s+([^)]+)\)$/.exec(v);
  if (m) {
    const [rgb, alpha] = m[1].split('/').map((x) => x.trim());
    const [r, g, b] = rgb.split(/\s+/).map(Number);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), alpha !== undefined ? Number(alpha) : 1];
  }
  return undefined;
}

const d = (a, b) => {
  const x = rgba(a);
  const y = rgba(b);
  if (!x || !y) return 0;
  return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2]), Math.abs(x[3] - y[3]) * 255);
};

export function hex(c) {
  const p = rgba(c);
  if (!p) return String(c);
  const h = (n) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(p[0])}${h(p[1])}${h(p[2])}${p[3] < 1 ? `@${Math.round(p[3] * 100)}%` : ''}`;
}

const transparent = (c) => (rgba(c)?.[3] ?? 0) === 0;
const coloursOf = (s) => (s ?? '').match(COLOUR) ?? [];
/**
 * A gradient's shape with its colours taken out: type, angle, stop positions —
 * with implicit first/last stop positions written out (`C` is `C 0%` at the
 * start and `C 100%` at the end), and linear angles reflected when the element
 * is mirrored (`flip`, a `scaleX(-1)` on it or an ancestor), so a design that
 * mirrors a card and an app that bakes the mirror into the angle compare equal.
 */
function skeleton(g, flip) {
  let s = (g ?? '').replace(COLOUR, 'C').replace(/\s+/g, ' ');
  s = s.replace(/(linear|radial|conic)-gradient\(([^()]*)\)/g, (_, type, body) => {
    const parts = body.split(',').map((x) => x.trim());
    const stopIdx = parts.map((x, i) => (x.startsWith('C') ? i : -1)).filter((i) => i >= 0);
    if (stopIdx.length) {
      const first = stopIdx[0];
      const last = stopIdx[stopIdx.length - 1];
      if (parts[first] === 'C') parts[first] = 'C 0%';
      if (parts[last] === 'C') parts[last] = 'C 100%';
    }
    if (type === 'linear' && flip && /^-?[\d.]+deg$/.test(parts[0])) {
      const deg = -parseFloat(parts[0]);
      parts[0] = `${Math.round(deg * 1000) / 1000}deg`;
    }
    if (type === 'linear' && /^-?[\d.]+deg$/.test(parts[0])) {
      // One turn is one turn: -157.442deg and 202.558deg are the same direction.
      const deg = ((parseFloat(parts[0]) % 360) + 360) % 360;
      parts[0] = `${Math.round(deg * 1000) / 1000}deg`;
    }
    return `${type}-gradient(${parts.join(', ')})`;
  });
  return s;
}

/**
 * A `linear-gradient(X, X)` layer is a flat colour written as an image — the
 * app does this so a colour and a gradient survive `tailwind-merge` on one
 * element. It is the same paint as `background-color: X`, so it is compared as
 * that.
 */
const SOLID = /,?\s*linear-gradient\((rgba?\([^)]*\)|color\(srgb[^)]*\)),\s*\1\)/;
function peelSolid(box) {
  if (!box.grad) return box;
  const m = SOLID.exec(box.grad);
  if (!m) return box;
  const grad = box.grad.replace(m[0], '').trim().replace(/^,\s*/, '');
  return { ...box, grad: grad || undefined, bg: m[1] };
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Lists of colours that should match one for one: report each that does not. */
function compareList(proto, live, what) {
  const out = [];
  if (proto.length !== live.length) {
    out.push(`${what}: ${proto.length} colours → ${live.length} (${proto.map(hex).join(' ')} → ${live.map(hex).join(' ')})`);
    return out;
  }
  proto.forEach((p, i) => {
    if (d(p, live[i]) > TOL) out.push(`${what} ${i + 1}: ${hex(p)} → ${hex(live[i])}`);
  });
  return out;
}

function pairByGeometry(protoItems, liveItems, off) {
  const free = liveItems.map((l, i) => ({ ...l, i }));
  const pairs = [];
  const unpaired = [];
  for (const p of protoItems) {
    let best;
    let bestCost = Infinity;
    for (const l of free) {
      if (l.used) continue;
      const dx = Math.abs(l.x - p.x - off.x);
      const dy = Math.abs(l.y - p.y - off.y);
      const dw = Math.abs(l.w - p.w);
      const dh = Math.abs(l.h - p.h);
      if (dx > 24 || dy > 24) continue;
      if (dw > Math.max(8, p.w * 0.06) || dh > Math.max(8, p.h * 0.06)) continue;
      const cost = dx + dy + dw + dh;
      if (cost < bestCost) {
        bestCost = cost;
        best = l;
      }
    }
    if (best) {
      best.used = true;
      pairs.push({ p, l: best });
    } else unpaired.push(p);
  }
  return { pairs, unpaired };
}

export function compareColours(name) {
  const proto = load(`${name}.proto`);
  const live = load(`${name}.live`);
  if (!proto || !live) return undefined;

  const text = pair(proto, live);
  const off = {
    x: median(text.pairs.map(({ p, l }) => l.x - p.x)),
    y: median(text.pairs.map(({ p, l }) => l.y - p.y)),
  };

  const findings = [];

  for (const { p, l } of text.pairs) {
    if (d(p.c, l.c) > TOL) findings.push({ kind: 'text', at: `${p.x},${p.y}`, what: p.t.slice(0, 40), issues: [`${hex(p.c)} → ${hex(l.c)}`] });
  }

  const boxes = pairByGeometry(proto.boxes ?? [], live.boxes ?? [], off);
  for (const pair of boxes.pairs) {
    const p = peelSolid(pair.p);
    const l = peelSolid(pair.l);
    const issues = [];
    const pbg = transparent(p.bg) ? undefined : p.bg;
    const lbg = transparent(l.bg) ? undefined : l.bg;
    if (pbg && !lbg && !l.grad) issues.push(`background ${hex(pbg)} → none`);
    else if (!pbg && lbg && !p.grad) issues.push(`background none → ${hex(lbg)}`);
    else if (pbg && lbg && d(pbg, lbg) > TOL) issues.push(`background ${hex(pbg)} → ${hex(lbg)}`);

    if (p.grad || l.grad) {
      if (!p.grad) issues.push(`gradient added: ${l.grad.slice(0, 90)}`);
      else if (!l.grad) issues.push(`gradient missing: ${p.grad.slice(0, 90)}`);
      else {
        if (skeleton(p.grad, p.flip) !== skeleton(l.grad, l.flip)) issues.push(`gradient shape ${skeleton(p.grad, p.flip).slice(0, 80)} → ${skeleton(l.grad, l.flip).slice(0, 80)}`);
        issues.push(...compareList(coloursOf(p.grad), coloursOf(l.grad), 'gradient stop'));
      }
    }

    if (p.bc || l.bc) {
      const [, pc] = (p.bc ?? '').split(/ (.+)/);
      const [, lc] = (l.bc ?? '').split(/ (.+)/);
      if (!p.bc) issues.push(`border added ${l.bc}`);
      else if (!l.bc) issues.push(`border missing ${p.bc}`);
      else if (d(pc, lc) > TOL) issues.push(`border ${hex(pc)} → ${hex(lc)}`);
    }

    if (p.sh || l.sh) {
      if (!p.sh) issues.push(`shadow added ${coloursOf(l.sh).map(hex).join(' ')}`);
      else if (!l.sh) issues.push(`shadow missing ${coloursOf(p.sh).map(hex).join(' ')}`);
      else issues.push(...compareList(coloursOf(p.sh), coloursOf(l.sh), 'shadow'));
    }

    if (issues.length) findings.push({ kind: 'box', at: `${p.x},${p.y} ${p.w}×${p.h}`, what: (p.inner ?? l.inner ?? '').slice(0, 40), issues });
  }

  const icons = pairByGeometry(proto.icons ?? [], live.icons ?? [], off);
  for (const { p, l } of icons.pairs) {
    const issues = [];
    for (const paint of p.paints) {
      if (paint.endsWith('gradient')) continue;
      const [kind, colour] = [paint.slice(0, 1), paint.slice(2)];
      // Fill or stroke, either: a glyph drawn as an outline in one and a filled
      // shape in the other is the same colour on screen.
      const match = l.paints.some((q) => !q.endsWith('gradient') && d(q.slice(2), colour) <= TOL);
      if (!match) {
        const theirs = l.paints.filter((q) => !q.endsWith('gradient')).map((q) => hex(q.slice(2)));
        issues.push(`${kind === 'f' ? 'fill' : 'stroke'} ${hex(colour)} → ${theirs.join(' ') || 'none'}`);
      }
    }
    if (issues.length) findings.push({ kind: 'icon', at: `${p.x},${p.y} ${p.w}×${p.h}`, what: '', issues });
  }

  return {
    name,
    offset: off,
    coverage: {
      text: `${text.pairs.length}/${proto.texts.length}`,
      boxes: `${boxes.pairs.length}/${(proto.boxes ?? []).length}`,
      icons: `${icons.pairs.length}/${(proto.icons ?? []).length}`,
    },
    findings,
  };
}

function screens() {
  const names = new Set();
  for (const f of readdirSync(DIR)) {
    const m = /^(.+)\.(proto|live)\.json$/.exec(f);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

const isCli = process.argv[1]?.endsWith('colours.mjs');
if (isCli) {
  const args = process.argv.slice(2);
  if (args[0] === '--summary') {
    console.log('screen'.padEnd(26), 'text'.padStart(9), 'boxes'.padStart(9), 'icons'.padStart(9), 'findings'.padStart(9));
    for (const n of screens()) {
      const r = compareColours(n);
      if (!r) continue;
      console.log(n.padEnd(26), r.coverage.text.padStart(9), r.coverage.boxes.padStart(9), r.coverage.icons.padStart(9), String(r.findings.length).padStart(9));
    }
  } else if (args[0]) {
    const r = compareColours(args[0]);
    if (!r) {
      console.error(`Need dumps/${args[0]}.proto.json and .live.json`);
      process.exit(1);
    }
    console.log(`══ ${r.name} ══ paired text ${r.coverage.text} · boxes ${r.coverage.boxes} · icons ${r.coverage.icons} · offset ${r.offset.x},${r.offset.y}`);
    for (const f of r.findings) console.log(`  [${f.kind}] ${f.at.padEnd(20)} ${f.what.padEnd(40)} ${f.issues.join(' · ')}`);
  } else {
    console.log('usage: node scripts/fidelity/colours.mjs <screen> | --summary');
  }
}
