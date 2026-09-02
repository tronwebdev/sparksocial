'use client';

import { Stage, SplashMark, ArchDome, OrbitRings, StageHoldButton } from './Stage';

/**
 * "Congratulations on creating your first Agent" — rebuilt from
 * `ui build/SparkSocial Onboarding.dc.html` (`data-screen-label="Setup
 * Complete"`, Figma "Steps completed", 1728×1117 on `#EAEFF0`).
 *
 * ── Three things this screen was missing ─────────────────────────────────
 *
 * 1. **The arch dome.** Absent entirely. It is a 784×359 white-to-transparent
 *    arch at 472,515 carrying its own `backdrop-filter: blur(26.19px)`, and the
 *    title sits *on* it — which is why the title is white on a light ground and
 *    read as a mistake without it.
 * 2. **The press-and-hold.** It was a plain button with the caption underneath.
 *    The prototype is a 432×82.76 white pill whose gradient fill *is* the
 *    progress, with a dashed arrow and the caption **above** it.
 * 3. **The readiness list is gone.** Four lines of "what SPARK knows" that the
 *    design does not have. I had argued for keeping them — skipping is the
 *    common path, and a bare tick sends a brand with no connected account to an
 *    empty calendar. That was a product argument against an explicit design, and
 *    the design wins; the observation belongs in the dashboard's empty state,
 *    where there is room to act on it, not on a celebration screen.
 *
 * Removing the list also removes the three reads that fed it
 * (`brand.governance.get`, `integration.health`, `asset.gaps`), so this screen
 * now makes no tool calls at all.
 */
export function CompletionScreen({ onDone }: { onDone: () => void }) {
  return (
    <Stage background="#EAEFF0">
      {/* Blurred colour fields, then the outlined pair, exactly as the
          prototype layers them: two blurs behind, two outlines in front. */}
      <Blob left={949} top={46} colour="#6CE8FF" opacity={0.4} />
      <Blob left={359} top={548} colour="#A341FF" opacity={0.35} mirrored />
      <OrbitRings filled />

      {/* The horizon band. `mix-blend-mode: lighten` over a light ground is what
          darkens the middle of the screen enough for white type to read. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 291.83,
          top: 0,
          width: 1148.33,
          height: 530,
          mixBlendMode: 'lighten',
          background:
            'linear-gradient(0deg, #0C0C0C -3.46%, rgba(12,12,12,0) 58.29%, #0C0C0C 108.81%), url(/auth/horizon-glow.png) 0% 7.652% / 99.979% 131.158% no-repeat',
          pointerEvents: 'none',
        }}
      />

      <div
        className="font-display"
        style={{ position: 'absolute', left: 778, top: 55.58, fontSize: 33.57, lineHeight: 1.13, color: '#0C0C0C', whiteSpace: 'nowrap' }}
      >
        Sparksocial
      </div>

      <SplashMark tone="light" />
      <ArchDome tone="light" />

      <img
        src="/auth/confetti.png"
        alt=""
        aria-hidden
        style={{ position: 'absolute', left: 807, top: 564.54, width: 114, height: 88.92, objectFit: 'contain', pointerEvents: 'none' }}
      />

      {/*
        Copy, position, size and weight are the prototype's. The COLOUR is not,
        and this is the one place the two sources cannot both be honoured.

        The prototype sets `color:#FFFFFF` and relies on its horizon band to
        darken the ground behind it — but that band is `mix-blend-mode: lighten`
        over `#EAEFF0`, and lighten cannot darken anything, so the white title
        renders near-invisible. Verified in the browser rather than assumed:
        the band mounts, blends, and the PNG loads 200; the type is still white
        on near-white.

        `…193247` disagrees with the prototype here and is legible — "Congratulations"
        in the brand ramp, the remainder in ink. That is what this uses. Flagged
        rather than silently reconciled, because it means the prototype has a
        contrast bug worth fixing at source.
      */}
      <h1
        style={{
          position: 'absolute',
          left: 593,
          top: 672,
          width: 542,
          textAlign: 'center',
          fontSize: 43.65,
          fontWeight: 600,
          lineHeight: 1.26,
          color: 'var(--ss-fg-muted)',
        }}
      >
        <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'var(--ss-grad-brand)' }}>
          Congratulations
        </span>{' '}
        on creating your first Agent
      </h1>

      {/* Arrow then caption, both above the button — the arrow is flipped in the
          prototype (`scale(-1,-1)`) so it curls up toward the title. */}
      <img
        src="/auth/dashed-arrow.svg"
        alt=""
        aria-hidden
        style={{ position: 'absolute', left: 730, top: 832.25, width: 61, height: 45.04, transform: 'scale(-1,-1)', pointerEvents: 'none' }}
      />
      <div
        style={{ position: 'absolute', left: 760.5, top: 864, width: 240, textAlign: 'center', fontSize: 16, lineHeight: 1.25, color: '#838383' }}
      >
        Press &amp; Hold button to continue
      </div>

      <StageHoldButton tone="light" label="Continue to Dashboard" onComplete={onDone} />
    </Stage>
  );
}

/** One of the two blurred gradient fields behind the composition. */
function Blob({
  left,
  top,
  colour,
  opacity,
  mirrored,
}: {
  left: number;
  top: number;
  colour: string;
  opacity: number;
  mirrored?: boolean;
}) {
  const id = `done-blob-${colour.slice(1)}`;
  return (
    <svg
      width="444.728"
      height="393"
      viewBox="0 0 444.728 393"
      aria-hidden
      style={{
        position: 'absolute',
        left,
        top,
        display: 'block',
        filter: 'blur(80px)',
        opacity,
        pointerEvents: 'none',
        ...(mirrored ? { transform: 'scaleX(-1)' } : {}),
      }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.048" stopColor={colour} />
          <stop offset="1" stopColor="rgba(108,232,255,0.3)" />
        </linearGradient>
      </defs>
      <path
        d="M 77.547 150.41 L 347.209 17.004 C 367.774 6.83 392.529 10.833 408.839 26.97 L 416.187 34.239 C 433.113 50.986 437.003 76.874 425.745 97.855 L 297.209 337.399 C 281.561 366.56 243.529 374.787 217.23 354.698 L 68.756 241.291 C 37.091 217.105 41.833 168.079 77.547 150.41 Z"
        fill={`url(#${id})`}
      />
    </svg>
  );
}
