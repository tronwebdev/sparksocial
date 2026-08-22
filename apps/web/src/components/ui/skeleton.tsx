import { cn } from '@/lib/utils';

/**
 * A loading placeholder shaped like the thing that is loading.
 *
 * ── Why this exists rather than another spinner ───────────────────────────
 *
 * The fidelity pass found `ss-shimmer` among ten keyframes the prototypes define
 * and the build had not implemented, and it was the consequential one: with no
 * skeleton treatment every load in the product is a spinner. That is the
 * complaint M10 files against the draft panel's 25-second generation, except it
 * was never confined to the draft panel — a settings panel fetching one read
 * shows the same dead centred dot.
 *
 * A skeleton says two things a spinner cannot: roughly how much is coming, and
 * that the page has not simply stopped.
 *
 * ── Accessibility, since a shimmer is invisible to a screen reader ────────
 *
 * The block itself is `aria-hidden` — it is decoration standing in for content.
 * The region that owns it is expected to carry `aria-busy`, which is what
 * actually announces "still loading" rather than announcing nothing and then
 * silently filling in.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-shimmer rounded-md bg-surface-muted', className)}
    />
  );
}

/**
 * The shape a settings panel loads into: a couple of lines of prose and a grid.
 *
 * Kept beside `Skeleton` rather than inside each panel because six panels load
 * the same shape, and six hand-built placeholders would drift apart — at which
 * point the shimmer stops reading as one system and starts reading as six
 * near-misses.
 */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mt-5 flex flex-col gap-4">
      <Skeleton className="h-3.5 w-2/5" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: rows * 2 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-4/5" />
            {/* A second short line on alternating cards, so the block does not
                read as a printed grid of identical boxes. */}
            {i % 2 === 0 ? <Skeleton className="h-2.5 w-3/5" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
