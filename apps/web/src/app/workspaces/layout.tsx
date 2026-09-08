import { AppProviders } from '../AppProviders';

/**
 * `/workspaces` sits outside every route group — it is the switcher a session
 * lands on between organisations, so it belongs to none of them — which means
 * it needs its own opt-in to the providers rather than inheriting them.
 *
 * It reads the session directly (`useUser`, `useOrganizationList`), so without
 * this the page throws on its first hook. See `AppProviders.tsx`.
 */
export default function WorkspacesLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
