'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The prototype's own layout device, adopted rather than approximated.
 *
 * `SparkSocial Onboarding.dc.html` draws every full-bleed screen on a fixed
 * **1728×1117** canvas and then scales the whole thing to the viewport —
 * `left: {{ stageLeft }}; transform: {{ stageScale }}; transform-origin: top left`.
 * Every position inside it is absolute and exact.
 *
 * Rebuilding those screens with responsive flow is what made them "not exact":
 * a centred column re-derives each gap from the ones around it, so the design's
 * absolute 903px button top becomes whatever the stack happens to add up to.
 * Inside a stage, 903 is 903.
 *
 * The scale is computed in JS because CSS cannot: `scale()` needs a unitless
 * number and `calc(100vw / 1728)` is a length. One resize listener, no layout
 * thrash — the transform is composited.
 *
 * Only the two splash screens use this. The stepped onboarding screens keep the
 * responsive chrome, which is what the brief asked to leave alone.
 */
export function Stage({
  background,
  children,
  contentHeight = 1117,
}: {
  /** Painted behind and around the stage, so short viewports letterbox cleanly. */
  background: string;
  children: React.ReactNode;
  /** Overridable for a screen whose art runs past the canvas. */
  contentHeight?: number;
}) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const fit = () => {
      // Width-driven, as the prototype is: the design is wider than it is tall
      // relative to most windows, and letterboxing vertically is the behaviour
      // the stage already implies. Never upscales past 1:1.
      setScale(Math.min(1, window.innerWidth / 1728));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', minHeight: '100vh', overflow: 'hidden', background }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          width: 1728,
          height: contentHeight,
          transform: `translateX(-50%) scale(${scale})`,
          transformOrigin: 'top center',
          background,
        }}
      >
        {children}
      </div>
      {/* Reserves the scaled height so the page scrolls rather than clipping when
          the window is shorter than the canvas. */}
      <div aria-hidden style={{ height: contentHeight * scale }} />
    </div>
  );
}

/**
 * The stepped screens' form content, at the prototype's own numbers.
 *
 * Those screens keep the responsive chrome — the brief said to leave the logo,
 * background, Back, Continue and Finish alone — so they cannot live on a full
 * `Stage`. But their fields are specified just as absolutely: two **432**-wide
 * columns at x=420 and x=879, a 57px select, a 55px input, a 44px chip, a
 * 45×24.3 toggle, radii of 10 / 10.38 / 12.6 / 12.76 / 13.94 / 15.
 *
 * Scaling those by hand into the shell's 750px column means rounding thirty
 * numbers and losing the relationships between them — a 10px radius and a 10.38
 * chip radius both become 8. So the block is authored at the prototype's own
 * 891px span (420→1311) and scaled once, which keeps every value literal and
 * every proportion intact.
 *
 * Height is measured rather than assumed: a `transform` does not affect layout,
 * so without reserving the scaled height the block would overlap whatever
 * follows it.
 */
