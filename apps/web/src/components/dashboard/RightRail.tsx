'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyCard } from '@/components/common/EmptyCard';
import { postKindLabel } from '@/lib/platforms';
import { PlatformIcon } from '@/components/common/PlatformIcon';
import { relativeTime } from '@/lib/relativeTime';
import type { RankedTrend, UpcomingPost } from './types';

/**
 * The dashboard's right rail — card 4 on `SparkSocial Dashboard.dc.html`,
 * 446×1019 at radius 15.
 *
 * It is two panels behind a segmented control, not one list. `TrendingRail`
 * rendered only the trends, under a header with a "Trending topics" title — so
 * the published-posts half of the rail did not exist, and the control that
 * switches between them did not either. The track is 427×63 at radius 10 on
 * `#EAEAEA` with a 196×47 white thumb that slides between x=10 and x=221 over
 * 0.25s, which is the prototype's own transition.
 *
 * ── What each half can honestly show ──────────────────────────────────────
 *
 * The prototype's trend card carries eight things. `trend.rank` returns five
 * fields — `trendId`, `topic`, `score`, `opportunity`, `relevance` — so four of
 * the eight have nothing behind them:
 *
 *   category chip     no category on a ranked trend. Omitted.
 *   "+240%"           `score` is not a week-over-week change. The slot takes
 *                     `opportunity` instead, under its real label.
 *   sparkline         no time series per trend. Omitted.
 *   "48.2k posts"     no volume. The slot takes `relevance`, which is the
 *                     number that actually decides whether this brand should
 *                     touch the trend at all.
 *
 * Inventing a percentage next to a real topic name is worse than a shorter
 * card: the fake number is the one a person would act on.
 *
 * The published half has a harder gap. Its cards are mostly media — a 201×201
 * still or three carousel tiles — and `content.list` returns `mediaType` but no
 * URL (see `packages/generate/src/list.ts`). So the media well says what kind of
 * media the post is rather than showing a photograph that is not the post's own.
 * A `mediaUrl` on `ContentListItem` is the one field that would close it.
 */

const VISIBLE_TRENDS = 5;
const VISIBLE_POSTS = 3;

type Seg = 'published' | 'trending';

/**
 * Track geometry, straight off the prototype — but as the *relationships* the
 * design's numbers encode, not the numbers themselves.
 *
 * The prototype measures a 427px track holding two 196px thumbs at x=10 and
 * x=221, inside a 446px card. Ported literally that became `maxWidth: 427`, and
 * 427 is not a width the design chose: it is `446 − 9 − 10`, the card minus its
 * own padding. So on any window wider than 1728 the rail card grew and the track
 * stopped dead at 427 — at 2185px the card is 602 wide and the control floated
 * with a 167px gap to its right, which is exactly "does not fill the card".
 *
 * Solving the design's own arithmetic for a track of any width:
 *
 *   end insets     10 + 10   the thumb's gap to each end of the track
 *   centre gap          15   between the two thumbs (206 → 221)
 *   thumb        (100% − 35) / 2      = 196 at 427 ✓
 *   trending x   100% − 10 − thumb
 *                = 50% + 7.5px        = 221 at 427 ✓
 *
 * The labels hang off the same anchors — 15px into the first thumb, 19px into
 * the second — so they travel with it instead of being pinned to 25 and 240.
 */
const THUMB_W = 'calc((100% - 35px) / 2)';
const THUMB_X = { published: '10px', trending: 'calc(50% + 7.5px)' } as const;
/** 10 + 15, and (50% + 7.5) + 19 — each label's offset inside its own thumb. */
const LABEL_X = { published: '25px', trending: 'calc(50% + 26.5px)' } as const;

