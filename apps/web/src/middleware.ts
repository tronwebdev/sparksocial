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
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/forgot-password(.*)',
  '/sso-callback(.*)',
]);

export default clerkMiddleware(
  async (auth, req) => {
    if (!isPublic(req)) await auth.protect();
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
