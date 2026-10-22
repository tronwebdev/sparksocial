/**
 * What `max-canvas:static` does to the children underneath it.
 *
 *   node scripts/flatten-audit.mjs
 *
 * ── The failure this exists for ──────────────────────────────────────────
 *
 * `max-canvas:static` is how a canvas-positioned box rejoins the flow below
 * 1300px. It also destroys the containing block for everything absolutely
 * positioned inside it: those children do not become flow items, they
 * re-anchor to the next positioned ancestor, which is usually the dialog root
 * or the page.
 *
 * Two live examples, both found by hand and neither visible to any check we
 * had:
 *
 *   * `CampaignIntro` — its `absolute inset-0` backdrop re-anchored to the
 *     dialog root and, because the card had become a flow item, painted *over*
 *     it. "Create Campaign" and "Setup Later" were unclickable at every width
 *     under 1300. The button's own icon and label were stranded in the
 *     top-left corner of the screen for the same reason.
 *   * `OverviewSection` — three avatar circles rendered 243px above the empty
 *     91x40 gap they were supposed to fill.
 *
 * Neither is an overflow: nothing leaves the viewport, so the responsive audit
 * is silent. Neither is a sibling overlap in the useful sense either — a
 * backdrop is *meant* to cover its siblings. The invariant is structural, so
 * the check is structural.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * An element carrying `max-canvas:static` must leave no direct child
 * absolutely positioned. A child satisfies this three ways:
 *
 *   * it carries its own `max-canvas:static` / `relative` / `hidden` / `fixed`,
 *   * the parent flattens all of them at once with `FLATTEN_NARROW`,
 *   * or it is decoration that says so — `pointer-events-none` with a negative
 *     z-index, which is the backdrop case.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 *
 * A regex tag-matcher, not a parser. It counts `<tag>` / `</tag>` / `<tag/>`
 * and ignores JSX expressions, so a conditional subtree can throw its depth
 * off. It is a lead generator: open what it names and look.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/web/src/components';
const TAG = /<(\/?)([A-Za-z][\w.]*)([^>]*?)(\/?)>/gs;

/** A child that has answered the question for itself. */
const CONVERTED = ['max-canvas:static', 'max-canvas:relative', 'max-canvas:hidden', 'max-canvas:fixed'];

/** A child that is decoration and has said so, in both senses. */
const isInert = (attrs) => attrs.includes('pointer-events-none') && /-z-\d/.test(attrs);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx$/.test(entry)) out.push(path);
  }
  return out;
}

const posix = (p) => p.split(String.fromCharCode(92)).join('/');

const line = (src, i) => src.slice(0, i).split('\n').length;

function audit(file) {
  const src = readFileSync(file, 'utf8');
  const tags = [...src.matchAll(TAG)].map((m) => ({
    at: m.index,
    close: m[1] === '/',
    name: m[2],
    attrs: m[3],
    self: m[4] === '/',
  }));
  const found = [];

  for (let i = 0; i < tags.length; i++) {
    const open = tags[i];
    if (open.close || open.self || !open.attrs.includes('max-canvas:static')) continue;
    // One `FLATTEN_NARROW` on the parent answers for every child at once.
    if (open.attrs.includes('FLATTEN')) continue;

    let depth = 1;
    const stranded = [];
    for (let j = i + 1; j < tags.length && depth > 0; j++) {
      const t = tags[j];
      if (depth === 1 && !t.close && /(^|[\s"`{])absolute([\s"`}]|$)/.test(t.attrs)) {
        if (!CONVERTED.some((c) => t.attrs.includes(c)) && !isInert(t.attrs)) {
          stranded.push(`${t.name}@${line(src, t.at)}`);
        }
      }
      if (t.close) depth--;
      else if (!t.self) depth++;
    }

    if (stranded.length > 0) {
      found.push(`  ${posix(file)}:${line(src, open.at)}  <${open.name}> → ${stranded.join(', ')}`);
    }
  }
  return found;
}

const hits = walk(ROOT).flatMap(audit);

if (hits.length === 0) {
  console.log('No element flattens itself and leaves an absolute child behind.');
} else {
  console.log('Children that lose their containing block below 1300px:\n');
  for (const h of hits) console.log(h);
  console.log(`\n${hits.length} to look at. Open each one — the matcher is a lead generator, not a parser.`);
}
