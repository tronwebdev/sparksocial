/**
 * Summarises the `resp.*` dumps written by `responsive.js`.
 *
 *   node scripts/fidelity/responsive-report.mjs                 # one line per route × size
 *   node scripts/fidelity/responsive-report.mjs home            # every finding for routes matching "home"
 *   node scripts/fidelity/responsive-report.mjs home 390x844    # … at one size
 *
 * Findings are grouped by what they are about (kind + selector + text), so the
 * same broken element reported at five sizes reads as one defect with five
 * sizes, which is how it gets fixed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'scripts', 'fidelity', 'dumps');
const [filter, sizeFilter] = process.argv.slice(2);

const dumps = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.startsWith('resp.') && f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')))
  : [];

const sizeKey = (d) => `${d.size[0]}x${d.size[1]}`;

if (!filter) {
  const routes = [...new Set(dumps.map((d) => d.path))].sort();
  const sizes = [...new Set(dumps.map(sizeKey))].sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
  console.log('route'.padEnd(28), sizes.map((s) => s.padStart(10)).join(''));
  for (const r of routes) {
    const row = sizes.map((s) => {
      const d = dumps.find((x) => x.path === r && sizeKey(x) === s);
      if (!d) return '-'.padStart(10);
      const flag = d.landed !== d.path ? '→' : d.settled ? '' : '?';
      return `${d.issues.length}${flag}`.padStart(10);
    });
    console.log(r.padEnd(28), row.join(''));
  }
  const kinds = {};
  for (const d of dumps) for (const i of d.issues) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
  console.log('\nby kind:', JSON.stringify(kinds), '   (→ redirected, ? did not settle)');
} else {
  const groups = new Map();
  for (const d of dumps) {
    if (!d.path.includes(filter)) continue;
    if (sizeFilter && sizeKey(d) !== sizeFilter) continue;
    for (const i of d.issues) {
      const k = `${d.path} | ${i.kind} | ${i.sel ?? ''} | ${i.t ?? ''} | ${i.t2 ?? ''}`;
      if (!groups.has(k)) groups.set(k, { i, path: d.path, sizes: [] });
      groups.get(k).sizes.push(`${sizeKey(d)}${i.at ? `@${i.at.x},${i.at.y}` : ''}`);
    }
  }
  const sorted = [...groups.values()].sort((a, b) => a.path.localeCompare(b.path) || a.i.kind.localeCompare(b.i.kind));
  for (const { i, path, sizes } of sorted) {
    console.log(`\n[${path}] ${i.kind.toUpperCase()}  "${i.t ?? ''}"${i.t2 ? `  ×  "${i.t2}"` : ''}`);
    console.log(`   ${i.detail ?? ''}`);
    if (i.sel) console.log(`   ${i.sel}`);
    if (i.sel2) console.log(`   ${i.sel2}`);
    console.log(`   at ${sizes.join('  ')}`);
  }
  console.log(`\n${sorted.length} distinct findings`);
}
