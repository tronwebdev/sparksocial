'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared furniture for the Create Campaign screen —
 * `ui build/SparkSocial Create Campaign.dc.html`.
 *
 * ── Why this screen is laid out in absolute pixels ────────────────────────
 *
 * The prototype is a 1728-wide stage with every element placed absolutely, and
 * the modal's geometry changes per step: the panel inside step 5 is 920 wide
 * where step 1's is 596, and the modal grows from 892 to 1114 to hold it. There
 * is no flow layout underneath that a flexbox rebuild could recover — the
 * panels are different shapes with hand-cut notches, and the orb straddles the
 * panel's top edge. So the stage is reproduced as a stage, scaled to the
 * viewport, exactly as the prototype does it (`transform: scale(pageW/1728)`).
 *
 * That is a deliberate exception to how the rest of the app is built. It is
 * confined to this one screen, and it is why the geometry lives in a table here
 * rather than being spread through the JSX.
 */

/** The prototype's stage width. Every coordinate below is on this stage. */
export const STAGE = 1728;

export type Step = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Per-step geometry, read straight off the prototype's `renderVals()`.
 *
 * `frame` is the height of the whole stage, which step 5 grows because its
 * modal does. `prog` is the *width* of the progress fill, not a percentage:
 * the design's stops are not evenly spaced (54, 123, 257, 349, 453, 507 across
 * a 508 track), so the bar accelerates through the middle steps. Deriving it as
 * `step/6` would look right and be wrong at every stop but the last.
 */
export const STEP_GEOM: Record<Step, { modalTop: number; modalH: number; prog: number; frame: number }> = {
  1: { modalTop: 22, modalH: 892, prog: 54, frame: 1117 },
  2: { modalTop: 27, modalH: 892, prog: 123, frame: 1117 },
  3: { modalTop: 27, modalH: 1090, prog: 257, frame: 1117 },
  4: { modalTop: 27, modalH: 1024, prog: 349, frame: 1117 },
  5: { modalTop: 27, modalH: 1114, prog: 453, frame: 1184 },
  6: { modalTop: 22, modalH: 892, prog: 507, frame: 1117 },
};

/** Steps 1 and 6 sit the header 5px lower — the modal starts 5px higher. */
export const isLateHeader = (step: Step) => step === 1 || step === 6;

/**
 * The panel notches. Each is a rounded rectangle with a dip cut into its top
 * edge where the agent orb overlaps, so the orb reads as sitting *in* the panel
 * rather than on top of it. Step 6's panel has no orb and so no dip.
 */
