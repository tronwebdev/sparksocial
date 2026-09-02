'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChatDrawer } from '@/components/command-center/ChatDrawer';
import { onAskSparkOpen } from '@/lib/askSpark';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { SparkMark } from '@/components/brand/SparkMark';
import { cn } from '@/lib/utils';

/**
 * ASK SPARK, from anywhere — `F2`.
 *
 * The fidelity pass got the count right and the place wrong. A persistent
 * assistant affordance appears in **48 of the 61 prototypes** — that part holds
 * — but not one of them puts it in the sidebar. Measured across every file, the
 * block is 196×70 at left 1484–1503, top 30–34: the header's top-right corner,
 * on Dashboard, Command Center, Assets, Discovery and every Settings screen. The
 * `left:102px` I read as a sidebar coordinate is the label's offset *inside* that
 * block.
 *
 * So it renders as the header control it is: the Spark orb at 70.2px with a
 * white speech bubble beside it reading "Ask Spark?" in 14px/600, the bubble
 * tail pointing back at the orb — the same notch shape the onboarding assistant
 * uses. The orb is `SparkMark`, i.e. the project logo, unchanged.
 *
 * The capability was never missing — `ChatDrawer` runs the agent perfectly well
 * — it was reachable from exactly one screen out of nineteen.
 *
 * The backlog filed it once, inside M1, as a detail of `/home`. That is the
 * mis-shaped version of the finding: closing M1 as written would have put a
 * button on the dashboard and left the other forty-seven screens without one.
 * It belongs in the shell, which is why it lives here.
 *
 * ── Why it hides on `/agents`, and the trap in that ───────────────────────
 *
 * `/agents` renders `CommandCenterOverview`, which already owns a `ChatDrawer`
 * wired to its own draft panel so you can edit while chatting. A second drawer
 * from the shell would put two independent conversations one keystroke apart,
 * each unaware of the other, so the shell defers there.
 *
 * The trap this used to describe: the screen *titled* "Agent Command Center" is
 * at `/agents`, while the engagement inbox was at `/command-center` — M2's naming
 * collision. This component first suppressed itself on `/command-center`, which
 * was precisely backwards: it hid Ask Spark on the inbox, which has no chat and
 * needs it, and doubled it on the one screen that already had one.
 *
 * M2 is closed — the inbox is at `/engagement` now, matching the nav item that
 * has always pointed at it, so exactly one thing in the app is called a command
 * center and it is the screen this defers to. The suppression below is keyed on
 * `/agents` because that is where the other drawer is, which is now the only
 * reading of it.
 *
 * ── The draft handoff ─────────────────────────────────────────────────────
 *
 * A conversation can produce a draft, and `/agents`' own drawer opens it in
 * place. From anywhere else there is no draft panel to open, so this navigates
 * to `/agents?draft=<id>` — which required teaching that screen to read the
 * parameter. Worth it beyond this button: the draft panel is now addressable, so
 * a link in a notification or a bug report can point at one.
 */
export function AskSpark() {
  const pathname = usePathname();
  const router = useRouter();
  const { genome } = useSelectedGenome();
  const [open, setOpen] = useState(false);

  /**
   * The cockpit's header lists Ask Spark as a primary action, and it opens *this*
   * drawer rather than mounting its own — see `lib/askSpark.ts` on why a second
   * `ChatDrawer` would be the wrong fix.
   *
   * Registered before the `/agents` early return would matter, because hooks
   * cannot be conditional. On that route the component returns null and never
   * renders a drawer, so the listener sets a flag nothing reads — harmless, and
   * cheaper than the alternative of hoisting the whole drawer.
   */
  useEffect(() => onAskSparkOpen(() => setOpen(true)), []);

  // `/agents` brings its own drawer. Not `/engagement` — see the header.
  if (pathname.startsWith('/agents')) return null;

  return (
    <>
      {/*
        196x70.2: the orb at 0,0 and a 126x47 bubble at 70,12, whose tail
        overlaps the orb by 0.2px — which is why the two are positioned rather
        than laid out with a gap. The label sits at 102,26 within the block, so
        32px into the bubble.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={genome ? `Ask Spark about ${genome.name}` : 'Ask Spark'}
        title={genome ? `Ask Spark about ${genome.name}` : 'Ask Spark'}
        className={cn(
          'relative h-[70.2px] w-[196px] shrink-0 border-0 bg-transparent p-0 text-left',
          'transition-transform hover:scale-[1.02] active:scale-[0.99]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          'max-md:h-[52px] max-md:w-[52px]',
        )}
      >
        <span className="absolute left-0 top-0 block h-[70.2px] w-[70.2px] max-md:h-[52px] max-md:w-[52px]">
          <SparkMark variant="shell" size={70.2} animated />
        </span>

        {/* Bubble and label drop below `md`, where the orb alone is the control. */}
        <svg
          width="126"
          height="47"
          viewBox="0 0 126 47"
          aria-hidden
          className="absolute left-[70px] top-[12px] block max-md:hidden"
        >
          <path
            d="M 9.159 7.596 C 9.159 3.401 12.56 0 16.755 0 L 113.493 0 C 120.4 0 126 5.6 126 12.507 L 126 34.493 C 126 41.4 120.4 47 113.493 47 L 20.305 47 C 14.181 47 9.246 41.979 9.353 35.856 L 9.361 35.382 C 9.408 32.652 8.322 30.025 6.36 28.126 C 2.742 24.623 2.345 18.956 5.439 14.982 L 7.557 12.262 C 8.596 10.929 9.159 9.286 9.159 7.596 Z"
            fill="#FFFFFF"
          />
        </svg>
        <span className="absolute left-[102px] top-[26px] text-14 font-semibold leading-[1.28] text-ink max-md:hidden">
          Ask Spark?
        </span>
      </button>

      <ChatDrawer
        genomeId={genome?.genomeId}
        open={open}
        onClose={() => setOpen(false)}
        onOpenDraft={(contentItemId) => {
          // Close first: the drawer is fixed-position, and leaving it mounted
          // across a route change means it animates in again over the new page.
          setOpen(false);
          // `/agents`, because that is where the draft panel lives.
          router.push(`/agents?draft=${encodeURIComponent(contentItemId)}`);
        }}
      />
    </>
  );
}
