'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * PRESS AND HOLD — the prototype's entry and exit gesture (`F6`).
 *
 * It appears exactly twice, at the two moments the design treats as thresholds:
 * "let's get you onboarding" on the splash, and "Continue to Dashboard" on the
 * completion screen. Both are deliberate acts rather than navigation, and the
 * hold is the design saying so.
 *
 * ── Why it is not only a hold ─────────────────────────────────────────────
 *
 * A gesture nobody has been taught is a dead end, and a hold is impossible with a
 * keyboard and hostile with a switch or a screen reader. So this is a real
 * `<button>`: Enter and Space fire it immediately, a plain click after a short
 * grace period fires it too, and the hold is the *affordance* rather than the
 * only way through. The prototype's own caption — "Press & hold to begin" — is
 * kept, because the fill needs explaining either way.
 *
 * `prefers-reduced-motion` removes the fill's transition. The hold still works;
 * it simply stops animating, which is what that preference asks for.
 */

const HOLD_MS = 900;
/** A click shorter than this is treated as "did not know it was a hold" and still passes. */
const CLICK_GRACE_MS = 250;

export function HoldButton({
  label,
  caption,
  onComplete,
  tone = 'light',
  className,
}: {
  label: string;
  /** The line under the button. Omit for no caption. */
  caption?: string;
  onComplete: () => void;
  /** `dark` for the near-black splash, `light` for a normal page. */
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const started = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const done = useRef(false);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    started.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  const finish = useCallback(() => {
    // Guarded, because a pointer release after the hold completes would
    // otherwise fire a second time — and "continue" twice means two pushes.
    if (done.current) return;
    done.current = true;
    stop();
    onComplete();
  }, [onComplete, stop]);

  const tick = useCallback(() => {
    if (started.current === null) return;
    const elapsed = performance.now() - started.current;
    const next = Math.min(1, elapsed / HOLD_MS);
    setProgress(next);
    if (next >= 1) {
      finish();
      return;
    }
    frame.current = requestAnimationFrame(tick);
  }, [finish]);

  const begin = useCallback(() => {
    if (done.current || started.current !== null) return;
    started.current = performance.now();
    setHolding(true);
    frame.current = requestAnimationFrame(tick);
  }, [tick]);

  const release = useCallback(() => {
    if (done.current || started.current === null) return;
    const held = performance.now() - started.current;
    stop();
    // A quick tap is somebody who did not read the caption. Refusing it would be
    // a button that looks broken.
    if (held < CLICK_GRACE_MS) finish();
  }, [finish, stop]);

  // Cancels a hold that ends outside the button, and a component unmounted
  // mid-hold — an orphaned rAF loop calling setState is a React warning and, on
  // a route change, a leak.
  useEffect(() => stop, [stop]);

  const dark = tone === 'dark';

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <button
        type="button"
        onPointerDown={begin}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onKeyDown={(e) => {
          // Enter and Space complete immediately: a keyboard has no notion of
          // holding, and asking somebody to hold a key for 900ms to finish setup
          // is worse than not having the gesture at all.
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            finish();
          }
        }}
        className={cn(
          'relative w-full max-w-[420px] overflow-hidden rounded-full px-8 py-4 text-[17px] font-medium transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          dark ? 'bg-white/10 text-white' : 'border border-border bg-surface text-ink hover:bg-surface-muted',
        )}
      >
        {/* The fill, behind the label. `aria-hidden` because the label already
            says what the button does and a progress announcement on every frame
            would be unusable. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-brand-wash motion-reduce:transition-none"
          style={{ width: `${Math.round(progress * 100)}%`, transition: holding ? 'none' : 'width 200ms ease' }}
        />
        <span className="relative">{label}</span>
      </button>
      {caption ? (
        <span className={cn('text-[13px]', dark ? 'text-white/40' : 'text-ink-muted')}>{caption}</span>
      ) : null}
    </div>
  );
}
