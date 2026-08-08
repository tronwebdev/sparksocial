import { cn } from '@/lib/utils';

/**
 * Prototype: 26px/600 title, 18px/400 muted subtitle at y=77, hairline divider at
 * y=119.5 (`Dashboard.dc.html:73-100`). The divider is `rgba(131,131,131,.25)`,
 * which is the `--ss-border` token.
 */
export interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function TopBar({ title, subtitle, actions, className }: TopBarProps) {
  return (
    <header className={cn('border-b border-border px-8 pb-5 pt-7', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold leading-tight text-ink">{title}</h1>
          {subtitle ? <p className="mt-1 truncate text-[18px] font-normal text-ink-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
