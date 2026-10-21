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

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

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
    const select = all.find((c) => c.includes('w-[194px]'));
    expect(select).toBeDefined();

    /*
     * The first attempt used `w-[calc(50%-0.5rem)]` below the breakpoint and
     * produced 418px dropdowns at 900px — more than twice the design's width,
     * because 50% of a wide container is wide. The cap is what stops a `grow`
     * overshooting the capture.
     */
    expect(select).toContain('max-canvas:max-w-[194px]');
    expect(select).not.toContain('calc(50%');
    expect(select).toContain('max-canvas:grow');
    expect(select).toContain('max-canvas:basis-[160px]');
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
