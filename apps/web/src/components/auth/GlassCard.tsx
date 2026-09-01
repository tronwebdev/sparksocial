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
      {/* The horizon wash. The capture fades to a pale cloud band across the
          bottom third rather than holding flat cyan to the edge. */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(120% 60% at 50% 118%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.45) 38%, rgba(255,255,255,0) 68%),' +
            'radial-gradient(circle at 18% 12%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 45%)',
        }}
      />
      {/* Two faint arcs sweeping behind the card, as in the capture. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <path d="M-140 690 C 190 560, 300 250, 520 -60" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" fill="none" />
        <path d="M1580 700 C 1270 560, 1160 250, 950 -60" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" fill="none" />
      </svg>

      {floaters ? <AuthFloaters /> : null}
      <div className="relative w-full">{children}</div>
    </div>
  );
}

/**
 * The four decorative cards around the login form.
 *
 * Positions are the capture's, converted to CSS px against the 1440 frame and
 * expressed from the centre so they track the card rather than the viewport.
 * Hidden below `xl` — at narrower widths the capture has nothing to say and
 * overlapping the form would be worse than omitting them.
 *
 * NOTE: the photography is the closest match from `ui build/assets/`, not the
 * Figma originals, which were never exported. Logged in `ui build/MANIFEST.md`.
 */
function AuthFloaters() {
  return (
    <div className="pointer-events-none absolute inset-0 hidden xl:block" aria-hidden>
      {/* Active Agent Campaign — left of the card */}
      <figure className="absolute left-[calc(50%-590px)] top-[calc(50%-190px)] w-[148px] animate-float-a rounded-[18px] bg-white/55 p-1.5 shadow-card backdrop-blur-md">
        <div className="relative overflow-hidden rounded-[13px]">
          <img src="/auth/clientfinder-woman.png" alt="" className="h-[120px] w-full object-cover" />
          <span className="absolute right-2 top-2 flex h-3.5 w-6 items-center rounded-full bg-success px-0.5">
            <span className="ml-auto h-2.5 w-2.5 rounded-full bg-white" />
          </span>
        </div>
        <figcaption className="px-1 py-1.5 text-[9px] font-medium text-ink">Active Agent Campaign</figcaption>
      </figure>

      {/* Overall Performance gauge — lower left */}
      <figure className="absolute left-[calc(50%-495px)] top-[calc(50%+90px)] w-[104px] animate-float-b rounded-[16px] bg-white/60 p-2.5 text-center shadow-card backdrop-blur-md">
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
        <span className="-mt-4 block text-[15px] font-semibold text-ink">565</span>
      </figure>

      {/* Avatar stack — upper right */}
      <div className="absolute left-[calc(50%+345px)] top-[calc(50%-235px)] flex animate-float-b items-center gap-1.5 rounded-full bg-white/55 p-1.5 pr-2.5 shadow-card backdrop-blur-md">
        <img src="/auth/agent-memoji.png" alt="" className="h-7 w-7 rounded-full bg-ink object-cover" />
        <img src="/auth/ws-avatar-1.jpg" alt="" className="-ml-3 h-7 w-7 rounded-full object-cover ring-2 ring-white" />
        <img src="/auth/ws-avatar-2.jpg" alt="" className="-ml-3 h-7 w-7 rounded-full object-cover ring-2 ring-white" />
        <span className="ml-0.5 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-ink">+5</span>
      </div>

      {/* Autonomous content ideation — lower right */}
      <figure className="absolute left-[calc(50%+360px)] top-[calc(50%+40px)] w-[152px] animate-float-a rounded-[18px] bg-white/55 p-1.5 shadow-card backdrop-blur-md">
        <div className="overflow-hidden rounded-[13px]">
          <img src="/auth/post-genstars.png" alt="" className="h-[128px] w-full object-cover" />
        </div>
        <figcaption className="px-1 py-1.5 text-center text-[9px] font-medium leading-tight text-ink">
          Autonomous
          <br />
          Content ideation
        </figcaption>
      </figure>
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
      <div className="pointer-events-none absolute -left-auth-gutter -right-auth-gutter -top-7 h-[128px]" aria-hidden>
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: 'radial-gradient(rgba(163,65,255,0.85) 1.2px, rgba(163,65,255,0) 1.3px)',
            backgroundSize: '26px 20px',
            WebkitMaskImage: 'linear-gradient(180deg,#000 45%,transparent 100%)',
            maskImage: 'linear-gradient(180deg,#000 45%,transparent 100%)',
          }}
        />
        <div
          className="absolute left-1/2 top-1 h-[96px] w-[96px] -translate-x-1/2 rounded-full opacity-70"
          style={{ background: 'var(--ss-info)', filter: 'blur(34px)' }}
        />
      </div>

      <div className="relative flex flex-col items-center">
        <SparkMark variant="card" size={48} animated />
        <h1 className="mt-3 text-center text-[22px] font-semibold leading-[1.3] text-ink-heading">{title}</h1>
        {subtitle ? <p className="mt-1 text-center text-[13px] text-ink-muted">{subtitle}</p> : null}
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
      {footer ? <div className="px-auth-gutter pb-2 pt-5">{footer}</div> : null}
    </div>
  );
}
