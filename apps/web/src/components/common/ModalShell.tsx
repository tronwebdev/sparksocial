'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';

/**
 * The modal box every prototype in this app draws — extracted from
 * `CalendarModal`, which is now a thin wrapper over it.
 *
 * `SparkSocial Calendar.dc.html` and `SparkSocial Discovery.dc.html` specify the
 * same object at different heights: **1035 wide at x=346, radius 24**, on
 * `linear-gradient(160deg, #FDFBFF 0%, …)` under
 * `0 60px 140px -40px rgba(0,0,0,0.45)`, entering on
 * `ss-modal-in 0.25s cubic-bezier(0.22,1,0.36,1)` over one scrim at
 * `rgba(40,40,40,0.45)` on `ss-fade-in 0.2s`, with a 34x34 close at right 26 /
 * top 26. Only `top`, `height` and the gradient's second stop differ — Calendar
 * ends on `#F6F9FE`, Discovery on `#F4F7FD`.
 *
 * Beyond the design: Escape closes, the body stops scrolling behind it, and the
 * scrim is `aria-hidden` so the close affordance assistive tech finds is the
 * real button. The prototypes are click-through mocks with none of that, and a
 * modal you cannot dismiss from the keyboard is a trap — this is the one place
 * every modal in the app shares, so it is the one place to fix it.
 */

export function ModalShell({
  top,
  height,
  width = 1035,
  radius = 24,
  background,
  label,
  gradientTo = '#F6F9FE',
  onClose,
  children,
}: {
  /** The design's `top` on the 1728x1117 stage. */
  top: number;
  height: number;
  /**
   * 1035 is the Calendar's and Discovery's shared width, and the default for
   * that reason. The Agent Identity panel is ~1164 in its own design, which is
   * a different box rather than a variant of theirs — so the width is a
   * parameter and the centring below stays the same.
   */
  width?: number;
  /**
   * The Calendar's and Discovery's panels are radius 24; the Assets Library's
   * Create-folder and Upload panels are 28 and its View-asset panel is 24. A
   * number rather than a class because it is measured off a design, and
   * `rounded-3xl` is 40 in this config — the kind of near-miss that is easier
   * to catch as a literal.
   */
  radius?: number;
  /**
   * A complete `background` for panels whose paint is not
   * "160deg #FDFBFF → one stop" — the Assets Library's upload panel is a
   * four-stop cyan fall and its view-asset panel is plain white. Given, it
   * replaces `gradientTo` entirely.
   */
  background?: string;
  /** Named for assistive tech; the visible title is the caller's own. */
  label: string;
  /** The gradient's second stop — the only paint that differs between screens. */
  gradientTo?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80]">
      {/* One scrim. `aria-hidden` — see the note above. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 animate-fade-in cursor-default border-0 motion-reduce:animate-none"
        style={{ background: 'rgba(40,40,40,0.45)' }}
      />

      {/*
        1035 at x=346 on the 1728 stage — centred to within 2px (346 + 1035 =
        1381, leaving 347), so it is centred here rather than pinned to 346,
        which keeps it centred at every other width too.

        Two elements, because one cannot do both: `animate-modal-in` animates
        `transform`, and on the same node as `-translate-x-1/2` the keyframes
        win — the panel loses its centring and sits 518px right of centre. The
        outer node centres, the inner one animates.

        `rounded-3xl` is 40px in this config; the design's radius is 24, so it
        is stated rather than reached for by name.
      */}
      <div className="absolute left-1/2 max-w-[calc(100%-32px)] -translate-x-1/2" style={{ top, width }}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={cn('relative w-full overflow-hidden', 'animate-modal-in motion-reduce:animate-none')}
          style={{
            height,
            borderRadius: radius,
            maxHeight: 'calc(100vh - 64px)',
            background: background ?? `linear-gradient(160deg, #FDFBFF 0%, ${gradientTo} 100%)`,
            boxShadow: '0 60px 140px -40px rgba(0,0,0,0.45)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-[26px] top-[26px] z-10 flex h-[34px] w-[34px] items-center justify-center transition-opacity hover:opacity-60"
          >
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M2 2l14 14M16 2 2 16" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>

          <div className="h-full overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}