export function RightRail({
  trends,
  published,
}: {
  trends: RankedTrend[] | null;
  /** Null while loading; the prototype has no empty state for this half. */
  published: UpcomingPost[] | null;
}) {
  const [seg, setSeg] = useState<Seg>('published');

  return (
    <section className="overflow-hidden rounded-lg bg-white">
      {/* ── the segmented control ───────────────────────────────────────── */}
      {/* 9 left, 10 right — the card's own asymmetric padding in the design. */}
      <div className="pl-[9px] pr-[10px] pt-[10px]">
        <div
          role="tablist"
          aria-label="Right rail panels"
          className="relative h-[63px] rounded bg-seg-track"
        >
          <span
            aria-hidden
            className="absolute top-[8px] h-[47px] rounded-[10px] bg-white transition-[left] duration-[250ms] motion-reduce:transition-none"
            style={{
              left: THUMB_X[seg],
              width: THUMB_W,
              /* The prototype's own easing on this control. */
              transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />

          <button
            role="tab"
            type="button"
            aria-selected={seg === 'published'}
            onClick={() => setSeg('published')}
            className="absolute top-[21px] flex h-[23px] items-center gap-2.5 bg-transparent"
            style={{ left: LABEL_X.published }}
          >
            {/* A paper plane, not a tick. The tick was mine and it reads as
                "done"; the design's glyph is the send icon, which is what
                publishing a post is. */}
            <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M18 2 2 8.6l6.4 2.4L18 2Z"
                stroke={seg === 'published' ? '#000000' : '#838383'}
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M18 2 8.4 11l1.2 6.6L18 2Z"
                stroke={seg === 'published' ? '#000000' : '#838383'}
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="whitespace-nowrap text-18 font-medium leading-none"
              style={{ color: seg === 'published' ? '#000000' : '#838383' }}
            >
              Post published
            </span>
          </button>

          <button
            role="tab"
            type="button"
            aria-selected={seg === 'trending'}
            onClick={() => setSeg('trending')}
            className="absolute top-[15px] flex h-[29px] items-center gap-0.5 bg-transparent"
            style={{ left: LABEL_X.trending }}
          >
            <img src="/dashboard/fire.png" alt="" width={27} height={27} className="block object-cover" />
            <span
              className="whitespace-nowrap text-18 font-medium leading-none"
              style={{ color: seg === 'trending' ? '#000000' : '#838383' }}
            >
              Trending Topics
            </span>
          </button>
        </div>
      </div>

      {/* ── panels ──────────────────────────────────────────────────────── */}
      <div className="px-[19px] pb-[19px] pt-[25px]">
        {seg === 'published' ? <Published posts={published} /> : <Trending trends={trends} />}
      </div>
    </section>
  );
}

/* ── Published ─────────────────────────────────────────────────────────── */

/** The prototype's card fill, shared by both halves at different alphas. */
function Published({ posts }: { posts: UpcomingPost[] | null }) {
  if (posts === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-[220px] w-full rounded-[36.34px]" />
        <Skeleton className="h-[220px] w-full rounded-[36.34px]" />
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <EmptyCard
        narrow
        glyph="plane"
        body={<>Create your first campaign to get started and see all published post.</>}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-5">
      {posts.slice(0, VISIBLE_POSTS).map((p) => (
        <li key={p.contentItemId}>
          <article className="relative overflow-hidden rounded-[36.34px] bg-post-card">
            <div className="flex items-center gap-2 px-[20.8px] pt-[13.6px]">
              {/* 31.4px frosted well holding the platform's own mark — the
                  design's, now that `public/icons` exists. It was the first two
                  letters of the enum ("IN", "X"). */}
              <span
                className="flex h-[31.4px] w-[31.4px] shrink-0 items-center justify-center rounded-full"
                style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(7.85px)' }}
              >
                <PlatformIcon platform={p.platform} size={22} />
              </span>
              {/*
                What the post is, not which playbook made it.

                The design's three titles are "Instagram post", "Carousel" and
                "X Post" - the platform and the kind. `playbookName` is the
                strategy that produced it, an internal label a reader of this
                rail has no use for, and it rendered here in the design's slot.
                Both fields are already on the row; this is the one the design
                shows.
              */}
              <span className="min-w-0 flex-1 truncate text-[16.28px] font-medium leading-[1.28] text-ink-muted">
                {postKindLabel(p.platform, p.mediaType)}
              </span>
              <Link
                href={`/agents?draft=${encodeURIComponent(p.contentItemId)}`}
                aria-label={`Open ${postKindLabel(p.platform, p.mediaType)}`}
                className="flex h-[36.2px] w-[36.2px] shrink-0 items-center justify-center rounded-full"
                style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(9.05px)' }}
              >
                <svg width="13" height="13" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path
                    d="M1 9 9 1M9 1H3M9 1v6"
                    stroke="#0C0C0C"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            </div>

            <div className="flex items-center gap-2 px-[25.3px] pt-[10px] text-[12.72px] text-ink-muted">
              <span>{p.scheduledAt ? relativeTime(p.scheduledAt) : 'Published'}</span>
              {p.mediaType ? (
                <>
                  <span aria-hidden className="block h-[4.1px] w-[4.1px] rounded-full bg-current" />
                  <span>{p.mediaType}</span>
                </>
              ) : null}
            </div>

            {/*
              The media well. `content.list` has no URL for the post's own image,
              so this names the media rather than borrowing a picture — see the
              header. Same 201px square the prototype uses for a single still.
            */}
            <div className="flex justify-center px-[20px] pt-[14px]">
              <div
                className="flex h-[201px] w-[201px] items-center justify-center rounded-[17.74px] text-14 text-ink-muted"
                style={{ boxShadow: 'inset 0 0 0 0.58px rgba(12,12,12,0.2)' }}
              >
                {p.mediaType && p.mediaType !== 'text' ? `${p.mediaType} — no preview` : 'Text post'}
              </div>
            </div>

            {/* 90px footer, radius 18.09 on top and 36.34 at the card's corners. */}
            <div
              className="mt-[14px] px-[25.3px] py-[10px]"
              style={{
                background: 'rgba(255,255,255,0.4)',
                backdropFilter: 'blur(30px)',
                borderRadius: '18.09px 18.09px 36.34px 36.34px',
              }}
            >
              {/*
                The design's footer is the post's own headline over two lines of
                its body copy. This printed `playbookName` as the headline, so
                the internal strategy name sat where the post's title goes - "p"
                in a fixture, "proof-of-work carousel" in production.

                `content.list` returns one piece of prose per item (`summary`),
                not a title and a body, so the headline is the summary and the
                second line is simply absent. A `title` (or `bodyText`) on
                `ContentListItem` is what would fill it; inventing a headline by
                truncating the summary and then repeating it underneath would
                fill the space without adding anything to read.
              */}
              <p className="line-clamp-2 max-w-[299.5px] text-[16.28px] font-medium leading-[1.28] text-black">
                {p.summary}
              </p>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

/* ── Trending ──────────────────────────────────────────────────────────── */

function Trending({ trends }: { trends: RankedTrend[] | null }) {
  if (trends === null) {
    return (
      <div className="flex flex-col gap-[18px]">
        <Skeleton className="h-[160px] w-full rounded-[24px]" />
        <Skeleton className="h-[160px] w-full rounded-[24px]" />
        <Skeleton className="h-[160px] w-full rounded-[24px]" />
      </div>
    );
  }

  if (trends.length === 0) {
    /*
      Not the shared empty card. This one is empty for a different reason from
      every other card on the screen: there *are* trends, and none of them is
      one this brand can credibly speak to. "Create a campaign" would not change
      that, so offering it here would be the wrong instruction.
    */
    return (
      <p className="px-1 py-6 text-[15px] leading-[1.5] text-ink-muted">
        Nothing worth joining right now. SPARK skips trends this brand cannot credibly speak to, and
        says why on each one in Discovery.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-[18px]">
      {trends.slice(0, VISIBLE_TRENDS).map((t) => (
        <li key={t.trendId}>
          {/* 408×160 at radius 24 on the same gradient at a lower alpha. */}
          <article
            className="relative min-h-[160px] rounded-[24px] p-[20px]"
            style={{
              background:
                'linear-gradient(218.668deg, rgba(131,131,131,0.10) 7.52%, rgba(12,12,12,0.09) 92.4%)',
            }}
          >
            <span
              className="absolute left-[20px] top-[20px] flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)' }}
            >
              <img src="/dashboard/fire.png" alt="" width={22} height={22} className="block object-cover" />
            </span>

            <p className="ml-[52px] text-[19px] font-semibold leading-tight text-ink">{t.topic}</p>

            {/*
              Where the prototype puts "+240% / vs last week". `opportunity` is
              how much of the window is left to join, which is a real number
              from the same tool and the one that decides whether it is worth
              acting on today.
            */}
            <div className="absolute right-[20px] top-[22px] text-right">
              <span className="text-16 font-semibold" style={{ color: '#0E9E0C' }}>
                {Math.round(t.opportunity * 100)}%
              </span>
              <p className="mt-[9px] text-[12px] text-ink-muted">left to join</p>
            </div>

            {/* Where "48.2k posts" goes. Relevance, which is the real gate. */}
            <p className="ml-[52px] mt-[14px] text-14 text-ink-muted">
              {Math.round(t.relevance * 100)}% relevant to this brand
            </p>

            <Link
              href="/discovery"
              className="absolute bottom-[18px] right-[20px] flex h-9 items-center gap-[7px] rounded-[10px] px-4 text-14 font-semibold"
              style={{ background: 'rgba(163,65,255,0.1)', boxShadow: 'inset 0 0 0 1px #A341FF', color: '#A341FF' }}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Create post
            </Link>
          </article>
        </li>
      ))}
    </ul>
  );
}
