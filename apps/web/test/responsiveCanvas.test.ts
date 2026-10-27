import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE RESPONSIVE CONTRACT, enforced on the screen that defines it.
 *
 * ── What the contract is ─────────────────────────────────────────────────
 *
 * The `.dc.html` files are fixed-width pixel captures. `Settings WS Overview`
 * draws its card at 1350px inside a 1698px frame, and the build matches it box
 * for box — measured at 1728px: banner 1334x198 r20, fields 672x62 r10,
 * description 543x177 r10, columns 672/33/543. That is what CLAUDE.md's
 * frontend rules ask for and it is not in question here.
 *
 * What the captures never say is what happens below their own width, and what
 * the build did with that silence was `min-w-[1300px]` inside a container that
 * does not scroll. Measured on the deployed site at 900px: the Description
 * field sat at x=793 with its right edge at 1336 — 436px past the viewport —
 * while `document.scrollWidth` was 885, so nothing could scroll to reach it.
 * The field was not cramped. It was gone.
 *
 * So `canvas` (1300px, in `tailwind.config.ts`) names the one width the design
 * actually specifies. `canvas:` is the design's own layout untouched;
 * `max-canvas:` is the part the design never drew.
 *
 * ── Why this is a source check and not a layout one ──────────────────────
 *
 * The thing that regresses is not arithmetic — it is somebody adding a tenth
 * positioned element to this card and giving it no behaviour below `canvas`,
 * which puts it back off the side of the screen at every narrow width. A jsdom
 * test cannot catch that: it would need a real layout engine and the media
 * query to apply. A source check can, cheaply, and it fails where the mistake
 * is made.
 *
 * The layout itself was verified in a browser against a harness built from
 * these exact class strings, at 1728 / 1280 / 900 / 430: desktop geometry
 * unchanged at 1728 (name x50 y291 w560, fieldrow x47 y447 w1249), and no
 * element's right edge past the viewport at any of the others.
 */

/**
 * Sources as the canvas contract sees them. A section inside another box
 * switches on its *container's* width (`cq-canvas:` / `max-cq-canvas:`, see
 * `tailwind.config.ts`) rather than the viewport's, and the contract is the
 * same either way: the design's geometry above the line, a rule for every
 * offset below it. So the container spelling reads as the viewport one here,
 * and the test that the container exists is below.
 */
const read = (rel: string) =>
  readFileSync(join(__dirname, '..', rel), 'utf8')
    .replace(/max-cq-canvas:/g, 'max-canvas:')
    .replace(/cq-canvas:/g, 'canvas:')
    // A component drawn to a narrower box than the canvas switches at its own
    // width — the plan queue's rows at 1099 — and reads the same way here.
    .replace(/\[@container\(max-width:\d+px\)\]:/g, 'max-canvas:');

const SOURCE = read('src/components/settings/OverviewSection.tsx');

/**
 * Every screen converted to the contract so far.
 *
 * A list rather than a glob: the rule is not "no component may position
 * anything", it is "a screen that has been converted stays converted". Adding a
 * file here is the act of adopting the contract, and the check then holds it to
 * it. A glob would fail the 230-odd screens that have not been converted yet
 * and teach everyone to ignore the suite.
 */
const CONVERTED: ReadonlyArray<readonly [string, string]> = [
  ['settings overview', 'src/components/settings/OverviewSection.tsx'],
  ['settings shell', 'src/components/settings/SettingsShell.tsx'],
  ['dashboard banner', 'src/components/dashboard/AgentBanner.tsx'],
  ['calendar filters', 'src/components/command-center/QueueFilters.tsx'],
  ['plan queue', 'src/components/command-center/PlanQueue.tsx'],
  ['agent calendar tab', 'src/components/command-center/AgentCalendarTab.tsx'],
  ['trend card', 'src/components/discovery/TrendCard.tsx'],
];

/**
 * Every class string in the file, comments stripped so prose does not count.
 *
 * Both forms, because the second is where the interesting ones live: a
 * conditional class list is written as `` className={`… ${cond ? a : b}`} ``,
 * and a check that only read `className="…"` silently skipped every one of
 * them. It passed on the calendar's filter dropdown — the exact element the
 * test was added for — by not seeing it at all.
 */
