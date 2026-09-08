import { AppProviders } from '../AppProviders';
import { OrgGuard } from '@/components/auth/OrgGuard';
import { GenomeGuard } from '@/components/auth/GenomeGuard';

/**
 * The Command Center's own layout: both guards, no `AppShell`.
 *
 * `SparkSocial Command Center.dc.html` is full-bleed. Its background card runs
 * 15..1713 of the 1728 stage — there is no 322px sidebar, and no page header
 * either. Navigation is a wordmark, a Back button that returns to the
 * dashboard, and a 867px nav pill carrying the screen's own four tabs.
 *
 * `AppShell` already had a `chrome="bare"` prop for exactly this, added on the
 * argument that "Calendar, Discovery and Command Center are full-bleed with
 * their own Back affordance" — but nothing could reach it. The prop is set
 * where `AppShell` is rendered, which is `(app)/layout.tsx`, and a *page*
 * cannot influence its own layout. A route group is how Next lets a route opt
 * out of one: `(cc)` changes no URL, so `/agents` is still `/agents`.
 *
 * The guards stay, and stay in this order — `GenomeGuard` needs `orgId`
 * verified before `genome.list` means anything.
 */
export default function CommandCenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <OrgGuard>
        <GenomeGuard>{children}</GenomeGuard>
      </OrgGuard>
    </AppProviders>
  );
}
