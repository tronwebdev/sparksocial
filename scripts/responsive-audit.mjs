/**
 * Which screens can lose content below the canvas width, and how.
 *
 * ── Why a scan rather than another screen by hand ─────────────────────────
 *
 * Four screens in, the failures stopped being novel. Every one has been one of
 * three kinds:
 *
 *   **stranded** — an absolutely positioned element with a coordinate drawn for
 *   the 1300px frame and no behaviour below it. The settings card put its
 *   Description field 436px off the right of a 900px viewport this way.
 *
 *   One correction worth carrying, because it was repeated several times before
 *   anyone checked it: that field was *off-screen*, not unreachable. The card
 *   sits in an `overflow-x-auto` wrapper, so the content could be scrolled to
 *   sideways. The original measurement read `document.scrollWidth`, saw it
 *   equal the viewport and concluded nothing scrolled — but the scroll
 *   container was the inner div, not the document. Verified afterwards in a
 *   harness: that container reports `scrollWidth` 1300 against `clientWidth`
 *   900, and scrolling it brings the far field inside the viewport.
 *
 *   A form that needs sideways scrolling to reach half its fields is still
 *   worth reflowing. It is not content loss, and saying so was overstating it.
 *   The dashboard header and the calendar filters *are* the stronger case —
 *   neither has a horizontal scroll container anywhere in its file, its page,
 *   its layout or the shell, so there those controls genuinely could not be
 *   reached.
 *
 *   **unfolding** — a `shrink-0` flex row that can neither compress nor wrap.
 *   The dashboard header hid Create Campaign, notifications and Ask Spark at
 *   430px; the calendar's five filters did the same at 900px.
 *
 *   **pinned** — `whitespace-nowrap` on type large enough that one line
 *   outruns its container. The dashboard's agent name ran 34px past the card
 *   that holds it.
 *
 * So the useful thing is no longer "convert the next screen", it is "which of
 * the remaining screens have which of these, and where are they worst". This
 * prints that.
 *
 * ── What it cannot tell you ──────────────────────────────────────────────
 *
 * It reads class strings, so it finds *risk*, not breakage. Three ways it is
 * wrong, all of them in the direction of over-reporting:
 *
 *   * A `shrink-0` row whose children happen to fit is flagged and is fine —
 *     only a declared width is checked, and a container's contents are not
 *     summed.
 *   * `whitespace-nowrap` on a short string — a date, a chip — is flagged and
 *     is correct code.
 *   * An absolute offset inside a small positioned parent moves with it; the
 *     48px threshold filters most of those out and not all.
 *
 * And it cannot see the thing that actually caught the assets library: a screen
 * whose dense parts never render because there is no data. An empty state has
 * nothing to overflow, which looks identical to a screen that is fine.
 *
 * ── What the remaining rows are, as of the fourth pass ───────────────────
 *
 * Worth saying plainly, because the list looks like a work queue and is not:
 * after the loud screens were fixed, nearly every offset still reported is
 * placed *inside a card* rather than on the canvas — `left-[12px] w-[224px]` in
 * a 248px folder tile, `left-[74px] right-[40px]` in an upload row,
 * `left-[124px]` in a wizard step. They move with their parent and they fit.
 *
 * The 48px threshold cannot tell those from a real canvas coordinate, and
 * nothing readable from a class string can: the question is whether the offset
 * exceeds the width of its nearest positioned ancestor, which is a DOM fact.
 * So the remaining rows should be *measured*, not converted, and converting
 * them on the strength of this list would mean editing correct code.
 *
 * Which leaves the one thing neither approach reaches: a screen that renders an
 * empty state. `/assets` says "you don't have any folder currently", so the
 * library never mounts — nothing to overflow, and indistinguishable from fine.
 * Those want the data created first, then a browser.
 *
 * Measure in a browser before acting on any row. This ranks the reading.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/web/src/components';

/**
 * Screens that answer a narrow viewport by *scaling*, not reflowing.
 *
 * `AgencyStage` puts its content on a 1728px stage and applies
 * `transform: scale(min(1, vw / 1728))`; `CampaignWizard` does `pageW / 1728`
 * the same way. Measured on the deployed agency portal at 430px:
 * `scale(0.2488)`, stage exactly 430 wide, zero elements past the viewport. An
 * absolute coordinate inside a stage like that cannot strand — the whole plane
 * shrinks with the window.
 *
 * Excluded because counting them was this scan's largest error: 75 points of
 * agency and 42 of campaign, 117 of about 206, every one a file that already
 * handles the case by other means.
 *
 * Their real problem is the opposite, and this scan cannot see that either. At
 * 0.2488 a 16px label renders at 4px and a 14px one at 3.5px: nothing is lost
 * and nothing can be read. Scaling suits a splash screen — the reasoning
 * `Stage.tsx` records for "Meet Spark" — and suits a client table considerably
 * less. Converting them to flow means rewriting layouts that are absolute by
 * construction, which is a decision rather than a tidy-up, and
 * `AgencyStage`'s own header explains why it was not taken.
 */
