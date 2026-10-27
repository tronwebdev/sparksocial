import { AppProviders } from '../AppProviders';
import { OrgGuard } from '@/components/auth/OrgGuard';

/**
 * `/organization` — the account's own settings, outside every brand screen.
 *
 * It lived at `/settings/org`, inside `(cc)`, as a third tab beside a brand's
 * settings: behind `GenomeGuard`, with a Brand/Personal switch, an Ask Spark
 * that talks to a brand's agent, and a Back that went to a brand's dashboard.
 * None of that is about the organisation. It is reached from the brands page
 * now and returns there.
 *
 * `OrgGuard` and nothing else: every tool here is org-scoped and needs an
 * active organisation on the session, and none of them needs a brand —
 * `GenomeGuard` would send an account with no finished brand to onboarding
 * before it could see its own bill.
 */
export default function OrganizationLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <OrgGuard>{children}</OrgGuard>
    </AppProviders>
  );
}
