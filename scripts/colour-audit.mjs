/**
 * Colours a screen paints that its own design never specified.
 *
 * ── Why per-screen, after a global pass said little ──────────────────────
 *
 * The first version compared every hex in `apps/web` against the union of all
 * 61 prototypes. It reported 76 "invented" colours and 43 near-misses, and
 * spot-checking three of them showed the global comparison cannot tell drift
 * from legitimate novelty:
 *
 *   * `#F1F4F8` in `AccountPicker` is nearest `#F3F4F8` in the union — but the
 *     Automation design's own avatar circle is `#F8F8F8`. "Closest" is a hint,
 *     never a verdict.
 *   * `#F1F1F4` in `PlanQueue` is nearest `#F1F1F3` from the *Assets Library*
 *     design, a different screen entirely. Command Center's design has no
 *     `#F1F1F*` at all — because that colour is the fallback chip for an
 *     *unknown* status, a state the prototype never drew.
 *
 * So the question is not "is this hex anywhere in the design folder" but "is
 * it in the design for *this* screen". Scoped that way a hit is worth reading,
 * and a miss is usually UI for a state the prototype does not cover — which is
 * most of what the app has had to invent: empty states, unknown statuses,
 * errors. The prototype draws one populated happy path per screen.
 *
 * ── What it still cannot judge ───────────────────────────────────────────
 *
 * Three kinds of legitimate off-design colour remain, and no heuristic
 * separates them from drift:
 *
 *   * **Vendor brands.** `settings/` reports 93% off-design, almost entirely
 *     `#e1306c`, `#1877f2`, `#0a66c2`, `#ff0000` — Instagram, Facebook,
 *     LinkedIn, YouTube. They are not the designer's to choose.
 *   * **Product data.** Onboarding's `#1afb06`, `#6c71ff` and friends are the
 *     swatches a *customer* picks from, not chrome.
 *   * **States the prototype omits**, as above.
 *
 * So this ranks screens and produces a worklist. It does not produce verdicts,
 * and a run with findings is the start of the reading rather than the end.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Component directory → the prototypes that are its source of truth. */
const SCREENS = {
  dashboard: ['SparkSocial Dashboard.dc.html'],
  'command-center': ['SparkSocial Command Center.dc.html', 'Spark Chat.dc.html'],
  calendar: ['SparkSocial Calendar.dc.html'],
  assets: ['SparkSocial Assets Library.dc.html'],
  agency: ['SparkSocial Agency Portal.dc.html', 'Settings WS Add Client.dc.html'],
  automation: ['SparkSocial Automation.dc.html'],
  discovery: ['SparkSocial Discovery.dc.html'],
  onboarding: ['SparkSocial Onboarding.dc.html'],
  engagement: ['Settings WS Engagement Start.dc.html', 'Settings WS Engagement Done.dc.html'],
};

const HEX = /#[0-9a-fA-F]{6}\b/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;

const RGB = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;

/**
 * Every colour in a file, as lowercase hex — **including `rgb()` forms**.
 *
 * Reading only `#rrggbb` was wrong, and wrong in the direction that invents
 * work: 48 of the 61 prototypes write at least some colours as
 * `background-color:rgb(183,241,252)`, and the audit called every one of them
 * absent. `OverviewSection`'s banner cites `#B7F1FC` as measured and the
 * design says `rgb(183,241,252)` — the same colour. `PostPreview`'s
 * `#CFFCCF`/`#13AD12`, which this file previously reported as a measurement
 * that existed nowhere, are `rgb(207,252,207)` and `rgb(19,173,18)` in
 * `DP prevText.dc.html`.
 *
 * Alpha is dropped: a colour used at 15% is still that colour, and the hex a
 * component writes is what this compares against.
 */
const toHex = (r, g, b) =>
  '#' + [r, g, b].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');

const hexes = (text) => {
  const out = (text.match(HEX) ?? []).map((h) => h.toLowerCase());
  for (const m of text.matchAll(RGB)) out.push(toHex(m[1], m[2], m[3]));
  return out;
};

/**
 * Comments are not paint.
 *
 * Without this the audit reported `#146b33` in `BrandDetailsStep` — a hex
 * inside a comment explaining a *crawled* colour, which nothing renders — and
 * then reported the comment written to explain that finding. A tool that
 * accuses its own documentation is one nobody reads twice.
 */
const stripComments = (text) => text.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, ' ');

