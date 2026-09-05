'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChatDrawer } from '@/components/command-center/ChatDrawer';
import { isSparkPinned, onAskSparkOpen } from '@/lib/askSpark';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { NotificationBell } from '@/components/notifications/NotificationBell';

/**
 * The Discovery screen's frame — `SparkSocial Discovery.dc.html`.
 *
 * Full-bleed on the same card as the Calendar and Command Center — 1698 wide at
 * 15,18, radius 30, the same two-gradient wash with `scaleX(-1)` baked into the
 * angles. It was rendering inside `AppShell`'s 322px sidebar under a `TopBar`
 * with a 20px heading, which is a different screen from the one the prototype
 * draws; `(cc)/layout.tsx` is the group that opts out of that frame and its own
 * docstring already named Discovery as belonging there.
 *
 * Unlike the Calendar's, this chrome has no hairline and no view controls — the
 * screen's own controls live inside its one big card:
 *
 *   title      52,44    28px/700 "Trend Discovery"
 *   Back       290,44   92x38 at radius 8, `rgba(255,255,255,.6)` in a
 *                       `rgba(131,131,131,.35)` ring, white on hover
 *   subtitle   52,96    17px/400 `#838383`
 *   orb        1490,36  60px, the same radial blue the Calendar uses at 64
 *   Ask Spark  1560,44  h44 at radius 22, white on a 26px-blur shadow
 *
 * Ask Spark opens `ChatDrawer` — the same drawer the Command Center and the
 * shell's `AskSpark` button open, mounted here because `(cc)` renders no
 * `TopBar` and so nothing else on this route mounts one. It also listens on
 * `onAskSparkOpen`, so a caller anywhere inside the screen reaches this one
 * drawer rather than a second: exactly one `ChatDrawer` exists on /discovery.
 *
 * The button is the design's own orb-and-pill rather than `AskSpark`'s block:
 * that block is a 196x70 speech bubble whose tail overlaps the orb, and this
 * screen draws a plain 60px circle with a separate 22-radius pill beside it.
 */

export function DiscoveryScreenChrome({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { genome } = useSelectedGenome();
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => onAskSparkOpen(() => setChatOpen(true)), []);

  /* A pinned drawer opens with the page — see `AskSpark` on why this is an
     effect rather than the initial state. */
  useEffect(() => {
    if (isSparkPinned()) setChatOpen(true);
  }, []);

  return (
    <div className="min-h-screen bg-white p-[15px] pt-[18px]">
      <div
        className="relative min-h-[calc(100vh-36px)] overflow-hidden rounded-[30px]"
        style={{
          background:
            'linear-gradient(-151.005deg, rgba(245,107,255,0.2) 3.02%, rgba(255,255,255,0) 63.11%), linear-gradient(-210.896deg, rgba(108,232,255,0.3) 3.17%, rgba(255,255,255,0) 67.52%), #F7F7F7',
        }}
      >
        {/*
          The header is two rows in one band: the title with Back beside it, and
          the subtitle under. 52 and 290 on the stage are 37 and 275 inside the
          card, which starts at 15.
        */}
        <div className="relative px-[17px] pt-[26px] sm:px-[37px]">
          {/*
            `items-start`, not `items-center`: the 60px orb was the tallest
            child of this row, so centring dropped the 36px title 13px and the
            subtitle 26px — the whole card with them. In the design the orb is
            *layered* over the header band (it runs 36..96, straight through the
            subtitle's line at 96), which a flex row cannot express. It is
            absolutely positioned below instead, and the row is left with the
            title and Back, both of which the design puts at y=44.

            `leading-[1.286]` because the prototype's span is 28px at the
            browser default line-height — a 36px box, not the 33.6 that
            `leading-[1.2]` gives.
          */}
          <div className="flex flex-wrap items-start gap-[18px]">
            <h1 className="text-[28px] font-bold leading-[1.286] text-ink">{title}</h1>

            <Link
              href="/home"
              className="flex h-[38px] w-[92px] items-center justify-center gap-[11px] rounded-lg text-16 font-medium transition-colors hover:bg-white"
              style={{
                background: 'rgba(255,255,255,0.6)',
                boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)',
                color: '#5B5B5B',
              }}
            >
              <svg width="8" height="15" viewBox="0 0 8 16" fill="none" aria-hidden>
                <path d="M7 1 1 8l6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </Link>

            {/* The orb and the pill are one thought — a face, then what it
                offers. 1490..1550 and 1560..1677.9 on the stage, both centred
                on y=66; the card's right edge is 1713, so the pair sits 35 in
                from it. Hidden under `xl`, where the row cannot hold them. */}
            <div className="absolute right-[35px] top-[18px] hidden items-center gap-[10px] xl:flex">
              {/* This screen draws its own orb-and-pill rather than the shell's
                  `AskSpark` block, so the bell that rides along with that block
                  has to be placed here explicitly. Same component. */}
              <NotificationBell compact />
              <span
                aria-hidden
                className="relative block h-[60px] w-[60px] shrink-0 rounded-full"
                style={{
                  background: 'radial-gradient(circle at 50% 42%, #D6F1FF 0%, #A6D8FF 60%, #8FC8FF 100%)',
                  boxShadow: '0 8px 22px -10px rgba(36,116,237,0.5)',
                }}
              >
                <span className="absolute left-[17px] top-[25px] block h-[8px] w-[8px] rounded-full bg-white" />
                <span className="absolute left-[35px] top-[25px] block h-[8px] w-[8px] rounded-full bg-white" />
              </span>

              <button
                type="button"
                onClick={() => setChatOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={chatOpen}
                className="flex h-[44px] items-center rounded-[22px] bg-white px-[19px] text-15 font-semibold text-ink transition-shadow"
                style={{ boxShadow: '0 10px 26px -14px rgba(12,12,12,0.3)' }}
              >
                Ask Spark?
              </button>
            </div>
          </div>

          {/* 96 on the stage — 78 inside the card. The row above is 38 tall
              (Back, not the 36px title), so 26+38+14 lands it. */}
          <p className="mt-[14px] text-[17px] font-normal leading-[21px] text-ink-muted">{subtitle}</p>
        </div>

        {/* The card is at 48,140 — 33 in, and 23 under the subtitle's 21px line. */}
        <div className="px-[17px] pb-10 pt-[23px] sm:px-[33px]">{children}</div>
      </div>

      <ChatDrawer
        genomeId={genome?.genomeId}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onOpenDraft={(contentItemId) => {
          // Close first: the drawer is fixed-position, so leaving it mounted
          // across the route change animates it in again over the new page.
          setChatOpen(false);
          router.push(`/agents?draft=${encodeURIComponent(contentItemId)}`);
        }}
      />
    </div>
  );
}
