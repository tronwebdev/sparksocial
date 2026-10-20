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

const SOURCE = readFileSync(
  join(__dirname, '../src/components/settings/OverviewSection.tsx'),
  'utf8',
);

/** Every `className="…"` in the file, comments stripped so prose does not count. */
function classNames(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return [...code.matchAll(/className="([^"]+)"/g)].map((m) => m[1]!);
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
