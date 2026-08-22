'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChatDrawer } from '@/components/command-center/ChatDrawer';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';

/**
 * ASK SPARK, from anywhere — `F2`.
 *
 * The fidelity pass measured this one: a persistent assistant affordance sits in
 * the sidebar of **48 of the 61 prototypes**, and the build mentioned it in three
 * components. The capability was never missing — `ChatDrawer` runs the agent
 * perfectly well — it was reachable from exactly one screen out of nineteen.
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
 * The trap: the screen *titled* "Agent Command Center" is at `/agents`, while
 * `/command-center` is the engagement inbox — M2's naming collision. This
 * component first suppressed itself on `/command-center`, which is precisely
 * backwards: it hid Ask Spark on the inbox, which has no chat and needs it, and
 * doubled it on the one screen that already had one. Found by opening the page.
 * The route name is the thing to fix (M2); until then this comment is the
 * warning.
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

  // `/agents` brings its own drawer. Not `/command-center` — see the header.
  if (pathname.startsWith('/agents')) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-2.5',
          'text-left transition-colors hover:bg-surface-muted',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        )}
      >
        {/* The prototype's four-point sparkle, breathing. `ss-breathe` was
            already implemented; this is the affordance it was waiting for. */}
        <span aria-hidden className="animate-breathe text-[15px] leading-none">
          ✦
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">Ask Spark</span>
          <span className="block truncate text-[11.5px] text-ink-muted">
            {genome ? `About ${genome.name}` : 'Pick a brand first'}
          </span>
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