function classNames(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const quoted = [...code.matchAll(/className="([^"]+)"/g)].map((m) => m[1]!);
  const templated = [...code.matchAll(/className=\{`([^`]+)`\}/g)].map((m) => m[1]!);
  return [...quoted, ...templated];
}

/**
 * An offset drawn for the 1300px frame, as opposed to one inside a small box.
 *
 * The three stacked avatar circles are `absolute top-0` *within* a wrapper that
 * is itself positioned and does reflow, so they move with it — they are laid
 * out against their own 91px parent, not against the canvas. Requiring a rule
 * there would be noise that teaches the next reader to add one everywhere, so
 * the threshold is what separates "placed on the canvas" from "placed inside
 * something".
 */
const CANVAS_OFFSET = 48;

function canvasScaleOffsets(className: string): number[] {
  return [...className.matchAll(/(?:left|top|right|bottom)-\[(\d+)px\]/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= CANVAS_OFFSET);
}

describe('the settings overview honours the canvas contract', () => {
  const all = classNames(SOURCE);

  it('gives every canvas-scale offset a rule below canvas', () => {
    const stranded = all.filter(
      (c) => /(^|\s)absolute(\s|$)/.test(c) && !c.includes('max-canvas:') && canvasScaleOffsets(c).length > 0,
    );

    expect(stranded, `canvas-scale offsets with no behaviour below canvas:\n${stranded.join('\n')}`).toEqual([]);
  });

  it('recognises a canvas-scale offset when it sees one', () => {
    // The predicate above is the whole test; a bug in it would pass silently.
    expect(canvasScaleOffsets('absolute left-[796px] top-[256px]')).toEqual([796, 256]);
    expect(canvasScaleOffsets('absolute top-0')).toEqual([]);
    expect(canvasScaleOffsets('absolute top-[8px] left-[8px]')).toEqual([]);
  });

  it('keeps the fixed canvas width behind the canvas breakpoint', () => {
    // An unqualified `min-w-[1300px]` is what made the card wider than the
    // screen with no way to reach the rest of it.
    expect(SOURCE).toContain('canvas:min-w-[1300px]');
    expect(SOURCE).not.toMatch(/className="[^"]*(?:^|\s)min-w-\[1300px\]/);
  });

  it('does not reserve the canvas height when the children are in flow', () => {
    /*
     * The 700px spacer exists only to give absolutely-positioned children a
     * box. Below `canvas` they size the card themselves, so leaving it would be
     * 700px of blank under a phone-width form.
     */
    const spacer = all.find((c) => c.includes('h-[700px]'));
    expect(spacer).toBeDefined();
    expect(spacer).toContain('max-canvas:hidden');
  });

  it('stacks the two field columns rather than letting one fall off the side', () => {
    const row = all.find((c) => c.includes('w-[1249px]'));
    expect(row).toBeDefined();
    expect(row).toContain('max-canvas:flex-col');

    // Both columns give up their fixed width, or the stack is still 672px wide
    // on a 390px screen.
    expect(all.some((c) => c.includes('w-[672px]') && c.includes('max-canvas:w-full'))).toBe(true);
    expect(all.some((c) => c.includes('w-[543px]') && c.includes('max-canvas:w-full'))).toBe(true);
  });
});

describe('the canvas breakpoint is declared once, as shared vocabulary', () => {
  const CONFIG = readFileSync(join(__dirname, '../tailwind.config.ts'), 'utf8');

  /*
   * In the config rather than as `max-[1299px]:` at each call site, so the next
   * screen to reflow inherits the decision instead of picking its own number.
   * Forty screens with forty breakpoints is not a responsive app.
   */
  it('names the width the captures are drawn at', () => {
    expect(CONFIG).toMatch(/screens:\s*\{[^}]*canvas:\s*'1300px'/s);
  });
});

describe('every converted screen keeps its canvas-scale offsets reachable', () => {
  for (const [name, rel] of CONVERTED) {
    it(`${name} strands nothing below canvas`, () => {
      const stranded = classNames(read(rel)).filter(
        (c) => /(^|\s)absolute(\s|$)/.test(c) && !c.includes('max-canvas:') && canvasScaleOffsets(c).length > 0,
      );

      expect(stranded, [rel, ...stranded].join('\n')).toEqual([]);
    });
  }
});

/**
 * The dashboard header, which failed differently and wanted a different fix.
 *
 * The settings card stranded absolutely-positioned children off the side of the
 * screen. The header did it with a `shrink-0` row that could neither compress
 * nor fold: measured at 430px, twelve elements past the viewport, the furthest
 * at x=638, with `scrollWidth` equal to the viewport so none of them could be
 * scrolled to. Create Campaign, notifications and Ask Spark all existed and
 * none could be used.
 *
 * Deliberately fixed without a `canvas` rule. `flex-wrap` folds exactly when
 * the row stops fitting, where a 1300px breakpoint would stack the header on a
 * 1200px laptop that handles it perfectly well today — so the contract's
 * breakpoint is a tool, not a tax on every fix.
 */
describe('the top bar folds instead of overflowing', () => {
  const TOPBAR = read('src/components/shell/TopBar.tsx');
  const rows = classNames(TOPBAR).filter((c) => c.includes('justify-between') || c.includes('justify-end'));

  it('lets the header row wrap', () => {
    expect(rows.some((c) => c.includes('justify-between') && c.includes('flex-wrap'))).toBe(true);
  });

  it('lets the actions row wrap and stops it refusing to shrink', () => {
    const actions = rows.find((c) => c.includes('justify-end'));
    expect(actions).toBeDefined();
    expect(actions).toContain('flex-wrap');
    // `shrink-0` here is what made a 610px block refuse to fold on a 430px screen.
    expect(actions).not.toMatch(/(^|\s)shrink-0(\s|$)/);
  });
});

/**
 * Large type that refuses to wrap is the third way to put content off-screen,
 * and the offset rule above does not see it.
 *
 * The dashboard's agent name is `whitespace-nowrap text-32`, which is the
 * capture's own treatment and correct inside a 1248px card. Measured at 430px
 * it ran to x=464 inside a 179px parent — 34px past the viewport, clipped by
 * the card that contains it. Nothing is absolutely positioned there, so
 * `canvasScaleOffsets` finds nothing and the screen still loses its heading.
 *
 * Small nowrap text is left alone: a chip, a date, a button label is meant not
 * to break, and is narrow enough that it never has to. The rule is about type
 * big enough that one word can outrun a column.
 */
describe('big type is allowed to wrap below canvas', () => {
  const BIG = /text-(2[89]|3\d|4\d)/;

  for (const [name, rel] of CONVERTED) {
    it(`${name} does not pin large type to one line`, () => {
      const pinned = classNames(read(rel)).filter(
        (c) => c.includes('whitespace-nowrap') && BIG.test(c) && !c.includes('max-canvas:whitespace-normal'),
      );

      expect(pinned, [rel, ...pinned].join('\n')).toEqual([]);
    });
  }

  it('recognises the sizes it is about', () => {
    // A bug in the predicate would make every case above pass silently.
    expect(BIG.test('text-32 whitespace-nowrap')).toBe(true);
    expect(BIG.test('text-28')).toBe(true);
    expect(BIG.test('text-16')).toBe(false);
    expect(BIG.test('text-15')).toBe(false);
  });
});

/**
 * The calendar's filter bar, which failed the dashboard's way.
 *
 * Five dropdowns at the capture's 194px with 16px gaps is 1034px before the
 * "Filters:" label, in a row that was `shrink-0` and could not wrap. Measured
 * on the deployed calendar: ten elements past the viewport at 900px with the
 * furthest at x=1245, twenty at 430px reaching x=1229, and `scrollWidth` equal
 * to the viewport both times — so four of the five filters could not be
 * reached at all.
 *
 * Three screens in, the catalogue is holding: stranded absolutes, non-folding
 * rows, pinned type. This is the second of the three, not a fourth kind.
 */
describe('the calendar filters fold instead of overflowing', () => {
  const FILTERS = read('src/components/command-center/QueueFilters.tsx');
  const all = classNames(FILTERS);

  it('lets the filter row wrap, and keeps it on one line at canvas', () => {
    const row = all.find((c) => c.includes('gap-[16px]') && c.includes('flex-wrap'));
    expect(row, 'the filter row no longer wraps').toBeDefined();
    // The capture draws them on one line, right-aligned. That is preserved
    // above the breakpoint rather than traded away for the narrow case.
    expect(row).toContain('canvas:flex-nowrap');
    expect(row).toContain('canvas:ml-auto');
  });

  it('keeps the captured width as a ceiling when the dropdowns give way', () => {
    const select = all.find((c) => c.includes('max-w-[194px]'));
    expect(select).toBeDefined();

    /*
     * The first attempt used `w-[calc(50%-0.5rem)]` below the breakpoint and
     * produced 418px dropdowns at 900px — more than twice the design's width,
     * because 50% of a wide container is wide. The cap is what stops a `grow`
     * overshooting the capture.
     */
    // At every width now, not only below canvas — see the next test.
    expect(select).toMatch(/(^|\s)max-w-\[194px\]/);
    expect(select).not.toContain('calc(50%');
    expect(select).toContain('max-canvas:grow');
    expect(select).toContain('max-canvas:basis-[160px]');
  });

  /*
   * Above canvas the boxes were `w-[194px] shrink-0`. The Agent Calendar card at
   * 1440 is 1343 wide and its header needs ~1440 at 194 apiece, so the boxes
   * held and squeezed "Upcoming action queue" onto three lines instead. A
   * basis rather than a width, too: a width makes each box's min-content 194,
   * so the row could never shrink as a whole, only drop a line.
   */
  it('gives way to 160 above canvas too, from a basis rather than a width', () => {
    const select = all.find((c) => c.includes('basis-[194px]'));
    expect(select).toBeDefined();
    expect(select).not.toMatch(/(^|\s)w-\[194px\]/);
    expect(select).not.toContain('shrink-0');
    expect(select).toMatch(/(^|\s)min-w-\[160px\]/);
  });

  it('does not let the queue heading be squeezed by its filters', () => {
    const header = classNames(read('src/components/command-center/QueueFilters.tsx')).find((c) =>
      c.includes('text-20 font-semibold'),
    );
    expect(header).toContain('whitespace-nowrap');
    expect(header).toContain('shrink-0');
  });
});

/**
 * COLLAPSE — a fourth failure mode, found on the agent calendar band.
 *
 * `left: 452px` together with `right: 240px` resolves to a *negative* width on
 * a parent narrower than their sum. The browser clamps that to zero and
 * `overflow-hidden` finishes the job, so the element is in the DOM, sized to
 * nothing, and invisible. Measured on the deployed `/agents?tab=calendar` at
 * 430px: two rows at width 0, holding "No voice set · Risk Tolerance" and
 * "Analyzing engagement signals".
 *
 * It is worth its own name because every other check here looks for content
 * *outside* the viewport, and this one never leaves it — an overflow scan
 * reports the screen clean while two rows of it have quietly disappeared. The
 * fix differs too: a stranded element only needs to stop being positioned, a
 * collapsed one needs the `left`/`right` pair released.
 *
 * Verified in a harness from the real class strings: those rows go from 0 to
 * 402px wide at 430, and are still 1036px at 452 on a 1728 viewport.
 */
describe('nothing is pinned to both edges of a box it cannot fit', () => {
  for (const [name, rel] of CONVERTED) {
    it(`${name} releases any left/right pair below canvas`, () => {
      const squeezed = classNames(read(rel)).filter((c) => {
        if (!/(^|\s)absolute(\s|$)/.test(c)) return false;
        const left = /(?:^|\s)left-\[(\d+)px\]/.exec(c);
        const right = /(?:^|\s)right-\[(\d+)px\]/.exec(c);
        if (!left || !right) return false;
        // Only a pair wide enough to overrun a phone, and only if nothing
        // below `canvas` takes it out of the equation.
        return Number(left[1]) + Number(right[1]) > 430 && !c.includes('max-canvas:static');
      });

      expect(squeezed, [rel, ...squeezed].join('\n')).toEqual([]);
    });
  }

  it('recognises the shape it is about', () => {
    // A bug in the predicate would make every case above pass in silence.
    const squeeze = (c: string) =>
      /(^|\s)absolute(\s|$)/.test(c) &&
      /left-\[(\d+)px\]/.test(c) &&
      /right-\[(\d+)px\]/.test(c);

    expect(squeeze('absolute left-[452px] right-[240px] top-[26px]')).toBe(true);
    expect(squeeze('absolute left-[452px] top-[107px]')).toBe(false);
    expect(squeeze('absolute right-[27px] top-[28px]')).toBe(false);
  });
});

/**
 * SCROLL, where stacking would destroy the point of the layout.
 *
 * `AutomationHome`'s queue is five columns — `572px 352px 138px 136px 82px`,
 * 1280px of fixed grid track — shared by the header row and every body row,
 * and neither sat in a scroll container. Measured on the deployed
 * `/automation` at 430px: the five column headings were past the viewport with
 * no scrollable ancestor, so "Contents", "Recipe", "Account", "Status" and
 * "Action" could not be reached.
 *
 * Fixed by scrolling rather than by the reflow the other screens got, because a
 * five-column queue is read by comparing rows *down* a column and stacking
 * destroys exactly that. The pattern is already in the codebase:
 * `FolderLibrary` puts a `min-w-[720px]` table inside `overflow-x-auto`, which
 * is why the assets library measured clean at 430px.
 *
 * This file is deliberately not in `CONVERTED`. Its remaining offsets sit
 * inside a card that is already `max-md:w-full`, so a `left-[146px]` chip needs
 * 266px of a 292px card at 320px and is fine; adding the file to the blanket
 * rule would force conversions that are not needed, inside a card whose
 * children are absolute by construction. So the guard is the specific thing
 * that was changed.
 */
describe('the automation queue scrolls instead of stranding its headings', () => {
  const SOURCE_AUTO = read('src/components/automation/AutomationHome.tsx');

  it('wraps the queue card in a scroll container below canvas', () => {
    // Not just `max-w-auto-wide` — the hero carries that token too, and
    // matching on it alone found the hero and reported the card unfixed.
    const card = classNames(SOURCE_AUTO).find(
      (c) => c.includes('max-w-auto-wide') && c.includes('bg-white') && c.includes('pb-[24px]'),
    );
    expect(card, 'the queue card is no longer recognisable').toBeDefined();
    // The table scrolls inside the card — not the card — so the title and the
    // pager stay put; and at every width, because between 1300 and ~1700 the
    // card is narrower than the design too. The tracks have floors, and the
    // scroller holds the header *and* the rows.
    expect(SOURCE_AUTO).toMatch(/<div className="overflow-x-auto">\s*<div className="min-w-\[792px\]">/);
    expect(SOURCE_AUTO).toContain("const QUEUE_COLUMNS = 'minmax(260px,572fr)");
  });

  it('keeps the header and the rows on one shared track definition', () => {
    /*
     * They were siblings, which is how a scroll container on either alone would
     * have slid the body out from under its own headings. One definition, one
     * wrapper: a harness confirms the last heading and the last cell share a
     * right edge after scrolling.
     */
    const tracks = [...SOURCE_AUTO.matchAll(/gridTemplateColumns:\s*QUEUE_COLUMNS/g)];
    expect(tracks.length).toBeGreaterThanOrEqual(2);
    expect(SOURCE_AUTO).toMatch(/const QUEUE_COLUMNS = '[^']+'/);
  });
});

/**
 * The two rows whose classes were not written on a `className` attribute.
 *
 * `TrendCard` keeps its footer buttons in a hoisted `GHOST_BTN` constant and
 * applies it through `cn()`, so neither the contract test above nor
 * `scripts/responsive-audit.mjs` could see the `shrink-0` that mattered: the
 * audit ranked the file 20th while the deployed `/discovery` had 90 elements
 * past a 430px viewport. Both now read string literals too, and these are the
 * assertions that would have caught it — written against the parent that wraps
 * rather than the child that cannot shrink, because that is where the fix goes.
 */
describe('rows whose classes live in constants still fold', () => {
  const TREND = read('src/components/discovery/TrendCard.tsx');
  const USAGE = read('src/components/settings/UsagePanel.tsx');

  it('the trend footer wraps, so four fixed-width controls stay on screen', () => {
    // 138 + 134 + 115 + 42 plus three 6px gaps is 447; the card is 326 wide at
    // 430px. Nothing about the children can fix that — the row has to fold.
    expect(TREND).toContain('bottom-4 left-4 right-4 flex items-center gap-[6px] max-canvas:static');
    expect(TREND).toMatch(/gap-\[6px\][^"]*max-canvas:flex-wrap/);
  });

  it('the metrics strip lets its cells be narrower than their text', () => {
    // `whitespace-nowrap` plus a ratio-sized share put "Saturation: Med" 29px
    // past a 320px viewport. A flex item needs `min-w-0` before it may wrap.
    expect(TREND).toContain('max-canvas:min-w-0 max-canvas:whitespace-normal');
    expect(TREND).toMatch(/h-disc-strip[^"]*max-canvas:min-h-disc-strip/);
  });

  it('the usage row gives up its fixed label width before the viewport', () => {
    // w-52 + bar + w-20 + w-16, all `shrink-0`: "3 calls" ended at 445 on the
    // deployed `/account`. The label is the only part with slack.
    expect(USAGE).toMatch(/w-52 shrink-0 truncate[^"]*max-canvas:w-auto max-canvas:min-w-0 max-canvas:flex-1/);
    expect(USAGE).toMatch(/flex items-center gap-3 max-canvas:flex-wrap/);
  });
});

/**
 * The two widths that were wider than a phone by declaration.
 *
 * Everything else in this file is an element that outgrew its parent by
 * accident. These two were written down: a 541px drawer (already capped, but
 * carrying a 460px-wide composition inside it) and a 520px floor under the
 * draft panel. A floor is the one shape no reflow can absorb — the element
 * holds the width itself — so it needs releasing rather than rearranging.
 */
describe('nothing declares a width a phone cannot hold', () => {
  it('the draft drawer drops its 520px floor below canvas', () => {
    expect(read('src/components/command-center/draft-panel/DraftDrawer.tsx')).toContain(
      'min-w-[520px] max-canvas:min-w-0',
    );
  });

  it("the chat drawer's draft well reflows instead of clipping its body", () => {
    const CHAT = read('src/components/command-center/ChatDrawer.tsx');
    // left-167 + w-293 is 460 inside a well that is about 350 on a phone.
    expect(CHAT).toMatch(/w-\[293px\][^"]*max-canvas:static max-canvas:w-auto max-canvas:basis-full/);
    expect(CHAT).toMatch(/h-\[166px\] w-full[^"]*max-canvas:flex-wrap/);
  });
});

/**
 * The one case that was not content loss at all.
 *
 * `/assets` measured clean at 430px — 0 off-screen, 0 clipped, 0 collapsed,
 * with real folders rendered rather than the empty state. The folder tile still
 * wanted a rule: 248px fixed in a 374px wrapping row leaves a 126px gutter, one
 * tile per screen, which reads as unfinished rather than fitting. Keeping the
 * drawn width as a *minimum* and letting it grow is the whole fix, and it is
 * the only reason these assertions are in a file about overflow.
 */
describe('a folder tile spends the width it is given', () => {
  const FOLDERS = read('src/components/assets/library/FolderCards.tsx');

  it('keeps 248 as a floor and grows past it below canvas', () => {
    // All three tiles — the folder, Unfiled, and the skeleton — or the row
    // packs one grown tile next to two fixed ones.
    const grown = [...FOLDERS.matchAll(/w-lib-folder shrink-0[^"]*max-canvas:basis-lib-folder/g)];
    expect(grown).toHaveLength(3);
  });

  it('takes the thumbnail with it', () => {
    // 224 is 248 less two 12px insets; left alone it would sit in the corner of
    // a 374px tile. Harness-measured: 350 at 430px, exactly 224 at 1300.
    expect(FOLDERS).not.toMatch(/w-\[224px\](?![^"]*max-canvas:right-\[12px\])/);
  });
});

/**
 * `overflow-x-auto` that was not a scroll container.
 *
 * The automation queue's state tabs carried the right class and scrolled
 * nothing: `inline-flex` in a wrapping row with no width constraint grows to
 * its content, so `scrollWidth` equals `clientWidth` and the overflow lands on
 * the page. Measured on the deployed `/automation` at 430px, the six tabs ran
 * to x=706 and were cut at the viewport with nothing scrollable above them —
 * Scheduled, Published and Failed could not be selected.
 *
 * Harness-measured after: 374 wide against a 739 scrollWidth at 430, and
 * scrolling brings Failed to 394; 739 and not scrollable at 1300.
 */
describe('a scroll container needs a width to scroll inside', () => {
  it('the automation state tabs are capped so their overflow is theirs', () => {
    expect(read('src/components/automation/AutomationHome.tsx')).toContain(
      'inline-flex h-[56px] max-w-full items-center gap-[6px] overflow-x-auto',
    );
  });
});

/**
 * The settings sweep: every subpage measured at 430px, and the four that failed.
 *
 * `/settings/accounts`, `/notifications`, `/privacy`, `/accessibility`,
 * `/password`, `/connected` and `/team` were clean. These are the rest.
 */
describe('the settings screens hold a phone', () => {
  const files = (rel: string) => read(rel);

  it('no min-width column outlives the content column', () => {
    // `min-w-[Npx] flex-1` is a floor that tells a row to wrap rather than let
    // a field get too narrow. On a phone there is no width to wrap into: a
    // 420px floor put 29 elements past the viewport on `/settings/profile`,
    // the row ending at 491. Every such column now takes a full row below
    // `canvas`, and `min-w-0` is what stops its content re-inflating it.
    const offenders: string[] = [];
    for (const rel of FLEX_FLOOR_FILES) {
      const src = files(rel);
      for (const m of src.matchAll(/min-w-\[\d+px\]\s+flex-(?:1|\[2\])(?![^"'`]*max-canvas:basis-full)/g)) {
        offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders, offenders.join(', ')).toEqual([]);
  });

  it('the settings tablist is a scroll container with a width', () => {
    // Export / Import / Clone was cut at 419 with nothing scrollable over it.
    // One tablist, every settings section.
    expect(files('src/components/settings/SettingsTabs.tsx')).toContain(
      'inline-flex h-[50px] max-w-full items-center gap-[5px] overflow-x-auto',
    );
  });

  it('the engagement rings are not drawn where they cannot fit', () => {
    // 345px of nested absolute circles in a box that leaves 236 on a phone;
    // the stack ended at 485. Nothing in it reflows, so below `canvas` the
    // ornament goes and the empty-state message gets the width.
    expect(files('src/components/settings/EngagementPanel.tsx')).toContain(
      'h-[301px] w-[345px] max-canvas:hidden',
    );
  });

  it('a knowledge source URL can break mid-token', () => {
    // A URL has no spaces to wrap at: the crawled `docId` was the one element
    // past the viewport on `/settings/brand-kits`, ending at 462.
    expect(files('src/components/settings/KnowledgePanel.tsx')).toContain(
      'min-w-0 break-all font-mono text-12 text-ink',
    );
  });
});

