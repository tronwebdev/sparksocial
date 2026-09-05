'use client';

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
      <span className="block h-[21.8px] w-[21.9px] shrink-0" aria-hidden>
        <svg width="21.9" height="21.8" viewBox="0 0 22 22" fill="none">
          <path
            d="M13.9 1.1C13 .4 12 0 10.9 0 9.9 0 8.8.4 7.9 1.1 5.4 3.2 3.1 5.5 1.1 8c-1.5 1.8-1.4 4-.1 5.8 2.1 2.6 4.4 5 7 7 1.8 1.4 4 1.4 5.8 0 2.6-2 4.9-4.4 7-6.9 1.4-1.8 1.4-4.1 0-5.9-2-2.5-4.3-4.9-6.9-6.9Z"
            fill="rgba(230,167,81,0.3)"
          />
          <path d="M10.9 5.5v6.2M10.9 15.4v.6" stroke="#E6A751" strokeWidth="2.3" strokeLinecap="round" />
        </svg>
      </span>

      <span className="ml-[7.2px] min-w-0 truncate text-[16.65px] leading-[1.28] text-warn">
        <b className="font-bold">Needs Attention:</b>{' '}
        <span className="font-medium">
          {count === 1 ? 'Approval required for one queued post' : `Approval required for ${count} queued posts`}
        </span>
      </span>

      {/* Right-anchored rather than pinned to 733.5/800: the strip is 849 in the
          design and fluid here, and both controls hang off its right edge. */}
      <a
        href={href}
        className="ml-auto flex shrink-0 items-center gap-[10.5px] text-[16.65px] font-normal text-ink"
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
