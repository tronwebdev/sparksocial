import { cn } from '@/lib/utils';
import { MobileNav } from './MobileNav';
import { AskSpark } from './AskSpark';

/**
 * Prototype: 26px/600 title, 18px/400 muted subtitle at y=77, hairline divider at
 * y=119.5 (`Dashboard.dc.html:73-100`). The divider is `rgba(131,131,131,.25)`,
 * which is the `--ss-border` token.
 *
 * ── The vertical grid, and why the padding is not a round number ───────────
 *
 * The canvas card starts at y=18 on the stage, so the divider at 119.5 makes
 * this header exactly **101.5px** tall. It was 124 — `pt-7 pb-5` — which put the
 * title 16px below the design's 35.5 and pushed every band under it down by the
 * same amount: the banner, the KPI row, the rail, all of it. The header is the
 * one element whose height the whole page inherits, so it is stated in the
 * design's own numbers rather than the nearest Tailwind step:
 *
 *   pt 12          switcher block top 30  (30 − 18)
 *   row 72         the brand-kit chip, the tallest thing in it (30 → 102)
 *   pb 17.5        divider at 119.5
 *
 * The title column is 70 (44px switcher + 3 + 23px subtitle), so it starts on
 * the same line as the chip and the row's height comes from the chip. `px` is 34
 * rather than `px-8` for the same reason — see the content padding in
 * `BrandHome`; 322 + 34 is the design's 356 content edge, and the switcher's own
 * `-ml-2.5` puts its 44px hit box back at 347 where the design has it.
 *
 * `title` is a ReactNode rather than a string because the shell's primary heading
 * is the brand switcher — an interactive control, not text.
 *
 * The nav-open trigger lives here, not in `AppShell`, because every `(app)`
 * route already renders exactly one `TopBar` — putting it here covers all
 * seven screens with no per-page change. `md:hidden` because `AppShell`'s
 * real sidebar takes over at that width and a second nav would be redundant.
 */
export interface TopBarProps {
  title: React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  /**
   * Ask Spark is a header control in every prototype that has one, and every
   * `(app)` route renders exactly one `TopBar` - so it belongs here rather than
   * being pasted into seven pages. `AskSpark` already suppresses itself on
   * `/agents`, which brings its own drawer; `askSpark={false}` is for a screen
   * that wants the header without it at all.
   */
  askSpark?: boolean;
}

export function TopBar({ title, subtitle, actions, className, askSpark = true }: TopBarProps) {
  return (
    <header className={cn('border-b border-border px-4 pb-5 pt-5 sm:px-dash-gutter sm:pb-dash-head-bottom sm:pt-dash-head-top', className)}>
      {/*
        ── Wrapping, rather than a breakpoint ───────────────────────────────

        The actions row was `shrink-0` inside a row that could not wrap, so it
        could neither compress nor fold. Measured on the deployed dashboard at
        430px: twelve elements past the viewport, the furthest at x=638 — 208px
        over — with `document.scrollWidth` equal to the viewport, so Create
        Campaign, the notifications button and Ask Spark were all unreachable.
        A different failure from the settings card's stranded absolutes, and the
        same outcome: controls that exist and cannot be used.

        This one wants no `canvas` rule. `flex-wrap` is self-adjusting — the
        actions drop to a second line exactly when they stop fitting and not a
        pixel sooner — whereas a breakpoint at 1300px would stack the header on
        a 1200px laptop where it fits perfectly well today. The contract says
        fixed sizes become fluid below the canvas; it does not say every fix
        needs the breakpoint, and reaching for one here would make the header
        worse at the widths it currently handles.
      */}
      <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 md:hidden">
            <MobileNav />
          </div>
          <div className="min-w-0">
            {typeof title === 'string' ? (
              <h1 className="truncate text-20 font-semibold leading-tight text-ink sm:text-26">{title}</h1>
            ) : (
              title
            )}
            {subtitle ? <p className="mt-[3px] truncate text-14 font-normal leading-[1.28] text-ink-muted sm:text-18">{subtitle}</p> : null}
          </div>
        </div>
        {/*
          `shrink-0` is gone and the row wraps internally too: the actions block
          is one flex child, so without this it would drop to its own line still
          610px wide and still overflow a phone.
        */}
        {actions || askSpark ? (
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            {actions}
            {askSpark ? <AskSpark /> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
