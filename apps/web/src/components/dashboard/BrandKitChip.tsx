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


export function BrandKitChip({ kit }: { kit: BrandKit }) {
  if (kit.pct >= 100) return null;

  /*
    The prototype's ring is a conic gradient, not a stroked circle: purple into
    pink into cyan for the completed sweep, then `rgba(12,12,12,0.08)` for the
    rest, with a 34px white disc punched out of the middle. Its stops are
    hardcoded at 0/30/50 for a 50% state, so they are expressed here as
    fractions of `pct` - at 50 they reproduce the design exactly, and at every
    other value the sweep is still the real number.
  */
  const sweep = [
    `#A341FF 0%`,
    `#F56BFF ${(kit.pct * 0.6).toFixed(1)}%`,
    `#6CE8FF ${kit.pct}%`,
    `rgba(12,12,12,0.08) ${kit.pct}%`,
    `rgba(12,12,12,0.08) 100%`,
  ].join(', ');

  return (
    /*
      288x72 at radius 15 on white with a `rgba(131,131,131,0.15)` ring - not the
      bordered `surface` card this was. Two lines: the title at 15px/600, and a
      `#D3F4FB` pill at 13px/500 `#0BAAC7`.

      The pill is where I had "Next: <step> - <because>" in two lines of 12px.
      That sentence is the useful part of this chip, so it moves to the link's
      title rather than being dropped: the design's second line is a call to
      action, and a 72px card cannot carry both.
    */
    <Link
      href="/settings/brand-kit"
      title={
        kit.next
          ? `Next: ${kit.next.label} — ${kit.next.because}`
          : `${kit.completed} of ${kit.total} steps done`
      }
      className="relative block h-[72px] w-[288px] shrink-0 rounded-lg bg-white transition-shadow hover:shadow-card"
      style={{ boxShadow: '0 0 0 1px rgba(131,131,131,0.15)' }}
    >
      <span
        className="absolute left-3 top-[13px] flex h-[46px] w-[46px] items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${sweep})` }}
        aria-hidden
      >
        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white text-[11.5px] font-semibold tabular-nums text-ink">
          {kit.pct}%
        </span>
      </span>

      <span className="absolute left-[70px] top-3 block whitespace-nowrap text-[15px] font-semibold text-ink">
        {/* The design's copy is "Brand Kit Setup loading...", which describes
            nothing loading. The count is the same length and is a fact. */}
        Brand kit — {kit.completed} of {kit.total} done
      </span>

      <span
        className="absolute left-[70px] top-9 inline-flex h-6 items-center rounded-md px-2.5 text-13 font-medium"
        style={{ background: '#D3F4FB', color: '#0BAAC7' }}
      >
        Complete Brandkit
      </span>
    </Link>
  );
}
