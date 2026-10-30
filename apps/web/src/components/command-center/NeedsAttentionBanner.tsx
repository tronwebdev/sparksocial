'use client';

import { SparkMark } from '@/components/brand/SparkMark';
/**
 * The amber "Needs Attention" strip — `SparkSocial Command Center.dc.html`, the
 * band at 831,147.
 *
 * 849×51.5 at radius 15.6 on `#FFF0DC` inside an `inset 0 0 0 1.04px #FFB453`
 * ring: a shield glyph at 9.2,14.5, the sentence at 38.3,14.6 in 16.65px/1.28
 * with "Needs Attention:" bold, then "Review" at 733.5 and a 22.9px ringed
 * chevron at 800.
 *
 * ── What it looked like before ────────────────────────────────────────────
 *
 * `rounded-xl border border-warn/40 bg-warn/10` at 14px. The ramp's `--ss-warn`
 * is `#E48915`, so the *text* was right, but a 10%-alpha wash of it is not
 * `#FFF0DC` and a 40% border is not `#FFB453` — the design's two ambers are
 * their own pair, warmer and more opaque than anything the warn ramp produces.
 * They are tokens now (`--ss-cc-attn-bg` / `--ss-cc-attn-ring`) rather than
 * literals here.
 *
 * ── The count is real; the design's copy is not ───────────────────────────
 *
 * The prototype hardcodes "Approval required for one queued post - campaign
 * ending in 2 days". The count comes from `queue.review.list`, so this says how
 * many things are actually waiting. The second clause is dropped rather than
 * invented: nothing here knows when the campaign ends, and the strip is the one
 * element on the screen whose whole job is to be trusted.
 *
 * "Review" opens the **Needs Attention** screen (`?attention=1`).
 *
 * It was `href="#review-queue"` — an anchor to the review queue that used to
 * sit on the Overview tab. That queue has moved to the Needs Attention screen,
 * so the anchor pointed at an element that no longer exists and the link did
 * nothing. `href` rather than a callback because it is a link to a URL state,
 * and a URL is worth having here: it makes "the thing waiting on me" something
 * you can send to a colleague.
 */
export function NeedsAttentionBanner({ count, href = '?attention=1' }: { count: number; href?: string }) {
  return (
    <div
      className="relative flex h-[51.5px] items-center rounded-[15.6px] bg-attn pl-[9.2px] pr-[13.5px]"
      style={{ boxShadow: 'inset 0 0 0 1.04px var(--ss-cc-attn-ring)' }}
    >
      {/* SPARK in its "needs you" mood — wide eyes and a "!" — where the
          diamond icon was. It overhangs the strip a little, as the design's
          orb beside the Automation banner does. */}
      <span className="-my-[10px] -ml-[2px] block shrink-0">
        <SparkMark size={40} mood="warning" decorative />
      </span>

      <span className="ml-[7.2px] min-w-0 truncate text-17 leading-[1.28] text-warn">
        <b className="font-bold">Needs Attention:</b>{' '}
        <span className="font-medium">
          {count === 1 ? 'Approval required for one queued post' : `Approval required for ${count} queued posts`}
        </span>
      </span>

      {/* Right-anchored rather than pinned to 733.5/800: the strip is 849 in the
          design and fluid here, and both controls hang off its right edge. */}
      <a
        href={href}
        className="ml-auto flex shrink-0 items-center gap-[10.5px] text-17 font-normal text-ink"
      >
        Review
        <span
          aria-hidden
          className="flex h-[22.9px] w-[22.9px] items-center justify-center rounded-full"
          style={{ boxShadow: 'inset 0 0 0 0.8px #0C0C0C' }}
        >
          <svg width="5" height="9" viewBox="0 0 5 9" fill="none">
            <path d="m1 1 3 3.5L1 8" stroke="#0C0C0C" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </a>
    </div>
  );
}
