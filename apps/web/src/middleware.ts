import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

/**
 * Everything is protected except the auth surfaces. `auth.protect()` redirects an
 * unauthenticated browser to sign-in rather than returning a bare 401, which is
 * what you want for page routes.
 *
 * The tool proxy (`/api/tools/*`) is deliberately NOT public: it forwards a Clerk
 * token to the API, so an unauthenticated request there has nothing to forward.
 */
const isPublic = createRouteMatcher([
  // `AUTH-01`: pricing is where a visitor *arrives*, before any account exists.
  // Protecting it would redirect every prospective customer to sign-in, which
  // is the one screen that cannot come first.
  '/pricing(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/forgot-password(.*)',
  '/sso-callback(.*)',
]);

/**
 * Where Clerk parks a session that still owes us an organization.
 * Public by the matcher above (`/sign-in(.*)`), which it must be — a session
 * with an incomplete task cannot satisfy `auth.protect()`.
 */
const TASKS_URL = '/sign-in/tasks';

export default clerkMiddleware(
  async (auth, req) => {
    if (isPublic(req)) return;

    const { sessionStatus } = await auth();

    /**
     * A `pending` session is signed in but has an incomplete task — for this
     * instance, choosing an organization. `ClerkProvider`'s `taskUrls` is what
     * normally routes them, and this is the backstop for the paths it cannot
     * cover: a deep link, a bookmark, a refresh, or a session that went pending
     * after the page had already loaded.
     *
     * It matters because the failure is silent rather than loud. Such a session
     * has no `org_id` claim, so `auth.protect()` is satisfied — the user is
     * signed in — and the shell renders in full while **every** tool call comes
     * back 403 from `clerk-auth.ts`. Redirecting here converts a screen of
     * unexplained errors into the one step that was actually missing.
     */
    if (sessionStatus === 'pending') {
      return Response.redirect(new URL(TASKS_URL, req.url));
    }

    await auth.protect();
  },
  {
    // Middleware runs on the server and does not read ClerkProvider's props, so
    // these have to be set here too. Without them `auth.protect()` redirects to
    // Clerk's *hosted* pages and the custom screens in `(auth)/` are unreachable.
    signInUrl: '/sign-in',
    signUpUrl: '/sign-up',
  },
);

export const config = {
  matcher: [
    // Skip Next internals and static files unless they appear in search params.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
