'use client';

import { cn } from '@/lib/utils';
import { SparkMark } from '@/components/brand/SparkMark';

/**
 * The chrome every onboarding step sits in — built to the nine captures in
 * `ui_screenshot/` (frame 1440×930, scale 0.8576 on `…193114`).
 *
 * ── What the captures changed ────────────────────────────────────────────
 *
 * The previous chrome was a wordmark on the left, a Back link on the right, and
 * four separate progress segments above a left-aligned heading. The design is a
 * three-part top bar — Back pill · (step label + one gradient bar) · Continue
 * pill — over a centred column, with the step's prompt spoken by an assistant
 * bubble rather than set as a page heading.
 *
 * Measured:
 *
 *   page padding-x   126      Back starts at 126, Continue ends at 1317
 *   Back pill        126→222  (96 wide), y 40→82
 *   Continue pill    1202→1317 (115 wide), same row
 *   progress bar     353→1091 (738 wide), y 70→81.5, ~12 tall, fully rounded
 *   content column   750      353→1103
 *   bubble           y 172→300
 *
 * The bar's gradient spans the **fill**, not the track, so it compresses as the
 * bar fills instead of revealing more of a fixed ramp — confirmed by the step-2
 * capture showing the whole cyan→peach ramp inside its half-width fill, and the
 * step-4 capture showing the same ramp across the full width. `Step 2 of 4` puts
 * the boundary at x=722, which is 50.0% of 353→1091 — so the fill is
 * `group / 4`, not `(group − 1) / 4` or anything finer.
 *
 * ── Why the group count survives ─────────────────────────────────────────
 *
 * The flow has more screens than the design has steps: three routing questions,
 * a chip review, a docs upload. Counting screens made a four-step design
 * announce "Step 7 of 10". `group` is which of the design's four a screen
 * belongs to; `within` is kept only so a caller can still express position, but
 * it no longer moves the bar — the capture is unambiguous that the bar is at
 * exactly 2/4 on a step-2 screen.
 */

export interface StepShellProps {
  /** Which of the design's four steps this screen belongs to. */
  group: 1 | 2 | 3 | 4;
  /** Position within the group. Retained for callers; does not move the bar. */
  within?: { index: number; total: number };
  /** The grey lead-in sentence in the assistant bubble. */
  eyebrow?: React.ReactNode;
  /**
   * The purple question. Optional: some screens speak only the grey lead-in.
   * The brand-kit capture's bubble is one paragraph with bold spans and no
   * question at all, because its prompt row lives below the bubble alongside the
   * preset toggle.
   */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  onBack?: () => void;
  onContinue?: () => void;
  /** `Finish` on the last step, per `…193231`. */
  continueLabel?: string;
  continueDisabled?: boolean;
  children?: React.ReactNode;
  /**
   * Renders `children` INSIDE the assistant's white container rather than below
   * it. Four of the six step screens do this — the bubble simply widens into a
   * card holding the form. Every card in the captures starts at the same x as
   * the bubble (491-497 against the bubble's 492), which is what gives it away:
   * it is not a card under a bubble, it is the bubble.
   */
  inBubble?: boolean;
  /**
   * The container's width. The captures vary it per step — 467 for a plain
   * prompt, 493 brand details, 469 docs, 596 brand kit, 436 agent — so it is a
   * per-screen number rather than a constant.
   */
  bubbleWidth?: number;
  /**
   * Bottom-anchored content — the chat-style composer on the two prompt screens,
   * which sits low in the frame rather than directly under the bubble.
   */
  composer?: React.ReactNode;
  footer?: React.ReactNode;
}