/**
 * Directories that are their own screen and must not be counted under their
 * parent.
 *
 * `command-center/draft-panel/` sits inside the Command Center folder and is
 * checked against the Draft Panel and `DP *` prototypes, not Command Center's.
 * Without this its colours were compared to the wrong design file and reported
 * as invented — `PostPreview`'s avatar among them.
 */
const NESTED = new Set(['draft-panel']);

function walk(dir, out = [], top = true) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (top && NESTED.has(entry)) continue;
      walk(path, out, false);
    } else if (/\.(tsx|ts|css)$/.test(entry)) out.push(path);
  }
  return out;
}

/* `settings/` and `draft-panel/` fan out across many prototypes, so their
   design set is every file whose name starts with the matching prefix. */
const byPrefix = (prefix) => readdirSync('ui build').filter((f) => f.startsWith(prefix));
SCREENS.settings = ['SparkSocial Settings.dc.html', ...byPrefix('Settings ')];
SCREENS['draft-panel'] = ['SparkSocial Draft Panel.dc.html', ...byPrefix('DP ')];

/* `draft-panel` lives under `command-center/`, so its walk starts there. */
const SCREEN_DIR = { 'draft-panel': 'command-center/draft-panel' };

/**
 * Every colour in every prototype, for the second bucket below.
 *
 * A hex missing from *this* screen's design but present in another is usually
 * a design-system value borrowed deliberately — `REGION_BAR` in `TrendDetail`
 * takes its fills from the Calendar prototype and says so, and `#FDF1DF` is
 * the warm chip tint shared by Automation and Calendar. Those are not drift.
 * A hex in no prototype at all is the list actually worth reading.
 */
const EVERY_DESIGN = new Set(
  readdirSync('ui build')
    .filter((f) => f.endsWith('.dc.html'))
    .flatMap((f) => hexes(readFileSync(join('ui build', f), 'utf8'))),
);

const rows = [];
for (const [dir, files] of Object.entries(SCREENS)) {
  const design = new Set(files.flatMap((f) => hexes(readFileSync(join('ui build', f), 'utf8'))));

  let paths;
  try {
    paths = walk(join('apps/web/src/components', SCREEN_DIR[dir] ?? dir));
  } catch (e) {
    /* Only a missing directory is expected. Anything else was being swallowed:
       a typo that left `stripComments` undefined made every screen throw, and
       the report printed its header and nothing else. */
    if (e && e.code === 'ENOENT') continue;
    throw e;
  }

  const used = new Map();
  for (const path of paths) {
    for (const hex of hexes(stripComments(readFileSync(path, 'utf8')))) {
      if (!used.has(hex)) used.set(hex, new Set());
      used.get(hex).add(path.split(/[\\/]/).pop());
    }
  }

  const off = [...used.keys()].filter((h) => !design.has(h));
  rows.push({
    dir,
    total: used.size,
    off,
    /* Borrowed from a sibling prototype, versus in no design at all. */
    borrowed: off.filter((h) => EVERY_DESIGN.has(h)),
    invented: off.filter((h) => !EVERY_DESIGN.has(h)),
  });
}

rows.sort((a, b) => b.invented.length / (b.total || 1) - a.invented.length / (a.total || 1));

const only = process.argv[2];
if (only) {
  const row = rows.find((r) => r.dir === only);
  if (!row) {
    console.error(`no such screen: ${only}\nknown: ${rows.map((r) => r.dir).join(', ')}`);
    process.exit(1);
  }
  console.log(`${row.dir}: ${row.off.length} of ${row.total} not in its own design`);
  console.log(` borrowed from another prototype (${row.borrowed.length}): ${row.borrowed.join(' ')}`);
  console.log(` in no prototype at all  (${row.invented.length}): ${row.invented.join(' ')}`);
} else {
  console.log('screen             colours  borrowed  invented    %');
  for (const r of rows) {
    const pct = r.total ? Math.round((r.invented.length / r.total) * 100) : 0;
    console.log(
      `${r.dir.padEnd(18)} ${String(r.total).padStart(5)}  ${String(r.borrowed.length).padStart(8)}  ${String(r.invented.length).padStart(8)}  ${String(pct).padStart(3)}%   ${r.invented.slice(0, 4).join(' ')}`,
    );
  }
  console.log('\nRun with a screen name for its full list. Read the header before acting on any of it.');
}
