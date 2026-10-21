import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import config from '../tailwind.config';
import { NARROW_BELOW, STAGE, STEP_GEOM } from '../src/components/campaign/campaignChrome';

const read = (rel: string) => readFileSync(join(process.cwd(), 'apps/web', rel), 'utf8');

const CHROME = read('src/components/campaign/campaignChrome.tsx');
const WIZARD = read('src/components/campaign/CampaignWizard.tsx');
const INTRO = read('src/components/campaign/CampaignIntro.tsx');

/**
 * The campaign wizard stops scaling below `canvas`.
 *
 * Measured on the deployed `/campaign/new` at 430px before this: a stage scaled
 * by `matrix(0.2488)`, nothing off-screen, and type declared at 16-25.5px
 * rendering at 4-6.3px. Both of the probes used elsewhere in this suite call
 * that screen clean — an overflow check because everything *is* inside the
 * viewport, and a font-size check because `transform` does not change computed
 * `font-size`. It only shows up by multiplying through the matrix.
 */
describe('the campaign wizard stops scaling below canvas', () => {
  it('switches at the same width as the canvas screen', () => {
    // The wizard cannot use the Tailwind variant — its positions are inline
    // styles computed from STEP_GEOM, and a variant cannot reach an inline
    // style — so the number is duplicated and this is what keeps it honest.
    const canvas = (config.theme?.extend?.screens as Record<string, string>).canvas;
    expect(`${NARROW_BELOW}px`).toBe(canvas);
  });

  it('keeps the scaled stage for wide windows', () => {
    // The flowing layout is the addition, not the replacement: at canvas scale
    // the design is still drawn exactly as the prototype draws it.
    expect(STAGE).toBe(1728);
    expect(WIZARD).toContain('transform: `scale(${scale})`');
    expect(WIZARD).toContain('const narrow = pageW < NARROW_BELOW;');
  });

  it('flattens panel children with relative, not static', () => {
    // A card is a positioning context — its icon, title, copy and tick badge are
    // placed against it. `static` hands those to the next positioned ancestor,
    // which is the fixed dialog, and the cards' contents pile up in its corner.
    // Harness-measured at 430px with the real nesting: card at x=46 and its
    // badge at 258, which is 46 + the badge's own 212.
    expect(CHROME).toContain('[&>*]:!relative [&>*]:!left-0 [&>*]:!top-0');
    expect(CHROME).not.toContain('[&>*]:!static');
    expect(WIZARD).toContain('[&>*]:!relative [&>*]:!left-0 [&>*]:!top-0');
  });

  it('both layouts mount the same step', () => {
    // Hoisted rather than duplicated: a second copy of six conditionals is a
    // second place to forget a prop.
    expect(WIZARD).toContain('const stepSlot = (');
    expect([...WIZARD.matchAll(/\{stepSlot\}/g)]).toHaveLength(2);
  });

  it('derives the flowing progress bar from the design table', () => {
    // `prog` is a width across a 508px track, not a percentage: the stops are
    // 54, 123, 257, 349, 453, 507, so the bar accelerates through the middle.
    // `step / 6` would be wrong at every stop but the last.
    expect(Object.values(STEP_GEOM).map((g) => g.prog)).toEqual([54, 123, 257, 349, 453, 507]);
    expect(WIZARD).toContain('(geom.prog / PROGRESS_TRACK) * 100');
    expect(WIZARD).toContain('const PROGRESS_TRACK = 508;');
  });

  it('drops the two things that belong to the stage', () => {
    // The orb straddles a dip cut into the panel it sits on, for one panel
    // width. There is no narrow version of that shape that is not a different
    // drawing, so the orb and the clip-path wash go rather than move.
    expect(INTRO).toContain('top-[100px] max-canvas:hidden');
    expect(INTRO).toContain("clipPath: PANEL_CLIP.popup }} />");
    expect(INTRO).toMatch(/bg-white max-canvas:hidden/);
  });
});
