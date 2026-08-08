import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Wordmark } from '@/components/brand/Wordmark';
import { SidebarNav } from './SidebarNav';
import { PlanCard } from './PlanCard';

/**
 * The two-column app frame: a 322px sidebar on white, and a rounded content canvas
 * card inset 18px with the brand gradient wash.
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
        <aside className="flex flex-col max-md:hidden">
          <div className="pl-[22px] pt-[30.8px] max-xl:flex max-xl:justify-center max-xl:pl-0">
            <Wordmark className="max-xl:[&>span]:hidden" />
          </div>
          <SidebarNav />
          <div className="mt-auto">
            <PlanCard />
          </div>
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