export function StepShell({
  group,
  eyebrow,
  title,
  subtitle,
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled,
  children,
  inBubble = false,
  bubbleWidth = 467,
  composer,
  footer,
}: StepShellProps) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[--ss-surface-200] px-[126px] py-10 max-xl:px-10 max-md:px-5">
      <img
        src="/auth/bg-onboarding.svg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />

      {/* `relative` + an absolutely-centred middle column: the capture centres the
          bar on the frame (722 of 1440), not between the two pills, which would put
          it at 710 and drift further as either pill changes width. */}
      <header className="relative flex items-start justify-between gap-6">
        {/* Reserve the pill's width even when there is nothing to go back to,
            so the centre column does not shift between steps. */}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex h-[42px] w-24 items-center justify-center gap-2 rounded-full border border-border bg-white/70 text-16 text-ink backdrop-blur-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring"
          >
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
              <path d="M6 1 1 6l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
        ) : (
          <span aria-hidden className="h-[42px] w-24 shrink-0" />
        )}

        <div className="absolute left-1/2 flex w-[738px] max-w-full -translate-x-1/2 flex-col items-center">
          <p className="text-16 text-ink-muted">
            <span className="font-semibold text-ink">Step {group}</span> of 4
          </p>
          <div
            className="mt-[14px] h-3 w-full overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuenow={group}
            aria-valuemin={1}
            aria-valuemax={4}
            aria-valuetext={`Step ${group} of 4`}
          >
            <div
              className="h-full rounded-full bg-progress-wash transition-[width] duration-300"
              style={{ width: `${(group / 4) * 100}%` }}
            />
          </div>
        </div>

        {onContinue ? (
          <button
            type="button"
            onClick={onContinue}
            disabled={continueDisabled}
            className="flex h-[42px] min-w-[115px] items-center justify-center gap-2 rounded-full border border-transparent px-4 text-16 text-ink transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring"
            style={{
              backgroundImage:
                'linear-gradient(var(--ss-surface-200), var(--ss-surface-200)), var(--ss-grad-brand)',
              backgroundOrigin: 'padding-box, border-box',
              backgroundClip: 'padding-box, border-box',
            }}
          >
            {continueLabel}
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
              <path d="m1 1 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span aria-hidden className="h-[42px] w-24 shrink-0" />
        )}
      </header>

      <main className="relative mx-auto flex w-[750px] max-w-full flex-1 flex-col pt-[81px]">
        <Assistant eyebrow={eyebrow} title={title} subtitle={subtitle} width={bubbleWidth}>
          {inBubble ? children : null}
        </Assistant>
        {!inBubble && children ? <div className="mt-8">{children}</div> : null}
        {composer ? <div className="mt-auto pb-[calc(930px-592px-40px)] max-md:pb-10">{composer}</div> : null}
      </main>

      {footer ? <footer className="relative mx-auto w-[750px] max-w-full pb-4">{footer}</footer> : null}
    </div>
  );
}

/**
 * The orb and its speech bubble.
 *
 * The prompt is spoken, not titled: every step in the captures puts its question
 * in a white bubble beside the mark, with the lead-in in grey and the question
 * itself in `--ss-accent-purple`. The bubble has a tail pointing at the orb —
 * drawn as a rotated square rather than a border triangle so it inherits the
 * bubble's own fill and stays correct if that fill ever changes.
 */
function Assistant({
  eyebrow,
  title,
  subtitle,
  width,
  children,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  width: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-[43px]">
      <SparkMark variant="card" size={96} animated className="shrink-0" />

      <div
        className={cn('relative mt-[9px] max-w-full rounded-2xl bg-white px-6 py-[26px] shadow-card')}
        style={{ width }}
      >
        <span
          aria-hidden
          className="absolute -left-[7px] top-8 h-[14px] w-[14px] rotate-45 bg-white"
        />
        {eyebrow ? <p className="relative text-18 leading-[1.45] text-ink-muted">{eyebrow}</p> : null}
        {title ? (
          <p className={cn('relative text-18 font-medium text-brand-purple', eyebrow && 'mt-2')}>{title}</p>
        ) : null}
        {subtitle ? <p className="relative mt-2 text-14 leading-[1.5] text-ink-muted">{subtitle}</p> : null}
        {children ? <div className="relative mt-5">{children}</div> : null}
      </div>
    </div>
  );
}
