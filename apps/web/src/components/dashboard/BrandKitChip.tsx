'use client';

import Link from 'next/link';
import type { BrandKit } from './types';

/**
 * BRAND KIT SETUP — the prototype's donut chip in the cockpit header
 * (`DASH-B-01`, M1).
 *
 * The percentage is computed server-side by `brandKitProgress` and arrives on
 * `brand.governance.get`, so this chip and the Brand Kit settings panel cannot
 * report different numbers for the same brand.
 *
 * ── Two things the prototype does that this does not ──────────────────────
 *
 * Its label reads "Brand Kit Setup loading..." at 50%, which describes a network
 * request rather than an unfinished checklist — this says what is actually
 * outstanding instead. And it renders the chip unconditionally; a finished kit
 * has nothing to ask for, so at 100% this disappears rather than sitting in the
 * header as a permanent tick.
 *
 * The ring is an SVG rather than a `conic-gradient`, which is what the prototype
 * uses: a conic gradient cannot be animated or given a rounded cap, and it
 * renders the whole circle in the accent when the value reaches 100 — the one
 * case this component is never shown in, so the bug would have been invisible
 * until the day someone chose to keep it visible.
 */

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function BrandKitChip({ kit }: { kit: BrandKit }) {
  if (kit.pct >= 100) return null;

  return (
    <Link
      href="/settings/brand-kit"
      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-surface-muted"
    >
      <span className="relative shrink-0" aria-hidden>
        <svg width="38" height="38" viewBox="0 0 38 38" className="-rotate-90">
          <circle cx="19" cy="19" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="4" className="text-border" />
          <circle
            cx="19"
            cy="19"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            className="text-brand-purple"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - kit.pct / 100)}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10.5px] font-semibold tabular-nums text-ink">
          {kit.pct}%
        </span>
      </span>

      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">
          Brand kit — {kit.completed} of {kit.total} done
        </span>
        {/* Names the next step rather than the total outstanding: the chip's job
            is turning a percentage into one action. */}
        <span className="block text-[12px] text-ink-muted">
          {kit.next ? `Next: ${kit.next.label} — ${kit.next.because}` : 'Finish setting it up'}
        </span>
      </span>
    </Link>
  );
}
