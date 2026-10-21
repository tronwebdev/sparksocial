import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import config from '../tailwind.config';
import { STAGE, STEP_GEOM } from '../src/components/campaign/campaignChrome';
import { FLATTEN, NARROW_BELOW, SECTION } from '../src/components/shell/narrowStage';

const read = (rel: string) => readFileSync(join(process.cwd(), 'apps/web', rel), 'utf8');

const WIZARD = read('src/components/campaign/CampaignWizard.tsx');
const INTRO = read('src/components/campaign/CampaignIntro.tsx');
const AGENCY = read('src/components/agency/AgencyStage.tsx');

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
describe('the two stages stop scaling below canvas', () => {
  it('switches at the same width as the canvas screen', () => {
    // The wizard cannot use the Tailwind variant — its positions are inline
    // styles computed from STEP_GEOM, and a variant cannot reach an inline
    // style — so the number is duplicated and this is what keeps it honest.
    const canvas = (config.theme?.extend?.screens as Record<string, string>).canvas;
    expect(`${NARROW_BELOW}px`).toBe(canvas);
  });

  it('keeps both scaled stages for wide windows', () => {
    expect(AGENCY).toContain('transform: `scale(${scale})`');
    // The flowing layout is the addition, not the replacement: at canvas scale
    // the design is still drawn exactly as the prototype draws it.
    expect(STAGE).toBe(1728);
    expect(WIZARD).toContain('transform: `scale(${scale})`');
    expect(WIZARD).toContain('const narrow = pageW < NARROW_BELOW;');
  });

  it('flattens with relative, never static', () => {
    // A card is a positioning context — its icon, title, copy and tick badge are
    // placed against it. `static` hands those to the next positioned ancestor,
    // which is the fixed dialog, and the cards' contents pile up in its corner.
    // Harness-measured at 430px with the real nesting: card at x=46 and its
    // badge at 258, which is 46 + the badge's own 212.
    expect(FLATTEN).toContain('!relative');
    expect(FLATTEN).toContain('!left-0');
    expect(FLATTEN).toContain('!top-0');
    expect(FLATTEN).not.toContain('!static');
    // `SECTION` carries the same rule behind the breakpoint, and has to: it goes
    // on the section element in *both* layouts, so an unprefixed flatten there
    // took the wide stage with it — harness-measured at 1300, the hero's
    // decorative orb became a flow item and the heading landed at y=1276.
    //
    // The prefixed copy is written out rather than mapped from `FLATTEN`,
    // because Tailwind generates only the class names it can find as literals
    // in the source. This is what keeps the two from drifting.
    for (const c of FLATTEN.split(' ')) {
      expect(SECTION).toContain(`max-canvas:${c}`);
    }
    expect(SECTION).not.toMatch(/(^| )\[&>\*\]/);
    // And the one override a section needs that a flattened child does not: its
    // height is a class, so releasing it has to shout louder than one.
    expect(SECTION).toContain('max-canvas:!h-auto');
  });

  it('the agency portal flows on the same switch', () => {
    // Same stage, same measurement — 94 text nodes at 3.5-6.9px — and the same
    // two pieces dropped rather than moved.
    expect(AGENCY).toContain('if (vw < NARROW_BELOW) {');
    expect(AGENCY).toContain('<NarrowStage value>');
    // The chrome is lifted into components so the flowing header mounts the
    // same pill and profile rather than a second copy of them.
    expect(AGENCY).toContain('<AgencyScopePill narrow />');
    expect(AGENCY).toContain('<AgencyProfile narrow />');
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

/**
 * The mistake that is silent in whichever direction you make it.
 *
 * `FLATTEN` has no breakpoint variant, which is right inside an `if (narrow)`
 * return and wrong on a `className` both widths reach — there it flattens the
 * wide stage too. Harness-measured at 1300 with that wrong: the agency hero's
 * children went `relative`, its 760px decorative orb became a flow item, and
 * the heading landed at y=1276. The narrow layout looked perfect throughout.
 *
 * The tell is the two appearing together: a class list that already names
 * `max-canvas:` is, by construction, one that renders at both widths.
 */
describe('the unprefixed flatten stays inside narrow-only branches', () => {
  const COMPONENTS = join(process.cwd(), 'apps/web/src/components');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (entry.endsWith('.tsx')) out.push(path);
    }
    return out;
  }

  it('is never mixed with a max-canvas rule in one class list', () => {
    const offenders: string[] = [];
    for (const file of walk(COMPONENTS)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/cn\(([\s\S]{0,600}?)\)\}/g)) {
        const body = m[1]!;
        // Plain string work rather than a word boundary, because `FLATTEN` is a
        // prefix of `FLATTEN_NARROW`: take the long name out and see whether the
        // short one is still there.
        if (!body.split('FLATTEN_NARROW').join('').includes('FLATTEN')) continue;
        if (body.includes('max-canvas:')) offenders.push(file.replace(COMPONENTS, ''));
      }
    }
    expect(offenders, offenders.join(', ')).toEqual([]);
  });
});
