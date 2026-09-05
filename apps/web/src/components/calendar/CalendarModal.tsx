'use client';

import { ModalShell } from '@/components/common/ModalShell';

/**
 * The Calendar screen's modal shell — `SparkSocial Calendar.dc.html`.
 *
 * All five of its modals are the same box at five heights, and that box is now
 * `ModalShell`: `SparkSocial Discovery.dc.html` draws the identical object at
 * `60 · 900`, so the shell moved to `components/common` and this file is what it
 * always was — the map from *this screen's* five modals to their positions.
 * Everything the shell does (the scrim, the 34x34 close, both animations,
 * Escape, the scroll lock, the centring trick) is documented there.
 *
 *   Add Post        120  660
 *   Draft Review     80  760
 *   Ask Agent        50  872
 *   Create Specific 100  700
 *   Move Post       120  640
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
  /* `#F6F9FE` is this screen's gradient stop — Discovery's is `#F4F7FD`. */
  return (
    <ModalShell top={box.top} height={box.height} label={label} gradientTo="#F6F9FE" onClose={onClose}>
      {children}
    </ModalShell>
  );
}
