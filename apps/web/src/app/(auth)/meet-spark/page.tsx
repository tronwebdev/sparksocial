'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Meet Spark — built to `ui_screenshot/…192715.png` (frame 1440×931).
 *
 * Hands off to onboarding (ONB-01→ONB-06), as the prototype does. It used to
 * drop straight into the shell because onboarding did not exist, which left a
 * new account looking at a dashboard with no genome behind it.
 *
 * ── Measured ─────────────────────────────────────────────────────────────
 *
 *   orb core     212px across, 156→367 vertically, centred on the frame
 *   dome         behind the title, y 426-583
 *   sub-line     y 600-619
 *   CTA          376 wide (532→908) — the same content width as every card
 *
 * ── What changed, and one thing that is no longer a hold ─────────────────
 *
 * The three artwork layers are exports now (`spalsh screen … scatter particle`,
 * `Splash screen … arh dome`, `sign up logo`), replacing a single hand-rolled
 * radial gradient that stood in for all of them.
 *
 * The CTA was a `HoldButton` — press-and-hold. The capture shows a plain pill
 * with a chevron and no "press and hold" caption, so it is a plain button here.
 * `HoldButton` is still right on the onboarding completion screen, which *does*
 * caption itself "Press & Hold button to continue" (`…193247`); the two screens
 * were treated as one gesture and are not.
 */
export default function MeetSparkPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  /**
   * Just navigates. Selecting the organisation is `OrgGuard`'s job in the
   * `(app)` layout — it has to be, because every other way into the shell (a
   * deep link, a bookmark, a refresh) bypasses this screen. Doing it here too
   * would be a second implementation of the same rule, free to drift from the
   * one that actually covers all the entry points.
   */
  function begin() {
    setBusy(true);
    router.push('/onboarding');
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[--ss-ink-900] px-6">
      {/*
        One export, not a stack: `meet spark background.svg` is #0C0C0C with the
        particle field and its gradients already composited in, so the separate
        particle layer this used to draw is gone.
      */}
      <img
        src="/auth/bg-splash.svg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />

      <div className="relative flex flex-col items-center">
        <img
          src="/auth/signup-logo.svg"
          alt=""
          aria-hidden
          className="h-[212px] w-[212px] animate-breathe motion-reduce:animate-none"
        />

        {/* The dome sits behind the title, overlapping the orb's lower edge. */}
        <div className="relative mt-[59px] flex flex-col items-center">
          <img
            src="/auth/splash-dome.svg"
            alt=""
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[-46px] w-[784px] max-w-none -translate-x-1/2"
          />

          <h1 className="relative font-display text-[48.5px] leading-[1.15] text-white/70">
            Meet{' '}
            {/* "Spark" carries the brand gradient; `bg-clip-text` needs a
                transparent fill or the gradient never shows through. */}
            <span
              className="bg-clip-text text-transparent text-[104.77px]"
              style={{ backgroundImage: 'var(--ss-grad-brand)' }}
            >
              Spark
            </span>
          </h1>
          <p className="relative mt-[18px] text-18 text-white/70">your Ai Social Agent</p>
        </div>

        <div className="relative mt-[121px] w-[376px] max-w-full">
          <Button
            size="cta"
            onClick={begin}
            disabled={busy}
            className="w-full justify-center gap-3 border border-transparent bg-transparent text-16 font-normal text-white/85 hover:bg-white/[0.06]"
            style={{
              backgroundImage: 'linear-gradient(var(--ss-ink-900), var(--ss-ink-900)), var(--ss-grad-brand)',
              backgroundOrigin: 'padding-box, border-box',
              backgroundClip: 'padding-box, border-box',
            }}
          >
            {busy ? 'Setting up…' : "let's get you onboarding"}
            {!busy ? (
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden>
                <path d="m1 1 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </Button>
        </div>
      </div>
    </div>
  );
}
