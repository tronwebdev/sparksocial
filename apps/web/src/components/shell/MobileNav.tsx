'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Sheet, SheetTrigger, SheetContent, SheetClose } from '@/components/ui/sheet';
import { Wordmark } from '@/components/brand/Wordmark';
import { NAV_ITEMS } from './nav-items';

/**
 * `AppShell` hides the desktop sidebar entirely below `md` (768px) with
 * nothing to replace it — below that width there was no way to navigate
 * between sections at all. This is that replacement: the same `NAV_ITEMS`
 * the desktop rail reads, in a full-height sheet triggered from `TopBar`.
 *
 * Rendered only `md:hidden` by the caller — at `md` and up the real sidebar
 * is visible and this would just be a redundant second nav.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-muted hover:text-ink"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </SheetTrigger>
      <SheetContent side="left" className="p-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <Wordmark markSize={32} fontSize={18} />
          <SheetClose
            aria-label="Close navigation"
            className="flex h-8 w-8 items-center justify-center rounded text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            <X className="h-5 w-5" aria-hidden />
          </SheetClose>
        </div>
        <nav className="flex flex-col gap-1 p-3" aria-label="Main">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] ${
                  isActive ? 'bg-nav-active font-medium text-ink' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
                }`}
              >
                <Icon className="h-[22px] w-[22px] shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
