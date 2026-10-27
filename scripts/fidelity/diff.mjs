/**
 * Compares a prototype's layout dump with the live screen's.
 *
 *   node scripts/fidelity/diff.mjs calendar            # reads dumps/calendar.proto.json + .live.json
 *   node scripts/fidelity/diff.mjs calendar --all      # every matched label, not just the drifted ones
 *   node scripts/fidelity/diff.mjs --summary           # one line per screen that has both dumps
 *
 * ── How text is paired ───────────────────────────────────────────────────
 *
 * By its words, lowercased. A label that appears once on each side pairs with
 * itself; one that appears several times pairs with the nearest instance, so
 * three "Edit slide" links pair by position rather than by order.
 *
 * The live screen shows real data and the prototype shows mock data, so a lot
 * of text will not pair at all — "Starsocial Agent" is not "Clientforce". That
 * is why the report separates *drift* (paired, but different) from *absence*
 * (one side only). Drift is a defect with certainty. Absence is a lead: it is
 * either a missing element or a different piece of data, and only reading it
 * tells you which.
 *
 * ── Why positions are read relative to a common offset ──────────────────
 *
 * If the live screen sits 20px lower than the prototype — a different header,
 * a different shell — every single label is "20px off", and a report listing
 * all of them hides the one that is 20px off *from the rest*. So the median
 * displacement of the paired labels is taken as the screen's offset, and
 * drift is measured from that.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'scripts', 'fidelity', 'dumps');

/** Tolerances. Below these a difference is rendering noise, not design. */
const POS_TOL = 6;
const SIZE_TOL = 0.6;

const norm = (t) => t.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

function load(name) {
  const p = join(DIR, `${name}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined;
}

function median(xs) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** rgb(a) string → [r,g,b,a]. */
function rgba(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
  if (!m) return [0, 0, 0, 1];
  const p = m[1].split(',').map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
}

function colourDiff(a, b) {
  const x = rgba(a);
  const y = rgba(b);
  return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2]), Math.abs(x[3] - y[3]) * 255);
}

function hex(c) {
  const [r, g, b, a] = rgba(c);
  const h = (n) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? `@${Math.round(a * 100)}%` : ''}`;
}

export function pair(proto, live) {
  const remaining = live.texts.map((t, i) => ({ ...t, i, k: norm(t.t) }));
  const byKey = new Map();
  for (const t of remaining) {
    if (!byKey.has(t.k)) byKey.set(t.k, []);
    byKey.get(t.k).push(t);
  }

  const pairs = [];
  const missing = [];
  for (const p of proto.texts) {
    const k = norm(p.t);
    if (k.length < 2) continue;
    const pool = byKey.get(k);
    if (!pool || pool.length === 0) {
      missing.push(p);
      continue;
    }
    let best = 0;
    let bestD = Infinity;
    pool.forEach((l, i) => {
      const d = Math.hypot(l.x - p.x, l.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const [l] = pool.splice(best, 1);
    l.used = true;
    pairs.push({ p, l });
  }

  const extra = remaining.filter((t) => !t.used && t.k.length >= 2);
  return { pairs, missing, extra };
}

export function compare(name) {
  const proto = load(`${name}.proto`);
  const live = load(`${name}.live`);
  if (!proto || !live) return undefined;

  const { pairs, missing, extra } = pair(proto, live);
  const offX = median(pairs.map(({ p, l }) => l.x - p.x));
  const offY = median(pairs.map(({ p, l }) => l.y - p.y));

  const drift = [];
  for (const { p, l } of pairs) {
    const issues = [];
    const dx = l.x - p.x - offX;
    const dy = l.y - p.y - offY;
    if (Math.abs(dx) > POS_TOL || Math.abs(dy) > POS_TOL) issues.push(`moved ${dx > 0 ? '+' : ''}${dx},${dy > 0 ? '+' : ''}${dy}`);
    if (Math.abs(l.fs - p.fs) > SIZE_TOL) issues.push(`size ${p.fs}→${l.fs}`);
    if (l.fw !== p.fw) issues.push(`weight ${p.fw}→${l.fw}`);
    if (colourDiff(l.c, p.c) > 18) issues.push(`colour ${hex(p.c)}→${hex(l.c)}`);
    if (p.ff && l.ff && p.ff.toLowerCase() !== l.ff.toLowerCase()) issues.push(`face ${p.ff}→${l.ff}`);
    if (issues.length) drift.push({ t: p.t, at: `${p.x},${p.y}`, issues });
  }

  return {
    name,
    viewport: { proto: proto.viewport, live: live.viewport },
    totals: { proto: proto.texts.length, live: live.texts.length, paired: pairs.length },
    offset: { x: offX, y: offY },
    drift,
    missing,
    extra,
    pairs,
  };
}

function screens() {
  if (!existsSync(DIR)) return [];
  const names = new Set();
  for (const f of readdirSync(DIR)) {
    const m = /^(.+)\.(proto|live)\.json$/.exec(f);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

function report(r, all) {
  const pct = r.totals.proto ? Math.round((r.totals.paired / r.totals.proto) * 100) : 0;
  console.log(`\n══ ${r.name} ══`);
  console.log(
    `paired ${r.totals.paired} of ${r.totals.proto} prototype labels (${pct}%) · live has ${r.totals.live} · ` +
      `screen offset ${r.offset.x},${r.offset.y}`,
  );

  console.log(`\n── drift: ${r.drift.length} paired labels that differ ──`);
  for (const d of r.drift.slice(0, all ? 999 : 40)) {
    console.log(`  ${d.t.slice(0, 44).padEnd(44)} @${d.at.padEnd(10)} ${d.issues.join(' · ')}`);
  }

  console.log(`\n── in the prototype, not found live: ${r.missing.length} ──`);
  for (const m of r.missing.slice(0, all ? 999 : 40)) {
    console.log(`  ${m.t.slice(0, 60).padEnd(60)} @${m.x},${m.y} ${m.fs}/${m.fw}`);
  }

  console.log(`\n── live only: ${r.extra.length} ──`);
  for (const e of r.extra.slice(0, all ? 999 : 25)) {
    console.log(`  ${e.t.slice(0, 60).padEnd(60)} @${e.x},${e.y} ${e.fs}/${e.fw}`);
  }
}

const args = process.argv.slice(2);
if (args.includes('--summary')) {
  console.log('screen'.padEnd(26), 'paired'.padStart(10), 'drift'.padStart(7), 'missing'.padStart(8), 'extra'.padStart(6), ' offset');
  for (const n of screens()) {
    const r = compare(n);
    if (!r) continue;
    console.log(
      n.padEnd(26),
      `${r.totals.paired}/${r.totals.proto}`.padStart(10),
      String(r.drift.length).padStart(7),
      String(r.missing.length).padStart(8),
      String(r.extra.length).padStart(6),
      ` ${r.offset.x},${r.offset.y}`,
    );
  }
} else if (args[0]) {
  const r = compare(args[0]);
  if (!r) {
    console.error(`Need both dumps/${args[0]}.proto.json and dumps/${args[0]}.live.json.`);
    process.exit(1);
  }
  report(r, args.includes('--all'));
} else {
  console.log('usage: node scripts/fidelity/diff.mjs <screen> [--all] | --summary');
}
