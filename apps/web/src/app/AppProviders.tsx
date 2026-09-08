import { ClerkProvider } from '@clerk/nextjs';
import { Toaster } from '@/components/ui/toaster';
import { NotificationProvider } from '@/lib/notifications';
import { NotificationToasts } from '@/components/notifications/NotificationToasts';

/**
 * Everything the signed-in product needs wrapped around it — and nothing the
 * one public page does.
 *
 * ── Why this is not in the root layout ────────────────────────────────────
 *
 * It was. The root layout wrapped every route in `ClerkProvider` and
 * `NotificationProvider`, and `NotificationProvider` calls `useAuth()`, which
 * makes clerk-js load. That is correct for every screen with a session and
 * wrong for exactly one route: `/p/[token]`, the client-facing proposal, whose
 * reader has no account by definition. It was pulling ~200KB of auth SDK and a
 * handful of requests to Clerk to render a priced offer to a stranger.
 *
 * The alternative Next.js documents for this is multiple root layouts — delete
 * the top-level `layout.tsx` and give every route group its own. That works,
 * and it means moving every page in the app into a new group to satisfy the
 * "every route needs a root layout" rule. Pushing the providers *down* instead
 * achieves the same thing and moves no pages: the root layout keeps `<html>`,
 * the fonts and the stylesheet, and each branch that needs a session opts into
 * this.
 *
 * ── The cost of that choice, and why it is acceptable ─────────────────────
 *
 * `ClerkProvider` now appears in six places rather than one, so its
 * configuration has to live somewhere single — here. A prop set on one branch
 * and forgotten on another is the failure mode this file exists to prevent, and
 * a route that needs a session and forgets to wrap in this does not silently
 * degrade: `useAuth()` throws without a provider, immediately and in
 * development.
 *
 * ── Which routes wrap themselves in this ─────────────────────────────────
 *
 *   `(app)` `(cc)` `(onboarding)`   the product, behind `OrgGuard`
 *   `(auth)`                        sign-in and sign-up, which are Clerk's own
 *   `workspaces` `sso-callback`     ungrouped, both read the session directly
 *
 * Not `/` (a bare `redirect()`, which renders nothing) and not `/p/[token]`.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    // Without these, `auth.protect()` sends users to Clerk's *hosted* pages and
    // the custom screens in `(auth)/` are never reached.
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/meet-spark"
      /**
       * NO `taskUrls` — deliberately. Org creation is fully custom now
       * (`OrgGuard.tsx`, mounted in the `(app)`/`(onboarding)`/`meet-spark`
       * layouts), which requires the Clerk Dashboard's "Force organization
       * selection" setting to be OFF. With it off, a fresh session carries no
       * pending Clerk task at all — `OrgGuard` sees `orgId` absent and shows
       * its own "Name your account" form, the same one path regardless of
       * which route the session first lands on.
       *
       * `(auth)/sign-in/tasks` (Clerk's own `TaskChooseOrganization`) is kept
       * as a dormant fallback, not deleted — if that Dashboard setting is ever
       * re-enabled, Clerk needs a `taskUrls` entry pointing at it again or it
       * prints "Session has pending tasks but no handling is configured…" and
       * does nothing. See that route's own comment for the full history.
       */
    >
      {/*
        One notification system for the signed-in product. It polls nothing
        until Clerk says the session is signed in, so the auth screens pay no
        cost for being inside it — but it does call `useAuth()`, which is why it
        cannot sit above the provider and why it is not on the public page.
        See `lib/notifications.tsx`.
      */}
      <NotificationProvider>
        {children}
        <NotificationToasts />
      </NotificationProvider>
      <Toaster />
    </ClerkProvider>
  );
}
