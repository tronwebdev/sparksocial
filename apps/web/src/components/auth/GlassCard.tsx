import { cn } from '@/lib/utils';
import { SparkMark } from '@/components/brand/SparkMark';

/**
 * The Login sky and its frosted card, measured from `ui_screenshot/login.png`.
 *
 * ── What changed from the prototype, and why ──────────────────────────────
 *
 * `SparkSocial Auth.dc.html` had 568px of glass around a 540px card. The Figma
 * capture measures **472 / 448**, centred in a 1440 frame — about 20% narrower.
 * Neither prototype number was wrong on purpose; both were literals in component
 * files with nothing to compare them against. Geometry now lives in
 * `tokens.css` (`--ss-auth-*`) so there is one place to correct.
 *
 * The sky samples `#6CE8FF` at three widely separated points — `--ss-cyan`
 * exactly, unchanged from the prototype. The palette was never the drift.
 *
 * ── The card is not the whole glass ───────────────────────────────────────
 *
 * The white card ends immediately under the primary button. "Or continue with",
 * the provider row and the sign-up line sit on the *frosted panel* below it, not
 * inside the card — which is why this takes a separate `footer` rather than more
 * children. Rendering them inside the card is the single most visible way to get
 * this screen wrong.
 */
export function SkyBackdrop({ children, floaters = true }: { children: React.ReactNode; floaters?: boolean }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-cyan px-6 py-12">
      {/*
        The sky is a PHOTOGRAPH (`login assets/image 30.svg`), not a gradient.
        It composites over flat `--ss-cyan` with a vertical fade rather than
        replacing it — derived, not guessed: solving
        `capture = cyan·(1−a) + photo·a` against the capture gives a ≈ 0.00 at
        y=20, ≈0.3 at y=300, ≈0.7 at y=500 and ≈0.95 at y=900. So the cyan owns
        the top of the frame and the clouds only emerge toward the base, which is
        why sampling the capture's top corners returns `#6CE8FF` exactly.
      */}
      <img
        src="/auth/login-sky.svg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        style={{
          maskImage: 'linear-gradient(180deg, transparent 8%, rgba(0,0,0,0.55) 45%, #000 92%)',
          WebkitMaskImage: 'linear-gradient(180deg, transparent 8%, rgba(0,0,0,0.55) 45%, #000 92%)',
        }}
      />

      {floaters ? <AuthFloaters /> : null}
      <div className="relative w-full">{children}</div>
    </div>
  );
}

/**
 * The decorative cards around the login form — the Figma exports themselves,
 * from `ui build/assets/login assets/`, not reconstructions.
 *
 * Each card ships as one SVG with its caption, chrome and imagery already inside
 * it, so there is nothing here to re-typeset: only where it sits and how wide it
 * is. Positions are the capture's, measured by deviation from the sky at the same
 * row, then expressed as offsets from the frame centre (1440×931 → centre
 * 720/465.5) so they track the form rather than the viewport edge:
 *
 *   campaign  x 131 → −589   y 267 → −198
 *   avatars   x 1074 → +354  y 245 → −220
 *   ideation  x 1107 → +387  y 571 → +106
 *
 * Widths come from the capture too, and height is left to each asset's own
 * aspect so nothing is stretched.
 *
 * One caveat: these SVGs put their frosted blur in a `foreignObject` carrying a
 * `backdrop-filter`. Chrome renders SVG-in-`<img>` in a restricted static mode
 * that skips `foreignObject` entirely, so that layer is inert here — the card's
 * own translucent fill still renders, and the wrapper adds the blur back with
 * `backdrop-blur` so it frosts the sky behind it as intended.
 *
 * Hidden below `xl`: the capture says nothing about narrow widths, and letting
 * these overlap the form would be worse than omitting them.
 *
 * NOT from the export folder: the "Overall Performance 565" gauge (lower left)
 * has no asset in it, so it stays hand-built. Flagged in `ui build/MANIFEST.md`.
 */
function AuthFloaters() {
  return (
    <div className="pointer-events-none absolute inset-0 hidden xl:block" aria-hidden>
      {/* Active Agent Campaign — left of the card */}
      <Floater
        src="/auth/login-float-campaign.svg"
        className="left-[calc(50%-589px)] top-[calc(50%-198px)] w-[176px] animate-float-a"
        panel={{ inset: '0.19% 0.53% 0.35% 11.63%', radius: 19, blur: 8.25 }}
      />

      {/* Overall Performance gauge — lower left. Hand-built: no export exists. */}
      <figure className="absolute left-[calc(50%-495px)] top-[calc(50%+208px)] w-[104px] animate-float-b rounded-[16px] bg-white/60 p-2.5 text-center shadow-card backdrop-blur-md">
        <span className="mx-auto block h-6 w-6 rounded-full bg-brand-wash" />
        <figcaption className="mt-1.5 text-[8px] font-medium text-ink">Overall Performance</figcaption>
        <svg viewBox="0 0 100 62" className="mx-auto mt-1 w-[70px]">
          <path d="M8 56 A42 42 0 0 1 92 56" fill="none" stroke="rgba(12,12,12,0.10)" strokeWidth="9" strokeLinecap="round" />
          <path d="M8 56 A42 42 0 0 1 78 26" fill="none" stroke="url(#gauge)" strokeWidth="9" strokeLinecap="round" />
          <defs>
            <linearGradient id="gauge" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#6CE8FF" />
              <stop offset="100%" stopColor="#A341FF" />
            </linearGradient>
          </defs>
        </svg>
        <span className="-mt-4 block text-16 font-semibold text-ink">565</span>
      </figure>

      {/* Avatar stack — upper right. Needs no `panel`: this export keeps its
          frosted fill as a plain `fill-opacity="0.25"` rect, so it renders. */}
      <Floater
        src="/auth/login-float-avatars.svg"
        className="left-[calc(50%+354px)] top-[calc(50%-220px)] w-[172px] animate-float-b"
      />

      {/* Autonomous content ideation — lower right */}
      <Floater
        src="/auth/login-float-ideation.svg"
        className="left-[calc(50%+387px)] top-[calc(50%+106px)] w-[166px] animate-float-a"
        panel={{ inset: '8.22% 0.42% 0.28% 0.23%', radius: 20, blur: 8.25 }}
      />
    </div>
  );
}

