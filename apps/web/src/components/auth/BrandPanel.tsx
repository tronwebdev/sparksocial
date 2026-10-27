/**
 * Sign Up's left panel — the Figma exports, from `ui build/assets/`.
 *
 * This was a reconstruction: a cyan radial bloom, two pink discs and six
 * hand-placed frosted squares standing in for artwork nobody had exported. The
 * real composition is three files — the orbit rings, the avatars-and-chips ring,
 * and the hero mark — so the reconstruction is gone rather than layered under
 * them.
 *
 * Measured from `signup.png` (frame 1440×920, scale 0.7479):
 *
 *   panel width   776.5 of 1440  → 53.9%, so the split is `flex-[0_0_53.9%]`
 *   ground        #0C0C0C (`--ss-ink-900`) with a teal bloom toward the top-left
 *   title band    y 424-571, centred on the panel
 *   CTA row       y ~660-680
 *
 * The rings are square exports (764×764 and 845×596) centred on the mark, so
 * they are positioned from the centre and scale with the panel rather than
 * being pinned to its edges — at 620px minimum width the composition still
 * holds together.
 */
/**
 * `compact` is for a narrow column — Pricing gives this panel 420px. At the
 * sign-up's 620 floor and 48px title it overflowed that column and drew
 * "Agent-first Social" across the plan cards beside it.
 */
export function BrandPanel({ compact = false }: { compact?: boolean } = {}) {
  return (
    <div className="relative flex-[0_0_53.9%] overflow-hidden bg-[--ss-ink-900] max-lg:hidden" style={{ minWidth: compact ? 0 : 620 }}>
      {/* The teal bloom behind the rings. Sampled at #1A2C2F top-left against a
          #0C0C0C ground, fading out well before the panel's bottom edge. */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(circle at 50% 38%, rgba(11,170,199,0.30) 0%, rgba(11,170,199,0.09) 34%, rgba(12,12,12,0) 64%)',
        }}
      />

      {/* Orbit rings and the avatar/chip ring share the mark's centre. */}
      <img
        src="/auth/signup-orbit-rings.svg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[38%] w-[764px] max-w-[110%] -translate-x-1/2 -translate-y-1/2"
      />
      <img
        src="/auth/signup-avatars-chips.svg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[38%] w-[845px] max-w-[120%] -translate-x-1/2 -translate-y-1/2"
      />

      {/*
        Anchored to the rings, not centred in the panel. In `SparkSocial
        Auth.dc.html` the 762px ring is centred at 432 of 1117 (the same 38%
        the rings use here), the logo's top is 161 above that line and the
        title 24 below it. Centring the column put the title at 580 against the
        design's 456, and drifted it off the rings at every other height.
      */}
      <div className="absolute inset-x-0 top-[38%] flex -translate-y-[161px] flex-col items-center px-10">
        <img src="/auth/signup-logo.svg" alt="" aria-hidden className="h-[148px] w-[148px] animate-breathe" />

        {/* CS Mollwish, the display face — not the body type scale. */}
        <div className="mt-[37px] text-center">
          <p className={`font-display leading-[1.269] text-white ${compact ? 'text-32' : 'text-48'}`}>Agent-first Social</p>
          <p className={`font-display leading-[1.269] text-white ${compact ? 'text-26' : 'text-40'}`}>Operating System</p>
        </div>

        <div className="mt-[22px] flex items-center gap-[10px]">
          <span className="text-16 font-medium text-white/60">Get Started</span>
          <svg width="28" height="10" viewBox="0 0 28 10" fill="none" aria-hidden>
            <path
              d="M1 5h25m0 0-4-4m4 4-4 4"
              stroke="rgba(255,255,255,0.6)"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
