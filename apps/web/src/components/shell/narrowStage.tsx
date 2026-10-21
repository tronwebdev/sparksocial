'use client';

import { createContext, useContext, useEffect, useState } from 'react';

/**
 * The two screens that are stages rather than layouts, and where they stop.
 *
 * ── What a stage is, and what it costs ────────────────────────────────────
 *
 * The campaign wizard and the agency portal both place every element
 * absolutely on a 1728px plane and scale the whole plane by
 * `min(1, viewport / 1728)`, exactly as the prototype's own script does. Both
 * files argue for it the same way, and the argument is sound: the elements
 * overlap deliberately — an orb straddling a notch cut into the panel beneath
 * it, a hero's decorations hanging off its edges — so there is no flow layout
 * underneath for a flexbox rebuild to recover.
 *
 * The cost is that a stage is never wrong and never readable. Measured on the
 * deployed build at 430px: `matrix(0.2488)` on both, nothing off-screen, and
 * type rendering at 3.5–6.9px against 14–26px declared.
 *
 * Worth recording how nearly that was missed twice. An overflow probe calls a
 * scaled screen clean, because it is — scaling strands nothing. A font-size
 * probe calls it clean too, because `transform` does not change computed
 * `font-size`; a first pass reported '0 text under 9px' on a screen where every
 * word was four pixels tall. And a probe that tests `/scale/` against a
 * computed transform never matches at all, because the computed value is always
 * a `matrix(...)` — that one reported the agency portal as carrying no
 * transform whatsoever. The reading that works is to find the matrix, take its
 * first component, and multiply the declared sizes through it yourself.
 *
 * ── Why this cannot be a Tailwind variant ─────────────────────────────────
 *
 * Both stages compute positions as inline styles from a geometry table, and no
 * variant can reach an inline style. So the switch is measured in JS, and
 * `NARROW_BELOW` duplicates the `canvas` screen's width with a test to keep the
 * two numbers equal.
 */
export const NARROW_BELOW = 1300;

const NarrowContext = createContext(false);

/** Wraps a stage's flowing render, for the pieces that need to know. */
export const NarrowStage = NarrowContext.Provider;

export const useNarrowStage = () => useContext(NarrowContext);

/**
 * The viewport width, measured — the same resize listener both stages already
 * ran, written once.
 *
 * Starts at the stage width so the server render and the first client render
 * agree: a narrow first paint would otherwise hydrate over a wide one.
 */
export function useStageWidth(stage: number): number {
  const [vw, setVw] = useState(stage);

  useEffect(() => {
    const measure = () => setVw(window.innerWidth || stage);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [stage]);

  return vw;
}

/**
 * Turning a plane of absolute coordinates into a column.
 *
 * `relative` with both offsets zeroed, never `static`, and the difference is a
 * bug either way round: a card is itself a positioning context — its icon,
 * title, copy and badge are placed against it — so turning it static hands
 * those descendants to the next positioned ancestor and piles their contents up
 * in its corner. Relative keeps the card a containing block, and the zeroed
 * offsets are what stop `position: relative` from honouring the `left: 37px` it
 * was given.
 *
 * It works at all because an `!important` author declaration outranks a plain
 * inline one, which is what lets a class reach a coordinate computed in JS.
 */
export const FLATTEN = '[&>*]:!relative [&>*]:!left-0 [&>*]:!top-0 [&>*]:!max-w-full';

/**
 * The same rule, gated on the breakpoint.
 *
 * `FLATTEN` carries no variant because the wizard applies it inside a branch
 * that only renders below `NARROW_BELOW` — there, the media query would be
 * redundant. Anything put on an element that renders in *both* layouts needs
 * this one instead: an unprefixed flatten there takes the wide stage with it.
 *
 * The rule of thumb, since both forms now exist: `FLATTEN` inside an
 * `if (narrow)` return, `FLATTEN_NARROW` in a `className` that both widths
 * reach. Getting it the wrong way round is silent — the layout that breaks is
 * the one nobody is testing at the time.
 *
 * Caught in a harness rather than in review, and it was the whole desktop
 * portal: at 1300 the hero's children went `relative`, its 760px decorative orb
 * became a flow item, and the heading landed at y=1276 — the same failure the
 * narrow layout had had, now on the layout that was working.
 *
 * Written out rather than derived from `FLATTEN` with a `map`, which is the
 * obvious way to write it and would have produced four class names that exist
 * only at runtime. Tailwind scans source text for literals; a class assembled
 * by string concatenation is never generated, so the rule would have been
 * silently absent instead of silently wrong. `narrowStage.test.ts` holds the
 * two in step.
 */
export const FLATTEN_NARROW =
  'max-canvas:[&>*]:!relative max-canvas:[&>*]:!left-0 max-canvas:[&>*]:!top-0 max-canvas:[&>*]:!max-w-full';

/**
 * A stage section, below the breakpoint.
 *
 * The agency portal is eight of these: a `w-ag-wide` card placed at a stage
 * coordinate, with its content positioned against it and, on the home views, a
 * decorative cluster floating over its right half. The card's own width is
 * capped by `FLATTEN` on the wrapper above it; what it needs of its own is to
 * stop being a fixed height and to lay its children out in a column rather than
 * at coordinates.
 *
 * `!h-auto` has to shout, because the height it is overriding is a class
 * (`h-[376px]`) rather than an inline style.
 */
export const SECTION = `max-canvas:!h-auto max-canvas:flex max-canvas:flex-col max-canvas:gap-[14px] max-canvas:p-[20px] max-canvas:[&_*]:!whitespace-normal ${FLATTEN_NARROW}`;
