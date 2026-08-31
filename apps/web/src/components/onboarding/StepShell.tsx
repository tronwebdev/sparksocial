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
  /**
   * Which of the four groups this screen belongs to — `F6`.
   *
   * The prototype counts **four** steps and the build counted every screen, so a
   * flow with three routing questions announced itself as "Step 7 of 9" where
   * the design says "Step 2 of 4". That is the whole of F6's "the build feels
   * twice as long as the design": the screens are the screens, and the number at
   * the top was the thing making them feel endless.
   */
  group: 1 | 2 | 3 | 4;
  /** Position within the group, so "how much longer" is still answerable. */
  within?: { index: number; total: number };
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** The four the prototype names, in its own words. */
const GROUP_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Brand identity',
  2: 'Brand knowledge',
  3: 'Brand kit',
  4: 'Your agent',
};

export function StepShell({ group, within, eyebrow, title, subtitle, onBack, children, footer }: StepShellProps) {
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
        <Progress group={group} within={within} />

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
 * Four segments, one per group, with the group's own progress inside its segment.
 *
 * This used to be one segment per screen. That is a defensible design for six
 * screens and a bad one for eleven, and the count is not fixed: the flow's length
 * depends on how much of the brand the crawl managed to infer, so the same
 * product told one owner "Step 4 of 7" and another "Step 4 of 10". Four is the
 * number the design commits to and the number that stays true.
 *
 * The part-filled current segment is what keeps the finer answer available. A bar
 * that only moved once per group would sit still through four screens of brand
 * knowledge, which reads as a form that is not registering answers.
 */
function Progress({ group, within }: { group: 1 | 2 | 3 | 4; within?: { index: number; total: number } }) {
  // Position inside the current group, 0–1. Without a `within` the segment is
  // simply full, which is right for a group that is one screen.
  const partial = within && within.total > 1 ? (within.index + 1) / within.total : 1;

  return (
    <div>
      <div
        className="flex items-center gap-2"
        role="progressbar"
        aria-valuenow={group}
        aria-valuemin={1}
        aria-valuemax={4}
        aria-valuetext={`${GROUP_LABELS[group]}, step ${group} of 4`}
      >
        {([1, 2, 3, 4] as const).map((g) => (
          <span key={g} className="h-[6px] flex-1 overflow-hidden rounded-full bg-[var(--ss-border)]">
            <span
              className="block h-full rounded-full bg-[var(--ss-accent-purple)] transition-[width] duration-300"
              style={{ width: g < group ? '100%' : g === group ? `${Math.round(partial * 100)}%` : '0%' }}
            />
          </span>
        ))}
      </div>
      <p className="mt-3 text-[14px] text-ink-muted">
        Step {group} of 4 · {GROUP_LABELS[group]}
      </p>
    </div>
  );
}