/** Where the `min-w-[Npx] flex-1` floors live, so the rule above stays applied. */
const FLEX_FLOOR_FILES = [
  'src/components/account/BrandTransferPanel.tsx',
  'src/components/account/TeamPanel.tsx',
  'src/components/assets/AssetSearchGrid.tsx',
  'src/components/automation/InfluencerPanel.tsx',
  'src/components/command-center/PendingQuestionsPanel.tsx',
  'src/components/command-center/PerformanceCards.tsx',
  'src/components/command-center/draft-panel/DraftPanel.tsx',
  'src/components/discovery/InfluencerWatchlist.tsx',
  'src/components/discovery/ReshareModal.tsx',
  'src/components/discovery/TrendDetail.tsx',
  'src/components/engagement/OpportunityActions.tsx',
  'src/components/settings/ConsentPanel.tsx',
  'src/components/settings/CreditUsageSection.tsx',
  'src/components/settings/GovernancePanel.tsx',
  'src/components/settings/ImportExportSection.tsx',
  'src/components/settings/KnowledgePanel.tsx',
  'src/components/settings/PolicyPanel.tsx',
  'src/components/settings/personal/ProfileSection.tsx',
] as const;

describe('settings sections measure their card, not the window', () => {
  const SHELL = readFileSync(join(__dirname, '../src/components/settings/SettingsShell.tsx'), 'utf8');
  const CONFIG = readFileSync(join(__dirname, '../tailwind.config.ts'), 'utf8');

  it('the shell content card is the `cq` container', () => {
    expect(SHELL).toContain('[container:cq/inline-size]');
  });

  it('the variants ask that container', () => {
    expect(CONFIG).toContain("addVariant('cq-canvas', '@container cq (min-width: 1300px)')");
    expect(CONFIG).toContain("addVariant('max-cq-canvas', '@container cq (max-width: 1299.98px)')");
  });

  it('the overview switches on the card — at 1366 the card is 973 wide', () => {
    const raw = readFileSync(join(__dirname, '../src/components/settings/OverviewSection.tsx'), 'utf8');
    expect(raw).toContain('cq-canvas:min-w-[1300px]');
    expect(raw).not.toMatch(/(?<![-\w])max-canvas:/);
  });
});

