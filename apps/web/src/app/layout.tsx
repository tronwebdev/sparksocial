import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { onest, mollwish } from './fonts';
import { Toaster } from '@/components/ui/toaster';
import { NotificationProvider } from '@/lib/notifications';
import { NotificationToasts } from '@/components/notifications/NotificationToasts';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'SparkSocial',
  description: 'Agent-first social media operating system.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
      <html lang="en" className={`${onest.variable} ${mollwish.variable}`}>
        <body>
          {/*
            One notification system for the whole app, mounted at the root so it
            spans every route group — `(app)`, `(cc)`, and the pages outside both
            (`/workspaces`, `/account`). It polls nothing until Clerk says the
            session is signed in, so the auth screens pay no cost for being
            inside it. See `lib/notifications.tsx`.
          */}
          <NotificationProvider>
            {children}
            <NotificationToasts />
          </NotificationProvider>
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
