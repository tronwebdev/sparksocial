/**
 * Which words our screens say that their prototype never does.
 *
 *   node scripts/label-audit.mjs            # every screen, additions only
 *   node scripts/label-audit.mjs dashboard  # one screen, with context
 *
 * ── What question this answers ───────────────────────────────────────────
 *
 * `scripts/colour-audit.mjs` finds colours a screen paints that its design
 * never specifies. This is its structural sibling: **controls and copy that
 * exist in the build and nowhere in the `.dc.html`**.
 *
 * It exists because that class of drift was found by hand and by accident. The
 * Command Center's "Pause campaign" and "Duplicate" were a deliberate addition
 * — the design's hero has no such control, so they were put underneath it —
 * and nothing recorded that they were an addition at all until someone looked
 * at the screen and asked. The calendar's mix bar is the same shape: justified
 * from the content spec's "reviewed at mix level", absent from
 * `SparkSocial Calendar.dc.html`, and discovered only when a reader said it
 * looked wrong.
 *
 * ── What it is, precisely ────────────────────────────────────────────────
 *
 * Every string literal our components render, minus every word the matching
 * prototype contains. An addition is a label in the first set and not the
 * second.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 *
 * Not a defect list. Three kinds of honest result come back as "additions":
 *
 *   * **Empty and error states.** A prototype is one happy frame. "No campaign
 *     running yet" is not drift, it is the state the design did not draw.
 *   * **Real data vocabulary.** The design says "Starsocial Agent"; we say
 *     whatever the brand is called. Anything interpolated is skipped, but a
 *     hardcoded enum label ("Needs Review") still surfaces.
 *   * **Deliberate corrections.** Several were decided against the design on
 *     purpose and the reason is in a comment beside them.
 *
 * So read the output as "things to justify", not "things to delete". The
 * failure it prevents is nobody having looked.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROTO = 'ui build';
const ROOT = 'apps/web/src/components';

/**
 * Which prototype backs which component directory.
 *
 * A directory rather than a route, because that is how the components are
 * grouped and how a reader navigates to fix something. `shell` has no entry:
 * its furniture appears on every screen, so "absent from one prototype" means
 * nothing there.
 */
const SCREENS = [
  { dir: 'dashboard', proto: 'SparkSocial Dashboard.dc.html' },
  { dir: 'calendar', proto: 'SparkSocial Calendar.dc.html' },
  { dir: 'discovery', proto: 'SparkSocial Discovery.dc.html' },
  { dir: 'command-center', proto: 'SparkSocial Command Center.dc.html' },
  { dir: 'assets', proto: 'SparkSocial Assets Library.dc.html' },
  { dir: 'automation', proto: 'SparkSocial Automation.dc.html' },
  { dir: 'agency', proto: 'SparkSocial Agency Portal.dc.html' },
  { dir: 'settings', proto: 'SparkSocial Settings.dc.html' },
  { dir: 'account', proto: 'SparkSocial Account Home.dc.html' },
  { dir: 'campaign', proto: 'SparkSocial Create Campaign.dc.html' },
  { dir: 'onboarding', proto: 'SparkSocial Onboarding.dc.html' },
];

/*
 * `engagement/` has no top-level prototype of its own — the design covers it
 * through `Settings WS EI *` and the Command Center's tabs — so it is left out
 * rather than diffed against a file that was never meant to hold it.
 */

/** Chrome, punctuation and words too short to mean anything on their own. */
const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'with', 'from', 'this', 'that', 'not', 'are', 'was']);

/**
 * A rendered label, as opposed to a class name, a URL or a prop.
 *
 * JSX text and the handful of attributes that reach a person — `title`,
 * `placeholder`, `aria-label`. Deliberately not `className`, which is the other
 * audit's job, and not template literals, which are usually interpolated data.
 */
function labels(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const out = [];

  /*
   * Controls and headings only — not prose.
   *
   * The first version took every JSX text node and returned 699 labels across
   * eleven screens, which is not a list anybody reads. Almost all of it was
   * copy: helper sentences, empty-state paragraphs, tooltips. A prototype is
   * one frame of one state and will never contain most of that, so flagging it
   * measures nothing.
   *
   * What a reader means by "an element that should not be there" is a control
   * or a heading. So: the text inside `<button>`, `<a>` and `<h1>`-`<h4>`, and
   * nothing longer than six words — past that it is a sentence, whatever
   * tag it is wearing.
   */
  for (const m of code.matchAll(/<(?:button|a|h[1-4])\b[^>]*>\s*([A-Z][^<>{}\n]{2,40}?)\s*</g)) out.push(m[1]);

  return out
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => /[a-z]/.test(s) && !/^[A-Z_]+$/.test(s))
    .filter((s) => s.split(' ').length <= 6);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx$/.test(entry)) out.push(path);
  }
  return out;
}

/** The prototype's words, lowercased and whitespace-flattened, for substring tests. */
function protoText(file) {
  const html = readFileSync(join(PROTO, file), 'utf8');
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const only = process.argv[2];
let total = 0;

for (const screen of SCREENS) {
  if (only && screen.dir !== only) continue;

  let text;
  try {
    text = protoText(screen.proto);
  } catch {
    console.log(`\n${screen.dir}: no prototype at "${screen.proto}" — skipped.`);
    continue;
  }

  const seen = new Map();
  for (const file of walk(join(ROOT, screen.dir))) {
    for (const label of labels(readFileSync(file, 'utf8'))) {
      const probe = label.toLowerCase();
      if (text.includes(probe)) continue;
      // A label whose every significant word appears somewhere is probably the
      // same control reworded, not a new one. Only flag what is wholly absent.
      const words = probe.split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));
      if (words.length > 0 && words.every((w) => text.includes(w))) continue;
      if (!seen.has(label)) seen.set(label, file.replace(`${ROOT}/`, '').replace(/\\/g, '/'));
    }
  }

  total += seen.size;
  console.log(`\n── ${screen.dir} — ${seen.size} in the build, not in the design ──`);
  for (const [label, file] of [...seen].sort()) {
    console.log(`   ${label.length > 52 ? `${label.slice(0, 49)}…` : label.padEnd(52)}  ${file}`);
  }
}

console.log(`\n${total} labels across ${only ? 1 : SCREENS.length} screens.`);
console.log('Read the header: empty states, real data and deliberate corrections all land here too.');
