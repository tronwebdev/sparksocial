'use client';

import { Wordmark } from '@/components/brand/Wordmark';

/**
 * The chrome every onboarding step sits in — `Onboarding.dc.html`.
 *
 * The prototype draws each step as its own screen with `STEP 0`…`STEP 5` and a
 * Back control. They are states of one flow rather than six routes, so the
 * chrome lives here and the steps only render their own content.
 *
 * `Back` is the flow's own control, not the browser's. That is the prototype's
 * design and it is also the honest one: step 2 creates a draft genome on the
 * server, so "back" means *revisit an answer*, not "undo what happened". A
 * browser-history flow would imply the second thing.
 */

export interface StepShellProps {
  /** Zero-based, matching the prototype's `STEP 0`…`STEP 5`. */
  step: number;
  total: number;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function StepShell({ step, total, eyebrow, title, subtitle, onBack, children, footer }: StepShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background px-6 py-8 md:px-16">
      <header className="flex items-center justify-between">
        <Wordmark />

        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-[10px] px-4 py-2 text-[16px] text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring"
          >
            Back
          </button>
        ) : (
          // Reserve the space so the wordmark does not shift between steps —
          // a header that jumps on every Continue reads as a page reload.
          <span aria-hidden className="px-4 py-2 text-[16px] opacity-0">Back</span>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center py-10">
        <Progress step={step} total={total} />

        {eyebrow ? <p className="mt-8 text-[16px] text-ink-muted">{eyebrow}</p> : null}

        <h1 className="mt-2 text-[34px] font-semibold leading-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-3 max-w-[560px] text-[18px] text-ink-muted">{subtitle}</p> : null}

        <div className="mt-10">{children}</div>
      </main>

      {footer ? <footer className="mx-auto w-full max-w-[720px] pb-4">{footer}</footer> : null}
    </div>
  );
}

/**
 * Segments rather than a single filled bar.
 *
 * Six discrete answers, so six discrete marks: a continuous bar at 50% invites
 * "how much longer?", which is the question a short form should never provoke.
 * Counting steps answers it exactly.
 */
function Progress({ step, total }: { step: number; total: number }) {
  return (
    <div>
      <div className="flex items-center gap-2" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={total}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-[6px] flex-1 rounded-full transition-colors duration-300 ${
              i <= step ? 'bg-[var(--ss-accent-purple)]' : 'bg-[var(--ss-border)]'
            }`}
          />
        ))}
      </div>
      <p className="mt-3 text-[14px] text-ink-muted">
        Step {step + 1} of {total}
      </p>
    </div>
  );
}
