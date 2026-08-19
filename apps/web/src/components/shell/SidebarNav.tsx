'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav-items';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Rows sit on a 65px pitch — 27px of row plus a 38px gap. That decomposition is
 * exact against the prototype's absolute tops (132, 197.9, 262.9, …) and is why
 * the glow can be positioned arithmetically rather than measured from the DOM.
 *
 * Those tops are measured from the top of the *sidebar*, but this nav renders
 * below the logo block, so `NAV_OFFSET` subtracts the space the logo already
 * occupies (30.8px of padding + a 53.57px mark). Getting this wrong pushes every
 * row — and the glow with it — down by the height of the logo.
 *
 * The prototype scales a fixed 1728px stage with `transform: scale()`; that crutch
 * is deliberately not ported. Below 1280px the rail collapses to icons with
 * tooltips — a responsive state I'm introducing, not something the prototype
 * specifies, since it only ever renders at desktop width.
 */
const ROW_H = 27;
const GAP = 38;
const PITCH = ROW_H + GAP; // 65
const FIRST_TOP = 132; // from the top of the sidebar
const LOGO_BLOCK = 30.8 + 53.57; // padding + mark height
const NAV_OFFSET = FIRST_TOP - LOGO_BLOCK; // 47.63
const GLOW_H = 50;

export function SidebarNav() {
  const pathname = usePathname();
  const activeIndex = NAV_ITEMS.findIndex((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));

  return (
    <nav className="relative" aria-label="Main">
      {/* The sliding pill. One element that moves, not seven that toggle — this is
          what produces the prototype's continuous glide between sections. */}
      {activeIndex >= 0 && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-[14px] right-[26px] rounded bg-nav-active',
            'transition-transform duration-[250ms] ease-shell motion-reduce:transition-none',
            'max-xl:hidden',
          )}
          style={{
            height: GLOW_H,
            top: NAV_OFFSET - (GLOW_H - ROW_H) / 2,
            transform: `translateY(${activeIndex * PITCH}px)`,
          }}
        />
      )}

      <ul className="relative flex flex-col" style={{ paddingTop: NAV_OFFSET, gap: GAP }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-[15px] rounded pl-[36px] transition-colors',
                      'max-xl:justify-center max-xl:pl-0',
                      isActive ? 'text-ink' : 'text-ink-muted hover:text-ink',
                    )}
                    style={{ height: ROW_H }}
                  >
                    <Icon className="h-[26px] w-[26px] shrink-0" />
                    <span
                      className={cn('truncate max-xl:hidden', isActive ? 'font-medium' : 'font-normal')}
                      style={{ fontSize: item.labelPx }}
                    >
                      {item.label}
                    </span>
                  </Link>
                </TooltipTrigger>
                {/* Only meaningful once labels are hidden — at desktop the label is
                    right there, so a tooltip would just be noise. */}
                <TooltipContent side="right" className="xl:hidden">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
