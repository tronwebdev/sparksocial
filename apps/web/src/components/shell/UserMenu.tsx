'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The account menu — and until now, the only way to sign out was clearing
 * cookies by hand. Every screen in `(app)` renders `TopBar`, so putting this in
 * `TopBar`'s `actions` slot (see the three call sites) makes it reachable from
 * everywhere in one change, the same reasoning `OrgGuard` uses for living in the
 * shared layout rather than on individual pages.
 *
 * An initials circle rather than Clerk's `imageUrl` — a real avatar needs
 * `next/image` remote-pattern config for Clerk's CDN host, which is a config
 * change for a feature nobody asked for. Initials cost nothing and are legible
 * at this size regardless of whether the user has ever set a photo.
 */
export function UserMenu() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  if (!isLoaded) return <Skeleton className="h-9 w-9 rounded-full" />;
  if (!user) return null;

  const label = user.fullName ?? user.primaryEmailAddress?.emailAddress ?? 'Account';
  const initials = initialsFor(user.firstName, user.lastName, user.primaryEmailAddress?.emailAddress);

  async function handleSignOut() {
    setSigningOut(true);
    // Redirect ourselves rather than passing `redirectUrl` to `signOut` — the
    // custom sign-in screen lives at `/sign-in`, and Clerk's own default
    // post-signout destination is its hosted account portal, which this app
    // does not use anywhere else.
    await signOut();
    router.push('/sign-in');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${label}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ss-accent-purple)] text-[13px] font-semibold text-white outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring"
      >
        {initials}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[240px]">
        <DropdownMenuLabel className="normal-case tracking-normal">
          <span className="block truncate text-[14px] font-medium text-ink">{label}</span>
          {user.primaryEmailAddress ? (
            <span className="mt-0.5 block truncate text-[12px] font-normal text-ink-muted">
              {user.primaryEmailAddress.emailAddress}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault(); // keep the menu open state consistent while the async sign-out runs
            void handleSignOut();
          }}
          disabled={signingOut}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initialsFor(first: string | null, last: string | null, email: string | undefined): string {
  const fromName = `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
  if (fromName) return fromName;
  return (email?.[0] ?? '?').toUpperCase();
}
