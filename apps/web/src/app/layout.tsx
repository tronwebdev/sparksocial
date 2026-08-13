import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { onest, mollwish } from './fonts';
import { Toaster } from '@/components/ui/toaster';
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
       * SESSION TASKS. Do not remove — the app is unusable without it.
       *
       * The instance has `force_organization_selection: true`, so Clerk parks a
       * new session with an incomplete `choose-organization` task. A session in
       * that state carries **no `org_id` claim**, and `apps/api/src/clerk-auth.ts`
       * rejects every tool call without one. The user lands in a fully rendered
       * shell where each panel reports "No active organization on this session".
       *
       * Clerk cannot route to the task screen on its own: with no `taskUrls` it
       * warns "Session has pending tasks but no handling is configured… users
       * may get stuck on incomplete flows" and then does nothing. That warning
       * is the whole bug — it is a console message rather than a redirect, so it
       * surfaces as a broken app rather than as a missing step.
       *
       * The route it points at already existed (`(auth)/sign-in/tasks`); nothing
       * was sending anyone to it.
       */
      taskUrls={{ 'choose-organization': '/sign-in/tasks' }}
    >
      <html lang="en" className={`${onest.variable} ${mollwish.variable}`}>
        <body>
          {children}
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
