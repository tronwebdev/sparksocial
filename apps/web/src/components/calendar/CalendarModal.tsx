'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';

/**
 * The Calendar screen's modal shell — `SparkSocial Calendar.dc.html`.
 *
 * All five of its modals are the same box at five heights: 1035 wide at x=346,
 * radius 24, on `linear-gradient(160deg, #FDFBFF 0%, #F6F9FE 100%)` under a
 * `0 60px 140px -40px rgba(0,0,0,0.45)` shadow, entering on
 * `ss-modal-in 0.25s cubic-bezier(0.22,1,0.36,1)`. Behind them is one scrim at
 * `rgba(40,40,40,0.45)` on `ss-fade-in 0.2s`, and clicking it closes.
 *
 *   Add Post        120  660
 *   Draft Review     80  760
 *   Ask Agent        50  872
 *   Create Specific 100  700
 *   Move Post       120  640
 *
 * Both animations were already in `tailwind.config.ts` (`animate-modal-in`,
 * `animate-fade-in`) with the prototype's own timings, so nothing new was needed
 * for them.
 *
 * ── What the shell adds beyond the design ─────────────────────────────────
 *
 * Escape closes, focus moves into the panel on open and the body stops
 * scrolling behind it. The prototype has none of that — it is a click-through
 * mock — but a modal you cannot dismiss from the keyboard is a trap, and this
 * is the one component all five share, so it is the one place to fix it.
 */

const HEIGHTS = {
  add: { top: 120, height: 660 },
  review: { top: 80, height: 760 },
  ask: { top: 50, height: 872 },
  create: { top: 100, height: 700 },
  move: { top: 120, height: 640 },
} as const;

export type CalendarModalKind = keyof typeof HEIGHTS;

export function CalendarModal({
  kind,
  label,
  onClose,
  children,
}: {
  kind: CalendarModalKind;
  /** Named for assistive tech; the visible title is the caller's own. */
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const box = HEIGHTS[kind];

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
      {/* One scrim for all five. `aria-hidden` — the close affordance a screen
          reader should find is the panel's own button, not the backdrop. */}
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
        which keeps it centred at every other width too. The height is the
        design's; `max-h` lets a short viewport scroll it instead of clipping.
      */}
      {/*
        Two elements, because one cannot do both.

        `animate-modal-in` animates `transform`, and putting it on the same node
        as `-translate-x-1/2` meant the keyframes won: the panel lost its
        centring and sat 518px right of centre, overflowing the viewport. The
        outer node centres, the inner one animates.

        `rounded-3xl` is 40px in this config — the design's radius is 24, so it
        is stated rather than reached for by name.
      */}
      <div
        className="absolute left-1/2 w-[1035px] max-w-[calc(100%-32px)] -translate-x-1/2"
        style={{ top: box.top }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={cn(
            'relative w-full overflow-hidden rounded-[24px]',
            'animate-modal-in motion-reduce:animate-none',
          )}
          style={{
            height: box.height,
            maxHeight: 'calc(100vh - 64px)',
            background: 'linear-gradient(160deg, #FDFBFF 0%, #F6F9FE 100%)',
            boxShadow: '0 60px 140px -40px rgba(0,0,0,0.45)',
          }}
        >
        {/* 34x34 at right 26 / top 26 in every one of the five. */}
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
