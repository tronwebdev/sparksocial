'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { Stage, SplashMark, ArchDome, OrbitRings, StageHoldButton } from '@/components/onboarding/Stage';

/**
 * Meet Spark — rebuilt from `ui build/SparkSocial Onboarding.dc.html`
 * (`data-screen-label="Meet Spark Splash"`, Figma 1728×1117 dark).
 *
 * ── Why this is a rewrite and not a nudge ────────────────────────────────
 *
 * The previous version was measured off `…192715.png` and centred its column
 * responsively. Two things were wrong beyond spacing:
 *
 * 1. **It was not a hold button.** The screenshot shows no caption, so I made it
 *    a plain button. The prototype binds `introHoldStart` / `introHoldEnd` — the
 *    press-and-hold was always the intended gesture, and Meet Spark shares it
 *    with the completion splash.
 * 2. **"Spark" is flat `#6CE8FF`,** not the brand gradient I gave it.
 *
 * And the canvas is 1728×1117, not the 1440 frame the screenshot was cropped to,
 * which is why every size read small: the mark is **373.69px**, not 212.
 *
 * Everything below is the prototype's own absolute geometry inside `Stage`.
 */
export default function MeetSparkPage() {
  const router = useRouter();

  /**
   * The prototype iterates `starDots` — a binding whose data is not in the file,
   * so these twelve positions are ours. Fixed rather than random so the field
   * does not reshuffle on every render and is the same for everyone.
   */
  const stars = useMemo(
    () =>
      [
        [214, 176, 4, '#6CE8FF'],
        [389, 92, 3, '#F56BFF'],
        [520, 300, 2, '#FFFFFF'],
        [1290, 150, 4, '#A341FF'],
        [1455, 260, 3, '#6CE8FF'],
        [1180, 60, 2, '#FFFFFF'],
        [300, 470, 3, '#A341FF'],
        [1520, 470, 4, '#F56BFF'],
        [640, 120, 2, '#6CE8FF'],
        [1060, 210, 3, '#FFFFFF'],
        [160, 620, 3, '#6CE8FF'],
        [1600, 640, 2, '#A341FF'],
      ] as ReadonlyArray<readonly [number, number, number, string]>,
    [],
  );

  return (
    <Stage background="#0C0C0C">
      {stars.map(([l, t, w, c], i) => (
        <div
          key={i}
          aria-hidden
          className="animate-twinkle motion-reduce:animate-none"
          style={{
            position: 'absolute',
            left: l,
            top: t,
            width: w,
            height: w,
            borderRadius: '50%',
            background: c,
            boxShadow: `0 0 6px 1px ${c}`,
            animationDuration: `${2.4 + (i % 4) * 0.6}s`,
            animationDelay: `${(i % 6) * 0.35}s`,
          }}
        />
      ))}

      <OrbitRings />
      <ArchDome tone="dark" />
      <SplashMark tone="dark" />

      {/* Title block 396.13×133 at 664.53,574. "Meet" sits 39.6 lower than
          "Spark" because the two are baseline-aligned at very different sizes. */}
      <div style={{ position: 'absolute', left: 664.53, top: 574, width: 396.13, height: 133 }}>
        <span
          className="font-display"
          style={{
            position: 'absolute',
            left: 0,
            top: 39.6,
            fontSize: 46.78,
            lineHeight: 1.269,
            color: 'rgba(255,255,255,0.6)',
            whiteSpace: 'nowrap',
          }}
        >
          Meet
        </span>
        <span
          className="font-display"
          style={{
            position: 'absolute',
            left: 127.13,
            top: 0,
            fontSize: 104.77,
            lineHeight: 1.269,
            color: '#6CE8FF',
            whiteSpace: 'nowrap',
          }}
        >
          Spark
        </span>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 719,
          top: 713,
          width: 290,
          textAlign: 'center',
          fontSize: 30.65,
          lineHeight: 1.269,
          color: 'rgba(255,255,255,0.6)',
          whiteSpace: 'nowrap',
        }}
      >
        your Ai Social Agent
      </div>

      <StageHoldButton tone="dark" label="let’s get you onboarding" onComplete={() => router.push('/onboarding')} />

      {/*
        "Press & hold to begin" — `Onboarding.dc.html`'s Meet Spark Splash, at
        its own numbers: 760.5,1010 · 207 wide · 14px · rgba(255,255,255,0.35).

        It was missing, and it is the only thing on the screen that says the
        button is not a button. `StageHoldButton` fills over 900ms and navigates
        at the end; a click does nothing at all, so without this line the screen
        reads as broken to anyone who taps it once — which is everyone, the
        first time. The completion screen has always carried its equivalent
        ("Press & Hold button to continue"); this one did not.

        Not a `<button>` and not focusable: it labels the control rather than
        being one. `StageHoldButton` is what keyboard and screen-reader users
        reach, and a second tab stop saying "press and hold" would be a tab stop
        that does nothing.
      */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 760.5,
          top: 1010,
          width: 207,
          textAlign: 'center',
          fontSize: 14,
          color: 'rgba(255,255,255,0.35)',
        }}
      >
        Press &amp; hold to begin
      </div>
    </Stage>
  );
}
