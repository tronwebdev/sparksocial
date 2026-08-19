'use client';

/**
 * The prototype's amber "Needs Attention" strip (`SparkSocial Command
 * Center.dc.html:83-90`), sourced from `queue.review.list`'s real count
 * rather than the mockup's fixed "one queued post" copy. "Review" scrolls to
 * the queue list below rather than opening a separate route — there is no
 * dedicated Review screen yet, and the queue is already on this page.
 */
export function NeedsAttentionBanner({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3">
      <span className="text-[14px] text-warn">
        <b className="font-semibold">Needs attention:</b> {count} action{count === 1 ? '' : 's'} waiting on your
        approval.
      </span>
      <a href="#review-queue" className="ml-auto text-[14px] font-medium text-ink underline underline-offset-2">
        Review
      </a>
    </div>
  );
}
