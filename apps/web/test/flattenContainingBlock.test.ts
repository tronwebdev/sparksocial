import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Container-measured canvas variants read as the viewport ones — see
// `responsiveCanvas.test.ts`, which also checks the container exists.
const read = (rel: string) =>
  readFileSync(join(process.cwd(), 'apps/web', rel), 'utf8')
    .replace(/max-cq-canvas:/g, 'max-canvas:')
    .replace(/cq-canvas:/g, 'canvas:');

/** Source with the comments taken out — the comments here describe the bugs. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const INTRO = code('src/components/campaign/CampaignIntro.tsx');
const OVERVIEW = code('src/components/settings/OverviewSection.tsx');

/**
 * `max-canvas:static` takes the containing block away from everything inside.
 *
 * Measured on the deployed site in an 800px-wide pane:
 *
 *   * `/campaign/new` — `document.elementFromPoint` over the centre of "Create
 *     Campaign" returned `div.absolute.inset-0.bg-cmp-backdrop`. The backdrop
 *     had re-anchored to the dialog root, and because the card was now a flow
 *     item it painted over it. Both controls on the screen were dead, and the
 *     wizard could not be started at any width under 1300. The button was also
 *     an empty outlined box: its icon and its label are absolutely positioned
 *     children, and they were stranded at the top-left corner of the screen.
 *   * `/settings` — the three-avatar stack measured at 65,826 with its children
 *     drawn at 41,583, 67,583 and 93,583. 243px above the empty gap they left.
 *
 * Neither leaves the viewport, so the responsive audit is silent on both; a
 * backdrop that covers its siblings is also what a sibling-overlap test expects
 * to see. `scripts/flatten-audit.mjs` is the check that does catch them, and
 * the last case here runs it.
 */
describe('a flattened box keeps its children', () => {
  it('leaves the intro backdrop behind the card and out of the way', () => {
    // `-z-10` so a flow-positioned card paints over it, `pointer-events-none`
    // so it cannot take a click meant for the button underneath.
    expect(INTRO).toContain('className="pointer-events-none absolute inset-0 -z-10 bg-cmp-backdrop"');
  });

  it('puts the intro button\'s icon and label back in flow', () => {
    expect(INTRO).toContain('FLATTEN_NARROW');
    expect(INTRO).toMatch(/max-canvas:flex max-canvas:items-center max-canvas:justify-center/);
  });

  it('anchors the settings avatar stack to its own box', () => {
    // `relative`, not `static`: the circles inside are positioned against it.
    expect(OVERVIEW).toContain('max-canvas:relative max-canvas:left-auto max-canvas:top-auto');
  });

  it('finds nothing else in the same shape', () => {
    const out = execFileSync('node', ['scripts/flatten-audit.mjs'], { encoding: 'utf8' });
    expect(out).toContain('No element flattens itself and leaves an absolute child behind.');
  });
});