export const PANEL_CLIP = {
  /** 548×335 — the intro card. */
  popup:
    "path('M 0 53.284 C 0 34.914 14.891 20.023 33.261 20.023 L 236.019 20.023 C 242.922 20.023 249.646 17.825 255.216 13.748 C 266.447 5.528 281.665 5.37 293.064 13.356 L 293.988 14.003 C 299.581 17.921 306.244 20.023 313.072 20.023 L 514.739 20.023 C 533.109 20.023 548 34.914 548 53.284 L 548 301.739 C 548 320.109 533.109 335 514.739 335 L 33.457 335 C 15.011 335 0.088 319.989 0.197 301.544 L 1.04 157.941 L 0 121.012 L 0 73.46 L 0 53.284 Z')",
  /** 596×551 — steps 1 and 2. */
  s12:
    "path('M 1.032 44.922 C 1.032 28.353 14.463 14.922 31.032 14.922 L 251.423 14.922 C 254.678 14.922 257.911 14.392 260.995 13.354 L 290.908 3.283 C 297.229 1.155 304.077 1.194 310.373 3.393 L 338.575 13.244 C 341.755 14.354 345.1 14.922 348.468 14.922 L 566 14.922 C 582.569 14.922 596 28.353 596 44.922 L 596 521 C 596 537.569 582.569 551 566 551 L 30.069 551 C 13.474 551 0.031 537.527 0.069 520.931 L 1.032 102.125 L 1.032 79.008 L 1.032 56.554 L 1.032 44.922 Z')",
  /** 638×806 — step 3. */
  s3:
    "path('M 1.105 46.236 C 1.105 29.668 14.536 16.236 31.105 16.236 L 269.411 16.236 C 272.715 16.236 275.997 15.69 279.124 14.62 L 311.952 3.386 C 318.36 1.193 325.321 1.233 331.703 3.499 L 362.707 14.507 C 365.93 15.651 369.325 16.236 372.745 16.236 L 608 16.236 C 624.569 16.236 638 29.668 638 46.236 L 638 776 C 638 792.569 624.569 806 608 806 L 30.048 806 C 13.461 806 0.021 792.539 0.048 775.952 L 1.105 111.122 L 1.105 85.968 L 1.105 61.537 L 1.105 46.236 Z')",
  /** 592×749 — step 4. */
  s4:
    "path('M 1.025 50.284 C 1.025 33.715 14.457 20.284 31.025 20.284 L 248.039 20.284 C 252.373 20.284 256.656 19.344 260.592 17.531 L 285.853 5.892 C 293.955 2.159 303.297 2.225 311.345 6.072 L 334.938 17.35 C 338.978 19.281 343.399 20.284 347.876 20.284 L 562 20.284 C 578.569 20.284 592 33.715 592 50.284 L 592 719 C 592 735.569 578.569 749 562 749 L 30.05 749 C 13.462 749 0.023 735.538 0.05 718.95 L 1.025 138.823 L 1.025 107.399 L 1.025 76.877 L 1.025 50.284 Z')",
  /** 920×870 — step 5. */
  s5:
    "path('M 1.593 43.038 C 1.593 26.469 15.025 13.038 31.593 13.038 L 416.563 13.038 C 419.505 13.038 422.431 12.605 425.248 11.753 L 455.348 2.649 C 461.056 0.922 467.15 0.936 472.851 2.69 L 502.191 11.712 C 505.048 12.591 508.02 13.038 511.009 13.038 L 890 13.038 C 906.569 13.038 920 26.469 920 43.038 L 920 840 C 920 856.569 906.568 870 890 870 L 30.064 870 C 13.471 870 0.029 856.529 0.064 839.936 L 1.593 126.285 L 1.593 96.264 L 1.593 67.104 L 1.593 43.038 Z')",
  /** 596×633 — step 6. No dip: this is the one step with no orb over it. */
  s6:
    "path('M 1.032 30 C 1.032 13.431 14.463 0 31.032 0 L 256.338 0 L 309.275 0.001 L 343.379 0 L 566 0 C 582.569 0 596 13.431 596 30 L 596 603 C 596 619.569 582.569 633 566 633 L 30.058 633 C 13.467 633 0.026 619.533 0.059 602.942 L 1.032 102.969 L 1.032 75.673 L 1.032 49.16 L 1.032 30 Z')",
} as const;

/** The blob behind the modal, and the one behind step 6's sticker. */
const BLOB_CLIP =
  "path('M 98.287 114.141 L 352.583 11.767 C 370.633 4.501 391.426 7.74 406.582 19.942 C 428.166 37.319 433.35 68.539 418.097 91.672 L 296.34 276.321 C 280.309 300.631 247.834 307.753 223.101 292.38 L 89.987 209.641 C 52.616 186.413 57.469 130.574 98.287 114.141 Z')";

/** The two decorative gradient blobs inside the modal, top-right and mid-left. */
export function ModalBlobs() {
  return (
    <>
      <div
        aria-hidden
        className="absolute left-[591px] top-[29px] h-[320px] w-[445px] bg-cmp-blob-a"
        style={{ clipPath: BLOB_CLIP }}
      />
      <div
        aria-hidden
        className="absolute left-0 top-0 h-[320px] w-[445px] bg-cmp-blob-b"
        style={{ clipPath: BLOB_CLIP, transform: 'matrix(-1,0,0,1,446,437)', transformOrigin: '0 0' }}
      />
    </>
  );
}

