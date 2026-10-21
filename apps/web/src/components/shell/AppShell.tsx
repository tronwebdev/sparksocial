import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import Link from 'next/link';
import { Wordmark } from '@/components/brand/Wordmark';
import { SidebarNav } from './SidebarNav';
import { PlanCard } from './PlanCard';

/**
 * The two-column app frame: a 322px sidebar on white, and a rounded content canvas
 * card inset 18px with the brand gradient wash.
 *
 * The sidebar is a sticky, viewport-height column: the page scrolls under it
 * and the plan card stays in the bottom corner. See the comment on the `aside`
 * for what it was doing before and how that was measured.
 *
 * `chrome` exists because not every screen in the prototype wears this frame —
 * Calendar, Discovery and Command Center are full-bleed with their own Back
 * affordance. Modelling that from the start avoids retrofitting an escape hatch
 * later, which is how shells end up with `position: fixed` overrides scattered
 * through feature code.
 */
export interface AppShellProps {
  children: React.ReactNode;
  chrome?: 'shell' | 'bare';
}

export function AppShell({ children, chrome = 'shell' }: AppShellProps) {
  if (chrome === 'bare') {
    return <TooltipProvider delayDuration={200}>{children}</TooltipProvider>;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          'grid min-h-screen bg-background',
          'grid-cols-[var(--ss-rail)_1fr] max-xl:grid-cols-[88px_1fr] max-md:grid-cols-1',
        )}
      >
        {/*
          ── The rail stays put ──────────────────────────────────────────

          It did not. The grid is `min-h-screen` and nothing inside it scrolls
          on its own, so the *document* scrolls and the rail scrolled with it.
          Measured on the deployed `/home` at 1440x900: document 1465 tall
          against a 900 viewport, `aside` 1465 tall and `position: static`.
          `mt-auto` below pins the plan card to the bottom of that 1465px
          column, which is 565px past the fold — the card the design puts in
          the corner of the screen was only reachable by scrolling to the end
          of whatever page you were on.

          `sticky` rather than `fixed`: the grid column already reserves the
          rail's width, and a fixed rail leaves that column empty and overlays
          the canvas. Sticky keeps the track and parks the content in it.

          `h-screen` is what makes `mt-auto` mean "the bottom of the screen"
          rather than "the bottom of the page", and `min-h-0` lets the nav in
          the middle be the part that gives when a short window cannot hold
          everything — the plan card and the wordmark are fixed furniture, the
          list of links is not.
        */}
        <aside className="sticky top-0 flex h-screen flex-col max-md:hidden">
          {/*
            The wordmark is the route to the dashboard. That is how the
            prototypes reach it - their nav has no Home row, and the Brand Home
            screen leaves the glow parked on the first one.
          */}
          <Link
            href="/home"
            aria-label="SparkSocial home"
            className="pl-[22px] pt-[30.8px] max-xl:flex max-xl:justify-center max-xl:pl-0"
          >
            <Wordmark className="max-xl:[&>span]:hidden" />
          </Link>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SidebarNav />
          </div>
          {/*
            Ask Spark used to sit here, under a docstring claiming 48 of 61
            prototypes put it in the sidebar. 48 of 61 do have it; not one of
            them puts it in the sidebar. Measured across every file, the block is
            196x70 at left 1484-1503, top 30-34 - the header's top right corner,
            on Dashboard, Command Center, Assets, Discovery and the Settings
            screens alike. The `left:102px` I must have read as a sidebar
            coordinate is the label's offset *inside* that block.

            It is a page-header control now, so `TopBar` renders it.
          */}
          {/* `mt-auto` is gone with the scroll container above it: the nav
              takes the slack now, so the card sits under it at the foot of a
              viewport-height column rather than being pushed there. */}
          <PlanCard />
        </aside>

        <main
          className={cn(
            // `bg-canvas-wash` carries the base colour as its final layer — see
            // the token. Do not add a separate `bg-canvas` here; tailwind-merge
            // treats the two as conflicting and drops one.
            'my-[18px] mr-[18px] overflow-hidden rounded-2xl bg-canvas-wash',
            'max-md:m-0 max-md:rounded-none',
          )}
        >
          {children}
        </main>
      </div>
    </TooltipProvider>
  );
}