/**
 * One floating card: the export, plus its frosted panel where the export cannot
 * carry it.
 *
 * `Group 96.svg` states its panel as `<rect fill="white" fill-opacity="0.25">`,
 * which renders fine inside an `<img>`. The two `Login Form` exports instead put
 * theirs in the `foreignObject` blur layer that SVG-in-`<img>` drops — so those
 * cards would float as bare photo + caption with no card behind them.
 *
 * `panel.inset` is not a guess at where the card is: it is the export's own
 * `bgblur_0_*_clip_path` converted to percentages of the SVG canvas. For the
 * campaign card that path runs x 23.85→203.92 of 205 and y 0.41→215.24 of 216 —
 * i.e. the card is inset ~11.6% from the left, because the canvas also has to
 * hold the blur bleed. Filling the whole `<img>` box instead would draw the
 * frosted panel wider than the card it belongs to.
 */
function Floater({
  src,
  className,
  panel,
}: {
  src: string;
  className: string;
  panel?: { inset: string; radius: number; blur: number };
}) {
  return (
    <div className={cn('absolute', className)}>
      {panel ? (
        <div
          className="absolute"
          style={{
            inset: panel.inset,
            borderRadius: `${panel.radius}px`,
            background: 'rgba(255,255,255,0.25)',
            backdropFilter: `blur(${panel.blur}px)`,
            WebkitBackdropFilter: `blur(${panel.blur}px)`,
          }}
        />
      ) : null}
      <img src={src} alt="" className="relative block w-full" />
    </div>
  );
}

/**
 * Card masthead: the dotted halftone and cyan bloom bleeding from the top edge,
 * the mark, then the heading pair.
 *
 * The halftone escapes the card's 36px gutter with negative insets rather than
 * living outside the padded box, which keeps the whole masthead one component
 * instead of splitting it across GlassCard's children.
 */
export function AuthHeader({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="relative">
      {/*
        The halftone is the Figma export (`login assets/Frame (1).svg`), not a
        `radial-gradient` standing in for it: the real dots are outlined diamonds
        stroked in `#A341FF`, which a dot pattern cannot produce. Exported at
        540 wide, scaled to the 448 card, and masked so it fades out downward as
        the capture does.
      */}
      <div className="pointer-events-none absolute -left-auth-gutter -right-auth-gutter -top-10 h-[130px] overflow-hidden" aria-hidden>
        <img
          src="/auth/login-card-halftone.svg"
          alt=""
          className="absolute inset-x-0 top-0 w-full opacity-40"
          style={{
            WebkitMaskImage: 'linear-gradient(180deg,#000 40%,transparent 100%)',
            maskImage: 'linear-gradient(180deg,#000 40%,transparent 100%)',
          }}
        />
        <div
          className="absolute left-1/2 top-2 h-[96px] w-[96px] -translate-x-1/2 rounded-full opacity-70"
          style={{ background: 'var(--ss-info)', filter: 'blur(34px)' }}
        />
      </div>

      <div className="relative flex flex-col items-center">
        <SparkMark variant="card" size={48} animated />
        <h1 className="mt-[23px] text-center text-22 font-semibold text-ink-heading">{title}</h1>
        {subtitle ? <p className="mt-[7px] text-center text-14 text-ink-muted">{subtitle}</p> : null}
      </div>
    </div>
  );
}

/**
 * The frosted panel. `footer` renders on the glass under the white card — see
 * the note above; it is not an afterthought slot, it is where the provider row
 * actually lives.
 */
export function GlassCard({
  children,
  footer,
  className,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('mx-auto w-auth-glass max-w-full rounded-[42px] p-auth-glass-pad', className)}
      style={{
        background: 'rgba(255,255,255,0.25)',
        backdropFilter: 'blur(30px)',
        WebkitBackdropFilter: 'blur(30px)',
        boxShadow: 'var(--ss-shadow-overlay)',
      }}
    >
      {/* `overflow-hidden` is what lets AuthHeader's halftone bleed to the card
          edge from inside the 36px gutter, instead of needing its own wrapper. */}
      <div className="relative overflow-hidden rounded-2xl bg-white px-auth-gutter pb-[38px] pt-10">{children}</div>
      {footer ? <div className="px-auth-gutter pb-2 pt-[25px]">{footer}</div> : null}
    </div>
  );
}