/**
 * The agent orb, at either of the two sizes the design uses (212.891 in the
 * popup, 113 in the wizard header).
 *
 * Everything inside scales off `size`, because the prototype's two copies are
 * the same construction at two scales — the small one's numbers are the large
 * one's times 113/212.891. Writing it once and scaling is what keeps them from
 * drifting apart when either is touched.
 */
export function AgentOrb({ size, className, style }: { size: number; className?: string; style?: React.CSSProperties }) {
  const k = size / 212.891;
  const px = (n: number) => `${n * k}px`;
  return (
    <div
      aria-hidden
      className={cn('absolute overflow-hidden rounded-full', className)}
      style={{ width: size, height: size, ...style }}
    >
      <div
        className="absolute inset-0 rounded-full bg-white"
        style={{ boxShadow: `inset 0 0 0 ${px(10.645)} rgb(0,0,0)` }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'rgba(108,232,255,0.2)',
          backdropFilter: `blur(${px(102.134)})`,
          boxShadow: `inset 0 0 ${px(32.536)} ${px(11.703)} rgb(153,149,176)`,
        }}
      />
      {/* The four colour blobs that read as the agent's "face". */}
      <div
        className="absolute overflow-hidden"
        style={{ left: px(43.428), top: px(58.426), width: px(126.742), height: px(113.858) }}
      >
        <span className="absolute rounded-full" style={{ left: px(47.53), top: 0, width: px(57.06), height: px(57.06), background: 'rgb(245,107,255)' }} />
        <span className="absolute rounded-full" style={{ left: 0, top: px(8.64), width: px(83.17), height: px(83.17), background: 'rgb(108,232,255)' }} />
        <span className="absolute rounded-full" style={{ left: px(41.77), top: px(66.25), width: px(47.61), height: px(47.61), background: 'rgb(163,65,255)' }} />
        <span className="absolute rounded-full" style={{ left: px(79.14), top: px(36.29), width: px(47.61), height: px(47.61), background: 'rgb(255,255,255)' }} />
      </div>
      {/* The visor, and the two eyes on top of it. */}
      <div
        className="absolute"
        style={{
          left: px(42.417),
          top: px(78.822),
          width: px(130.011),
          height: px(52.707),
          borderRadius: px(39.338),
          background: 'rgba(255,255,255,0.07)',
          backdropFilter: `blur(${px(35.528)})`,
          boxShadow: `inset 0 0 ${px(19.799)} ${px(-3.514)} rgb(108,232,255)`,
        }}
      />
      <span className="absolute rounded-full bg-white" style={{ left: px(61.74), top: px(94.589), width: px(21.289), height: px(21.289) }} />
      <span className="absolute rounded-full bg-white" style={{ left: px(134.121), top: px(94.589), width: px(21.289), height: px(21.289) }} />
    </div>
  );
}

/** The tick inside a selected card's badge and inside step 6's checkbox. */
export function TickPath({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg width="10.157" height="10.163" viewBox="0 0 10.157 10.163" fill="rgb(255,255,255)" className={className} style={style} aria-hidden>
      <path d="M 9.821 0.425 C 9.935 0.551 10.024 0.699 10.081 0.859 C 10.139 1.02 10.164 1.19 10.156 1.36 C 10.147 1.53 10.106 1.697 10.033 1.851 C 9.96 2.005 9.857 2.143 9.731 2.257 C 8.559 3.32 7.766 4.196 7.113 5.216 C 6.452 6.246 5.899 7.477 5.267 9.293 C 5.194 9.502 5.069 9.689 4.904 9.836 C 4.738 9.983 4.538 10.085 4.322 10.132 C 4.106 10.18 3.881 10.172 3.669 10.108 C 3.458 10.044 3.266 9.927 3.112 9.768 L 0.359 6.931 C 0.122 6.683 -0.006 6.352 0 6.01 C 0.007 5.668 0.148 5.343 0.394 5.105 C 0.64 4.867 0.969 4.735 1.311 4.739 C 1.653 4.743 1.98 4.882 2.22 5.126 L 3.552 6.5 C 3.974 5.489 4.417 4.62 4.93 3.818 C 5.749 2.539 6.719 1.49 7.989 0.337 C 8.115 0.223 8.262 0.134 8.423 0.076 C 8.583 0.019 8.753 -0.007 8.923 0.001 C 9.093 0.01 9.26 0.051 9.414 0.124 C 9.568 0.197 9.706 0.299 9.821 0.425 Z" />
    </svg>
  );
}

