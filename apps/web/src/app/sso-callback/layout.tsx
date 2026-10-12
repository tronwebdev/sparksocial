import { AppProviders } from '../AppProviders';

/**
 * `/sso-callback` is where Clerk returns a browser mid-handshake, so it is the
 * one route that *cannot* work without the provider — `AuthenticateWithRedirectCallback`
 * is a Clerk component and has nothing to talk to otherwise.
 *
 * Outside every route group, deliberately: it is a transit stop rather than a
 * screen, and putting it inside `(auth)` would wrap a redirect in that group's
 * chrome. So it opts in here. See `AppProviders.tsx`.
 */
export default function SsoCallbackLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