export function ProtoScale({ native = 891, children }: { native?: number; children: React.ReactNode }) {
  /**
   * The canvas ratio, not a per-screen fudge: the prototype is 1728 wide and the
   * app's design frame is 1440, so everything from it scales by the same
   * 0.8333. That is why the two-column span (891) lands at 742.5 — within 8px of
   * the shell's measured 750 column — while a single-column screen (547) lands
   * at 456 rather than being stretched to fill.
   *
   * Deriving the scale from the target width instead would make each screen its
   * own scale and quietly resize the type between steps.
   */
  const scale = 1440 / 1728;
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ width: native * scale, maxWidth: '100%', height: height * scale, position: 'relative' }}>
      <div
        ref={inner}
        style={{ position: 'absolute', top: 0, left: 0, width: native, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The mark, at the two sizes the prototype draws it, built from its own divs
 * rather than the SVG export.
 *
 * Not a stylistic preference: the splash marks are 373.69px and carry effects
 * the export cannot show through an `<img>` — the dark variant is a translucent
 * shell with an inset cyan glow and a *blurred* blob layer at 25% opacity, and
 * the light one has an 18.685px inset black ring. The exported SVG puts its
 * frosted layers in `foreignObject`, which Chrome drops in `<img>`, so at this
 * size the difference is the whole look.
 */
export function SplashMark({ tone }: { tone: 'dark' | 'light' }) {
  const blobs = (
    <>
      <span style={{ position: 'absolute', left: 0, top: 58, width: 110.18, height: 110.18, borderRadius: '50%', background: '#F56BFF' }} />
      <span style={{ position: 'absolute', left: 120, top: 0, width: 110.18, height: 110.18, borderRadius: '50%', background: '#A341FF' }} />
      <span style={{ position: 'absolute', left: 130, top: 104, width: 110.18, height: 110.18, borderRadius: '50%', background: '#F56BFF' }} />
      <span style={{ position: 'absolute', left: 47, top: 5, width: 90, height: 90, borderRadius: '50%', background: '#6CE8FF' }} />
    </>
  );

  return (
    <div style={{ position: 'absolute', left: 677.47, top: 125, width: 373.69, height: 373.69 }}>
      {tone === 'dark' ? (
        <>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', boxShadow: 'inset 0 0 37.4px -7.5px rgba(108,232,255,0.35)' }} />
          <div style={{ position: 'absolute', left: 65.42, top: 77.87, width: 244.72, height: 219.85, overflow: 'hidden', opacity: 0.25, filter: 'blur(30px)' }}>
            {blobs}
          </div>
          <div style={{ position: 'absolute', left: 52, top: 122, width: 270, height: 125, borderRadius: 16, background: 'rgba(108,232,255,0.14)' }} />
          <div
            className="animate-breathe motion-reduce:animate-none"
            style={{
              position: 'absolute', left: 74.46, top: 138.37, width: 228.21, height: 92.52, borderRadius: 69.05,
              background: 'rgba(108,232,255,0.22)',
              boxShadow: 'inset 0 0 34.8px -6.2px #6CE8FF, 0 0 42px -4px rgba(108,232,255,0.55)',
            }}
          />
        </>
      ) : (
        <>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#FFFFFF', boxShadow: 'inset 0 0 0 18.685px #000000' }} />
          <div style={{ position: 'absolute', left: 65.42, top: 77.87, width: 244.72, height: 219.85, overflow: 'hidden' }}>{blobs}</div>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(123.36px)', WebkitBackdropFilter: 'blur(123.36px)', boxShadow: 'inset 0 0 37.37px -7.47px #E9EFF5' }} />
          <div
            className="animate-breathe motion-reduce:animate-none"
            style={{
              position: 'absolute', left: 74.46, top: 138.37, width: 228.21, height: 92.52, borderRadius: 69.05,
              background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(62.36px)', WebkitBackdropFilter: 'blur(62.36px)',
              boxShadow: 'inset 0 0 34.75px -6.17px #6CE8FF',
            }}
          />
        </>
      )}
      <div style={{ position: 'absolute', left: 108.37, top: 166.03, width: 37.37, height: 37.37, borderRadius: '50%', background: '#FFFFFF' }} />
      <div style={{ position: 'absolute', left: 235.43, top: 166.03, width: 37.37, height: 37.37, borderRadius: '50%', background: '#FFFFFF' }} />
    </div>
  );
}

/** The 784-wide arch behind both splash titles. */
export function ArchDome({ tone }: { tone: 'dark' | 'light' }) {
  const id = `arch-${tone}`;
  const dark = tone === 'dark';
  return (
    <svg
      width="784"
      height={dark ? 364 : 359}
      viewBox={`0 0 784 ${dark ? 364 : 359}`}
      style={{
        position: 'absolute',
        left: dark ? 472.11 : 472,
        top: dark ? 512 : 515,
        display: 'block',
        ...(dark ? {} : { backdropFilter: 'blur(26.19px)', WebkitBackdropFilter: 'blur(26.19px)' }),
      }}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="-0.9268" x2="0" y2="0.7386">
          <stop offset="0" stopColor={dark ? 'rgba(255,255,255,0.1)' : '#FFFFFF'} />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <path
        d={
          dark
            ? 'M 312.025 0 C 139.65 0 0 139.65 0 312.025 C 0 340.725 23.275 364 51.975 364 L 732.025 364 C 760.725 364 784 340.725 784 312.025 C 784 139.65 644.35 0 471.975 0 L 312.025 0 Z'
            : 'M 312.025 0 C 139.65 0 0 137.732 0 307.739 C 0 336.045 23.275 359 51.975 359 L 732.025 359 C 760.725 359 784 336.045 784 307.739 C 784 137.732 644.35 0 471.975 0 L 312.025 0 Z'
        }
        fill={`url(#${id})`}
      />
    </svg>
  );
}

/** The mirrored orbit outlines the prototype puts at the top of both splashes. */
export function OrbitRings({ filled }: { filled?: boolean }) {
  const d =
    'M 77.547 150.41 L 347.209 17.004 C 367.774 6.83 392.529 10.833 408.839 26.97 L 416.187 34.239 C 433.113 50.986 437.003 76.874 425.745 97.855 L 297.209 337.399 C 281.561 366.56 243.529 374.787 217.23 354.698 L 68.756 241.291 C 37.091 217.105 41.833 168.079 77.547 150.41 Z';
  const ring = (side: 'r' | 'l') => (
    <svg
      key={side}
      width="444.728"
      height="393"
      viewBox="0 0 444.728 393"
      style={{
        position: 'absolute',
        left: side === 'r' ? 1060.73 : 265,
        top: -76,
        display: 'block',
        opacity: 0.6,
        pointerEvents: 'none',
        ...(side === 'l' ? { transform: 'scaleX(-1)' } : {}),
      }}
      aria-hidden
    >
      <defs>
        <linearGradient id={`orbit-${side}-${filled ? 'f' : 'o'}`} x1="0.1" y1="0.85" x2="0.75" y2="0.05">
          <stop offset="0.2627" stopColor="#6CE8FF" />
          <stop offset="0.9863" stopColor="rgba(163,65,255,0)" />
        </linearGradient>
      </defs>
      {filled ? (
        <path d={d} fill={`url(#orbit-${side}-f)`} stroke="rgba(0,0,0,0.5)" strokeWidth="0.5" />
      ) : (
        <path d={d} fill="none" stroke={`url(#orbit-${side}-o)`} strokeWidth="1" />
      )}
    </svg>
  );
  return (
    <>
      {ring('r')}
      {ring('l')}
    </>
  );
}

/**
 * The prototype's press-and-hold, at its two skins.
 *
 * Both splashes use it — the intro's "let's get you onboarding" and the
 * completion's "Continue to Dashboard". I had removed it from Meet Spark on the
 * strength of a screenshot that shows no caption; the prototype binds
 * `introHoldStart` / `introHoldEnd` there, so the gesture was always meant.
 *
 * 900ms, and the fill is the progress: no separate indicator, which is why the
 * width transition has to be the animation rather than a CSS keyframe.
 */
export function StageHoldButton({
  tone,
  label,
  onComplete,
}: {
  tone: 'dark' | 'light';
  label: string;
  onComplete: () => void;
}) {
  const [held, setHeld] = useState(false);
  const dark = tone === 'dark';

  useEffect(() => {
    if (!held) return;
    const t = setTimeout(onComplete, 900);
    return () => clearTimeout(t);
  }, [held, onComplete]);

  const fill = (
    <div
      style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: held ? '100%' : 0,
        borderRadius: dark ? undefined : 228.41,
        background: 'linear-gradient(90deg,#6CE8FF 0%,#F56BFF 50%,#A341FF 100%)',
        ...(dark ? { opacity: 0.85 } : {}),
        transition: held ? 'width 900ms linear' : 'width 160ms ease-out',
      }}
    />
  );

  const common = {
    onMouseDown: () => setHeld(true),
    onMouseUp: () => setHeld(false),
    onMouseLeave: () => setHeld(false),
    onTouchStart: () => setHeld(true),
    onTouchEnd: () => setHeld(false),
    // Enter and Space must also work; a hold is an affordance, not a gate.
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onComplete();
      }
    },
  };

  if (dark) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        {...common}
        style={{ position: 'absolute', left: 648, top: 903, width: 432, height: 82.76, borderRadius: 228.41, cursor: 'pointer' }}
      >
        <div style={{ position: 'absolute', left: 4.67, top: 6.53, width: 422.55, height: 70.09, borderRadius: 20, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
          {fill}
          <span style={{ position: 'absolute', left: 43, top: 19.5, fontSize: 23.61, fontWeight: 500, lineHeight: 1, color: '#838383', whiteSpace: 'nowrap' }}>
            {label}
          </span>
          <svg width="13" height="26" viewBox="0 0 13 26" fill="none" style={{ position: 'absolute', left: 335, top: 22, display: 'block' }} aria-hidden>
            <path d="M2 2l9 11-9 11" stroke="#838383" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      {...common}
      style={{ position: 'absolute', left: 648, top: 903, width: 432, height: 82.76, borderRadius: 228.41, background: '#FFFFFF', overflow: 'hidden', cursor: 'pointer' }}
    >
      {fill}
      <div style={{ position: 'absolute', left: 46, top: 26, width: 345.6, height: 30 }}>
        <span style={{ position: 'absolute', left: 0, top: 0, fontSize: 23.61, fontWeight: 600, lineHeight: 1.27, color: 'rgba(0,0,0,0.6)', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <svg width="13" height="26" viewBox="0 0 13 26" fill="none" style={{ position: 'absolute', left: 332.6, top: 2, display: 'block' }} aria-hidden>
          <path d="M2 2l9 11-9 11" stroke="rgba(0,0,0,0.4)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
