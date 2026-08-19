import { cn } from '@/lib/utils';
import { MobileNav } from './MobileNav';

/**
 * Prototype: 26px/600 title, 18px/400 muted subtitle at y=77, hairline divider at
 * y=119.5 (`Dashboard.dc.html:73-100`). The divider is `rgba(131,131,131,.25)`,
 * which is the `--ss-border` token.
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
}

export function TopBar({ title, subtitle, actions, className }: TopBarProps) {
  return (
    <header className={cn('border-b border-border px-4 pb-5 pt-5 sm:px-8 sm:pt-7', className)}>
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
            {subtitle ? <p className="mt-1 truncate text-[14px] font-normal text-ink-muted sm:text-[18px]">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2 sm:gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
