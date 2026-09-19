/**
 * Snaps arbitrary `text-[Npx]` classes onto the type scale in `tailwind.config.ts`.
 *
 * ── Why a codemod and not a careful hand pass ─────────────────────────────
 *
 * There were 1,758 of them across 169 files, in 78 distinct sizes — including
 * `13.53px`, `16.915px` and `28.633px`, which are Figma export artefacts rather
 * than anybody's decision. A hand pass over that is a week of work with a
 * guaranteed miss rate, and the misses would be invisible: nothing fails when
 * one caption is 12.5px and its neighbour is 13px.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * It only rewrites the size token. It never touches an explicit `leading-*` on
 * the same element, so anywhere somebody deliberately chose tight or loose
 * leading keeps it; the scale's own line-height applies only where none was
 * set, which is the 1,535 elements that had no opinion.
 *
 * Run with `--check` to print the mapping and change nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/** Must stay in step with `fontSize` in `apps/web/tailwind.config.ts`. */
const SCALE = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 32, 36, 40, 48, 64];

/** Nearest step; ties go up, so 14.5 reads as 15 rather than silently shrinking. */
function snap(px) {
  let best = SCALE[0];
  let bestD = Infinity;
  for (const s of SCALE) {
    const d = Math.abs(s - px);
    if (d < bestD || (d === bestD && s > best)) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

const check = process.argv.includes('--check');
const files = execSync('git ls-files "apps/web/src/**/*.tsx" "apps/web/src/**/*.ts"', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const tally = new Map();
let changedFiles = 0;
let changed = 0;

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(/text-\[(\d+(?:\.\d+)?)px\]/g, (whole, num) => {
    const px = Number(num);
    const to = snap(px);
    const key = `${px} -> ${to}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    changed += 1;
    return `text-${to}`;
  });
  if (after !== before) {
    changedFiles += 1;
    if (!check) writeFileSync(file, after);
  }
}

const rows = [...tally.entries()].sort((a, b) => b[1] - a[1]);
const moved = rows.filter(([k]) => {
  const [from, to] = k.split(' -> ').map(Number);
  return from !== to;
});

console.log(`${changed} classes across ${changedFiles} files.`);
console.log(`${rows.length - moved.length} sizes already on the scale, ${moved.length} snapped:`);
for (const [k, n] of moved) console.log(`  ${k.padEnd(18)} ${n}`);
if (check) console.log('\n--check: nothing written.');
