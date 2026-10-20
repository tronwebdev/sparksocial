import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The onboarding header's progress band must not take pointer events.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `StepShell`'s header is `flex justify-between` with a Back pill, a Continue
 * pill, and — between them in the DOM but `absolute left-1/2` in layout — the
 * "Step n of 4" label and its progress bar. The band is positioned and the two
 * pills are not, so the band wins the hit test against them whatever the DOM
 * order says; and because it is `w-[738px] max-w-full`, below about 960px it
 * stops being 738px wide and stretches across the entire header.
 *
 * Measured on the deployed site with `document.elementFromPoint` at each
 * pill's own centre:
 *
 *   1440px  Back ok       Continue ok
 *   1280px  Back ok       Continue ok
 *   1024px  Back ok       Continue ok
 *    980px  Back ok       Continue ok
 *    900px  Back BLOCKED  Continue BLOCKED
 *    796px  Back BLOCKED  Continue BLOCKED
 *
 * It presented as "the Continue button does nothing", with no console error and
 * no failed request, because the click genuinely landed on a transparent div.
 *
 * ── Why it was worse than a cosmetic bug ─────────────────────────────────
 *
 * Only the brand-name and URL composers pass an `onSubmit`, so Enter works on
 * the first two steps and a tester gets through them without noticing. Every
 * step after that — details, the questions, docs, the brand kit, the agent —
 * offers no keyboard path, so in any window narrower than ~960px onboarding
 * could be started and then not finished.
 *
 * ── Why this test, and not a geometry test ───────────────────────────────
 *
 * The sibling tests here (`stageScale`, `typeScale`) extract arithmetic and
 * check it, which is right when the defect is arithmetic. This one is not: the
 * overlap is still there after the fix and is *meant* to be — the band is
 * drawn over the pills by design at narrow widths, it simply must not be hit.
 * A predicate re-deriving the overlap from numbers copied out of the CSS would
 * be dead code kept in step with Tailwind classes by hand, and would pass
 * happily while the real header regressed.
 *
 * So this asserts the one thing that must remain true of the markup, and the
 * table above — taken from the live DOM, not from reasoning about it — is the
 * evidence for why.
 */

const SOURCE = readFileSync(
  join(__dirname, '../src/components/onboarding/StepShell.tsx'),
  'utf8',
);

describe('StepShell header', () => {
  it('gives up pointer events on the absolutely-positioned progress band', () => {
    // The band, identified the way the browser does: the centred fixed-width
    // column. If this match stops finding anything the test must be re-read,
    // not deleted — hence the assertion that it matched at all.
    const band = SOURCE.match(/className="([^"]*absolute left-1\/2[^"]*w-\[738px\][^"]*)"/);

    expect(band, 'the centred progress band is no longer recognisable').not.toBeNull();
    expect(band?.[1]).toContain('pointer-events-none');
  });

  it('still paints the band over the pills, which is why the class is needed', () => {
    // `max-w-full` is what makes the band full-width below ~960px, and
    // `absolute` is what makes it beat the statically-positioned pills. Both
    // are deliberate; this records that the fix does not depend on either
    // changing, so neither can be "fixed" instead of the hit test.
    const band = SOURCE.match(/className="([^"]*absolute left-1\/2[^"]*w-\[738px\][^"]*)"/)?.[1];

    expect(band).toContain('max-w-full');
    expect(band).toContain('absolute');
  });

  it('keeps both pills reachable by leaving them out of the band', () => {
    // The pills are siblings of the band, not children of it. If either were
    // moved inside, `pointer-events-none` would disable the very control this
    // test exists to protect.
    const bandIndex = SOURCE.indexOf('w-[738px]');
    const continueIndex = SOURCE.indexOf('{continueLabel}');

    expect(bandIndex).toBeGreaterThan(0);
    expect(continueIndex).toBeGreaterThan(bandIndex);

    // Between the band's opening tag and the Continue button there is a closing
    // `</div>` for the band — i.e. the button is not nested inside it.
    expect(SOURCE.slice(bandIndex, continueIndex)).toContain('</div>');
  });
});
