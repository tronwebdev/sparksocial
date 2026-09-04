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
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 md:hidden">
            <MobileNav />
          </div>
          <div className="min-w-0">
            {typeof title === 'string' ? (
              <h1 className="truncate text-[20px] font-semibold leading-tight text-ink sm:text-[26px]">{title}</h1>
            ) : (
              title
            )}
            {subtitle ? <p className="mt-[3px] truncate text-[14px] font-normal leading-[1.28] text-ink-muted sm:text-[18px]">{subtitle}</p> : null}
          </div>
        </div>
        {actions || askSpark ? (
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {actions}
            {askSpark ? <AskSpark /> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
