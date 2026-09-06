'use client';

import { cn } from '@/lib/utils';

/**
 * The inner tab strip three sections share.
 *
 * `Settings WS Team Users` draws Users / Groups, and `Settings WS Export` draws
 * Export / Import / Clone Workspace — the same control both times, measured on
 * the Team screen: a 218x50 r10.828 white pill holding 42-tall r9.425 tabs at
 * 17.643/500, the active one on `#6CE8FF` with `#0C0C0C` text.
 *
 * These are tabs and not routes because that is what the prototype makes them:
 * its own router treats Users and Groups as two screens, but they share a
 * heading, a subtitle and a card, and only the table below them changes.
 */
export function SettingsTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex h-[50px] items-center gap-[5px] rounded-[10.828px] bg-white p-[5px]"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.15)' }}
    >
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex h-[42px] items-center justify-center rounded-[9.425px] px-[22px] text-[17.643px] font-medium leading-[1.25] transition-colors',
              /* The design's active tab is CYAN with dark text, not a black
                 pill — the same `#6CE8FF` the nav's active row fades to. */
              on ? 'bg-[var(--ss-cyan)] text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
