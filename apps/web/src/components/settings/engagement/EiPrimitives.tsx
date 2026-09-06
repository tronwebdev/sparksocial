'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The two shapes every Engagement Intelligence step is built from, measured on
 * `Settings WS EI Autonomy` and `… Boundaries`.
 */

/**
 * The cyan section chip — 138x37 r8.786 on `#6CE8FF`, label 14.013/500.
 *
 * A *section* header, not a progress indicator: Autonomy carries one ("Autonomy
 * Level"), Platforms and Boundaries carry two each. Drawing five in a row as
 * progress would say something the design does not.
 */
export function EiSectionChip({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex h-[37px] items-center rounded-[8.786px] px-[15px] text-[14.013px] font-medium leading-[1.28]"
      style={{ background: 'var(--ss-cyan)', color: 'var(--ss-ink-900)' }}
    >
      {children}
    </span>
  );
}

/**
 * A selectable option row — 592x79 r10 white, its title 16/600 at 48,17 and its
 * detail 16/400 grey at 48,45, with the control in the 48px gutter.
 *
 * `kind` picks the control the design draws: a radio where the choice is one of
 * several, a checkbox where several may be on at once.
 */
export function EiOptionRow({
  title,
  detail,
  on,
  onToggle,
  kind = 'radio',
  disabled,
}: {
  title: ReactNode;
  detail?: ReactNode;
  on: boolean;
  onToggle: () => void;
  kind?: 'radio' | 'check';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role={kind === 'radio' ? 'radio' : 'checkbox'}
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative flex w-full max-w-[592px] items-start rounded-[10px] bg-white py-[17px] pl-[48px] pr-[18px] text-left transition-shadow',
        disabled && 'opacity-60',
      )}
      style={{ boxShadow: on ? 'inset 0 0 0 1.6px var(--ss-ink-900)' : 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-[17px] top-[19px] flex h-[20px] w-[20px] items-center justify-center',
          kind === 'radio' ? 'rounded-full' : 'rounded-[5px]',
        )}
        style={{
          background: on ? 'var(--ss-ink-900)' : 'transparent',
          boxShadow: on ? 'none' : 'inset 0 0 0 1.5px rgba(12,12,12,0.25)',
        }}
      >
        {on ? (
          kind === 'radio' ? (
            <span className="block h-[7px] w-[7px] rounded-full bg-white" />
          ) : (
            <svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden>
              <path d="m1 4.5 3 3L10 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )
        ) : null}
      </span>

      <span className="min-w-0">
        <span className="block text-16 font-semibold leading-[1.25] text-ink">{title}</span>
        {detail ? (
          <span className="mt-[8px] block text-16 font-normal leading-[1.25]" style={{ color: 'rgb(131,131,131)' }}>
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}