const SCALED_STAGE = [/^agency\//, /^campaign\//];

/** Offsets smaller than this sit inside a box rather than on the canvas. */
const CANVAS_OFFSET = 48;

/** What a 430px phone actually leaves for content, measured in the shell. */
const CONTENT_COLUMN = 374;

/** Type big enough that one unbroken line can outrun a column. */
const BIG_TYPE = /text-(2[89]|3\d|4\d|5\d|6\d)(\s|$|")/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Every place a class list can hide.
 *
 * Twice now this function has been the whole bug, both times by reading one
 * form and calling the file clean:
 *
 *   * **The template literal.** A check that read only `className="…"` skipped
 *     the calendar's filter dropdown entirely — passing by not looking at the
 *     one element it was written for.
 *   * **The hoisted constant.** `TrendCard` keeps its footer buttons in
 *     `const GHOST_BTN = 'flex h-[42px] shrink-0 … whitespace-nowrap'` and
 *     applies it through `cn()`. That is exactly the unfoldable shape this scan
 *     exists to find, in a row that measured **90 elements past the viewport**
 *     on the deployed `/discovery` at 430px — and the file ranked 20th with
 *     four unrelated flags, because none of the three offending classes were
 *     attached to a `className` attribute.
 *
 * So: any string literal in the file that carries a layout keyword counts,
 * wherever it was written. That over-reports — a literal may be dead, or
 * concatenated into something else — which is the right direction for a list
 * whose purpose is to rank reading.
 */
const LAYOUT_WORD = /(^|\s)(?:flex|inline-flex|grid|absolute|fixed|sticky)(\s|$)/;

function classNames(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const attrs = [
    ...[...code.matchAll(/className="([^"]+)"/g)].map((m) => m[1]),
    ...[...code.matchAll(/className=\{`([^`]+)`\}/g)].map((m) => m[1]),
  ];
  const literals = [
    ...[...code.matchAll(/'([^'\n]{8,})'/g)].map((m) => m[1]),
    ...[...code.matchAll(/`([^`]{8,})`/g)].map((m) => m[1]),
    ...[...code.matchAll(/"([^"\n]{8,})"/g)].map((m) => m[1]),
  ].filter((v) => LAYOUT_WORD.test(v));
  return [...new Set([...attrs, ...literals])];
}

/**
 * Horizontal offsets only, and only the ones that can actually strand.
 *
 * Two corrections the first version of this file got wrong, both found by
 * checking its own output against `assets/library/FolderCards.tsx`:
 *
 *   **`top-` is not a horizontal risk.** A vertical offset cannot push content
 *   off the right of a viewport. Counting `top-[330px]` alongside `left-[796px]`
 *   inflated the total by more than it reported, and every one of those rows
 *   would have sent somebody to fix correct code.
 *
 *   **Centred is not stranded.** `left-1/2 … -translate-x-1/2` places an
 *   element in the middle of its parent and follows the parent as it narrows;
 *   `max-w-full` caps a fixed width to the space available. Both are already
 *   the behaviour this audit exists to ask for.
 */
const offsets = (c) => {
  if (/left-1\/2/.test(c) && /-translate-x-1\/2/.test(c)) return [];
  if (/max-w-full/.test(c)) return [];
  /*
   * A bare `right-` offset is an anchor, not a coordinate: `right-[53px]`
   * keeps an element 53px inside whatever edge its parent has and follows that
   * edge down to zero width. It only becomes a hazard paired with a `left-`,
   * which is the collapse case — `left-[452px] right-[240px]` resolves to a
   * negative width on a narrow parent, and the browser clamps it to zero.
   * Counting lone `right-` offsets flagged ChatDrawer's two header buttons and
   * the drawer is already correct there.
   */
  const paired = /(^|\s)left-\[\d+px\]/.test(c);
  const pattern = paired ? /(?:left|right)-\[(\d+)px\]/g : /(?:^|\s)left-\[(\d+)px\]/g;
  return [...c.matchAll(pattern)].map((m) => Number(m[1])).filter((n) => n >= CANVAS_OFFSET);
};

function audit(file) {
  const src = readFileSync(file, 'utf8');
  const classes = classNames(src);
  const scrolls = /overflow-x-(?:auto|scroll)/.test(src);
  /**
   * A row that wraps somewhere in this file.
   *
   * `shrink-0` on a child is only a defect if no ancestor can fold, and the
   * ancestor is usually not the element carrying the class — `TrendCard`'s
   * footer buttons are a hoisted constant with no variant of their own, and the
   * `max-canvas:flex-wrap` that fixes them sits on the parent `div`. Reading
   * the class alone kept reporting them after they were fixed.
   *
   * File-level, and therefore coarse in the same way the `min-width` rule is:
   * one wrapping row quiets every `shrink-0` in the file. Deliberate — the loud
   * cases are gone, so silence is the cheaper error.
   */
  const wraps = /flex-wrap/.test(src);
  /**
   * Already answered, by any means.
   *
   * Three things count, and the first two were missed at first:
   *
   *   * **Any responsive variant**, not only `canvas`. `CampaignManage` carries
   *     `max-xl:left-[40px]` on the element this scan was flagging — a narrow
   *     rule written before the contract existed, with a different breakpoint.
   *     Counting only `canvas:` reported screens that were already responsive.
   *   * **`hidden`** paired with a variant that reveals it. Two dots in
   *     `CampaignManage` are `hidden … xl:block`: they do not render at the
   *     widths in question, so their offsets cannot strand anything.
   *   * A declared width or offset the author has already capped.
   */
  const done = (c) =>
    /(^|\s)(?:max-)?(?:sm|md|lg|xl|2xl|canvas):/.test(c) || /(^|\s)hidden(\s|$)/.test(c);

  return {
    stranded: classes.filter((c) => /(^|\s)absolute(\s|$)/.test(c) && offsets(c).length > 0 && !done(c)).length,
    /*
     * `shrink-0` that could plausibly outrun a phone.
     *
     * A declared width that fits 430px cannot strand on its own however
     * stubborn it is, and the assets toolbar is full of exactly that: 176px and
     * 226px buttons, each a flex container for its own icon and label, sitting
     * as `shrink-0` items in a parent that already wraps. The first version of
     * this scan reported all of them.
     *
     * What is still counted is the dangerous shape: `shrink-0` with no declared
     * width, which is how the dashboard header held 610px of children that
     * could neither compress nor fold, or with a width no phone can take.
     */
    unfolding: classes.filter((c) => {
      if (!/(^|\s)flex(\s|$)/.test(c) || !/(^|\s)shrink-0(\s|$)/.test(c)) return false;
      if (wraps || done(c)) return false;
      if (/(^|\s)hidden(\s|$)/.test(c)) return false; // not rendered at the widths in question
      const w = /(?:^|\s)w-\[(\d+)px\]/.exec(c);
      return !w || Number(w[1]) > 430;
    }).length,
    pinned: classes.filter((c) => c.includes('whitespace-nowrap') && BIG_TYPE.test(c) && !done(c)).length,
    /**
     * A fixed floor wider than a phone — unless the file scrolls it.
     *
     * `min-w-[720px]` inside `overflow-x-auto` is the deliberate pattern for a
     * data table, not a defect: `FolderLibrary` uses it, the assets library
     * measured clean at 430px because of it, and `AutomationHome`'s queue was
     * just fixed by adopting it. `WizardSteps` was flagged for a
     * `min-w-[820px]` sitting directly inside an `overflow-x-auto` wrapper.
     *
     * File-level rather than per-element, which is coarse: a file with a scroll
     * container anywhere stops being flagged for any floor. It errs toward
     * silence, which for a risk list is the right direction once the loud
     * cases are gone.
     */
    minWidth: scrolls
      ? 0
      : classes.filter((c) => {
          /*
           * 430 was the wrong number. A phone's *viewport* is 430; its content
           * column is 374 once the shell's gutters are taken out, and a floor
           * only has to beat that. `min-w-[420px]` sailed under this check and
           * put 29 elements past the viewport on `/settings/profile`, the row
           * ending at 491. CONTENT_COLUMN is what was measured there.
           */
          const m = /min-w-\[(\d+)px\]/.exec(c);
          return m && Number(m[1]) > CONTENT_COLUMN && !done(c);
        }).length,
  };
}

const rows = walk(ROOT)
  .map((file) => ({ file: file.replace(/\\/g, '/').replace(`${ROOT}/`, ''), ...audit(file) }))
  .filter((r) => !SCALED_STAGE.some((re) => re.test(r.file)))
  .map((r) => ({ ...r, total: r.stranded + r.unfolding + r.pinned + r.minWidth * 3 }))
  .filter((r) => r.total > 0)
  .sort((a, b) => b.total - a.total);

const sum = (k) => rows.reduce((n, r) => n + r[k], 0);

console.log('screens with at least one risk, worst first');
console.log('(minWidth counts triple — a fixed floor wider than a phone is the strongest signal)\n');
console.log('  rank  strand  unfold  pinned  min-w   file');
rows.slice(0, Number(process.argv[3] ?? 25)).forEach((r, i) => {
  console.log(
    `  ${String(i + 1).padStart(4)}  ${String(r.stranded).padStart(6)}  ${String(r.unfolding).padStart(6)}  ` +
      `${String(r.pinned).padStart(6)}  ${String(r.minWidth).padStart(5)}   ${r.file}`,
  );
});

console.log(
  `\n${rows.length} of ${walk(ROOT).length} component files carry a risk — ` +
    `${sum('stranded')} stranded, ${sum('unfolding')} unfolding, ${sum('pinned')} pinned, ${sum('minWidth')} min-width.`,
);
console.log('Read the header before acting on any of it: these are risks, not failures.');