/**
 * The Command Center walk-through against `SparkSocial Command Center.dc.html`,
 * at 1440 beside the rail.
 */
describe('the Command Center holds together beside the rail', () => {
  it('pins the engagement tabs on the card’s width, not the window’s', () => {
    const raw = readFileSync(join(__dirname, '../src/components/engagement/EngagementFeed.tsx'), 'utf8');
    const tablist = classNames(raw).find((c) => c.includes('left-[358px]'));
    expect(tablist).toBeDefined();
    // `xl:absolute` pinned them at 358 in a 921px card; the second row of
    // tabs was drawn over the filters.
    expect(tablist).not.toContain('xl:absolute');
    expect(tablist).toContain('[@container(min-width:1100px)]:absolute');
    expect(classNames(raw).some((c) => c.includes('[container-type:inline-size]'))).toBe(true);
  });

  it('does not clip the rail’s two buttons', () => {
    const raw = readFileSync(join(__dirname, '../src/components/command-center/SparkRail.tsx'), 'utf8');
    const row = classNames(raw).find((c) => c.includes('top-[598px]'));
    expect(row).toContain('[container-type:inline-size]');
    // A centred flex box with `truncate` clips both ends; the label is a span.
    const identity = classNames(raw).filter((c) => c.includes('basis-0'));
    for (const c of identity) expect(c).not.toMatch(/(^|\s)truncate(\s|$)/);
  });

  it('has no anchor to a section that is not on the page', () => {
    const raw = readFileSync(join(__dirname, '../src/components/command-center/CampaignFocusCard.tsx'), 'utf8');
    expect(raw).not.toContain('href="#agent-frequency"');
    expect(raw).toContain('<AdjustFrequency');
  });

  it('draws the prototype’s toast rather than Sonner’s default', () => {
    const raw = readFileSync(join(__dirname, '../src/components/ui/toaster.tsx'), 'utf8');
    // Without `unstyled`, Sonner's `[data-styled=true]` rule wins over the classes.
    expect(raw).toContain('unstyled: true');
    expect(raw).toContain('rounded-[12px]');
    expect(raw).toContain('px-[22px] py-[13px]');
  });
});
