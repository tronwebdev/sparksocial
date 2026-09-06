'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The field block every Personal Settings screen repeats — an 18/500 label over
 * a 63-tall box at radius 10 on `inset 0 0 0 1px rgba(131,131,131,0.2)`.
 *
 * The design draws it at three widths (346, 477 and 712); the width is the
 * caller's, because it is the grid that differs per screen and not the field.
 */
export function PersonalField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-18 font-medium" style={{ color: 'rgb(131,131,131)' }}>
        {label}
      </label>
      <div
        className="mt-[10px] h-[63px] rounded bg-white"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
      >
        {children}
      </div>
      {hint ? (
        <p className="mt-[8px] text-16" style={{ color: 'rgb(131,131,131)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The same box as a real `<select>`, so it is keyboard-reachable. */
export function PersonalSelect({
  value,
  onChange,
  options,
  placeholder,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return (
    <select
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-full w-full cursor-pointer appearance-none bg-transparent px-[24px] text-18 font-medium text-ink outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o || placeholder || '—'}
        </option>
      ))}
    </select>
  );
}

/**
 * A labelled row with a switch on the right — the shape the Notifications,
 * Accessibility and Privacy screens are almost entirely made of.
 */
export function PrefRow({
  title,
  detail,
  on,
  onToggle,
  disabled,
  disabledWhy,
}: {
  title: string;
  detail?: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  disabledWhy?: string;
}) {
  return (
    <div
      className={cn('flex items-start justify-between gap-[20px] rounded bg-white px-[22px] py-[16px]', disabled && 'opacity-60')}
      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
      title={disabled ? disabledWhy : undefined}
    >
      <span className="min-w-0">
        <span className="block text-16 font-semibold text-ink">{title}</span>
        {detail ? (
          <span className="mt-[6px] block text-16 leading-[1.4]" style={{ color: 'rgb(131,131,131)' }}>
            {detail}
          </span>
        ) : null}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        disabled={disabled}
        onClick={onToggle}
        className="relative mt-[3px] block h-[24.324px] w-[45px] shrink-0 disabled:cursor-not-allowed"
      >
        <span
          className="absolute inset-0 block rounded-[121.6px] transition-colors duration-200"
          style={{ background: on ? 'var(--ss-green-600)' : 'rgba(131,131,131,0.3)' }}
        />
        <span
          className="absolute top-[2.435px] block h-[19.459px] w-[19.459px] rounded-full bg-white transition-[left] duration-200"
          style={{ left: on ? 23.108 : 3 }}
        />
      </button>
    </div>
  );
}

/** A group heading inside a personal-settings card. */
export function PrefGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-18 font-semibold text-ink">{title}</h3>
      <div className="mt-[13px] grid grid-cols-1 gap-[12px]">{children}</div>
    </section>
  );
}