/** The 26px selection badge on a goal / type card: filled with a tick, or an empty ring. */
export function SelectBadge({ on }: { on: boolean }) {
  return on ? (
    <span className="absolute left-[212px] top-[14px] block h-[26px] w-[26px] rounded-full bg-cmp-tick">
      <TickPath className="absolute left-[8.096px] top-[7.749px] block" />
    </span>
  ) : (
    <span
      className="absolute left-[212px] top-[14px] block h-[26px] w-[26px] rounded-full"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
    />
  );
}

/**
 * The 45×24.324 switch, used by the CTA gate on step 3 and all five
 * responsibility rows on step 5.
 *
 * A real `<button role="switch">` rather than the prototype's div, so it is
 * reachable by keyboard and announces its state — the design describes what it
 * looks like, not what it is.
 */
export function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="relative block h-cmp-switch-h w-cmp-switch-w cursor-pointer disabled:cursor-not-allowed"
    >
      <span
        className="absolute inset-0 block rounded-[121.6px] transition-colors duration-200"
        style={{
          background: on ? 'var(--ss-green-600)' : 'rgba(131,131,131,0.3)',
          boxShadow: '0 0 0 0.608px rgb(255,255,255)',
        }}
      />
      <span
        className="absolute top-[2.435px] block h-cmp-knob w-cmp-knob rounded-full bg-white transition-[left] duration-200"
        style={{ left: on ? 'var(--ss-cmp-knob-on)' : 'var(--ss-cmp-knob-off)' }}
      />
    </button>
  );
}

/** The chevron the header buttons and the duration row use. */
export function Chevron({ className, style, color = 'rgb(131,131,131)' }: { className?: string; style?: React.CSSProperties; color?: string }) {
  return (
    <svg width="8.035" height="16.069" viewBox="0 0 9 17" fill="none" className={className} style={style} aria-hidden>
      <path d="M1 1l7 7.5L1 16" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The 14px spinner beside "Assigning this campaign to …" and each review row. */
export function Spinner({ className, spin = true }: { className?: string; spin?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={className}
      style={spin ? { animation: 'ss-spin 3.5s linear infinite' } : undefined}
      aria-hidden
    >
      <circle cx="7" cy="7" r="6" stroke="rgba(131,131,131,0.3)" strokeWidth="1.6" />
      <path d="M7 1a6 6 0 0 1 6 6" stroke="rgb(131,131,131)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** The 22px info glyph that marks a section with an explanation behind it. */
export function InfoIcon({ className, title }: { className?: string; title: string }) {
  return (
    <span className={cn('block h-[21.563px] w-[21.563px]', className)} title={title}>
      <svg width="21.563" height="21.563" viewBox="0 0 22 22" fill="none" aria-hidden>
        <circle cx="11" cy="11" r="9.6" stroke="rgb(131,131,131)" strokeWidth="1.4" />
        <path d="M11 9.6v5.2" stroke="rgb(131,131,131)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="11" cy="6.9" r="1.05" fill="rgb(131,131,131)" />
      </svg>
      <span className="sr-only">{title}</span>
    </span>
  );
}

/**
 * A step panel: the notched, top-lit card each step's content sits on.
 *
 * `w`/`h` are the panel's own size on the stage; the children are positioned
 * against its top-left, matching the prototype's own nesting.
 */
export function StepPanel({
  x,
  y,
  w,
  h,
  clip,
  wash = 'bg-cmp-panel',
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  clip: string;
  wash?: string;
  children: ReactNode;
}) {
  return (
    <div className="absolute" style={{ left: x, top: y, width: w, height: h }}>
      <div
        aria-hidden
        className={cn('absolute left-0 top-0', wash)}
        style={{ width: w, height: h, backdropFilter: 'blur(41.304px)', clipPath: clip }}
      />
      {children}
    </div>
  );
}
