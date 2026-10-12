import type { Metadata } from 'next';
import { onest, mollwish } from './fonts';
import '../styles/globals.css';

/**
 * THE DOCUMENT, AND NOTHING ELSE.
 *
 * `<html>`, `<body>`, the two fonts and the stylesheet. No providers.
 *
 * ── Why the providers moved out ───────────────────────────────────────────
 *
 * They used to be here, which meant every route in the app was wrapped in
 * `ClerkProvider` and `NotificationProvider` — and the latter calls
 * `useAuth()`, so clerk-js loaded on every page. That is right for every screen
 * with a session and wrong for `/p/[token]`, the client-facing proposal, whose
 * reader has no account: it was fetching ~200KB of auth SDK, and telling Clerk
 * somebody was reading, to render a priced offer to a stranger.
 *
 * So this layout is the part every route genuinely shares, and `AppProviders`
 * is the part only routes with a session do. A branch that needs one opts in;
 * a branch that does not, does not. See `AppProviders.tsx` for the list and for
 * why this is done by pushing providers down rather than by giving every route
 * group its own root layout.
 *
 * **Adding anything stateful here puts it on the public page too.** That is the
 * whole point of the file being this short, and the reason to resist the next
 * global provider that looks harmless.
 */

export const metadata: Metadata = {
  title: 'SparkSocial',
  description: 'Agent-first social media operating system.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${onest.variable} ${mollwish.variable}`}>
      <body>{children}</body>
    </html>
  );
}
