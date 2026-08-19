import { AppShell } from '@/components/shell/AppShell';
import { OrgGuard } from '@/components/auth/OrgGuard';
import { GenomeGuard } from '@/components/auth/GenomeGuard';

/**
 * `OrgGuard` wraps the whole shell rather than sitting on individual pages:
 * every route under `(app)` calls tools, and every tool call is rejected by the
 * API without an active organization on the session.
 *
 * `GenomeGuard` is inside it, not beside it — it needs `orgId` verified
 * first, since `genome.list` means nothing without one. Together they cover
 * both ways a session can arrive here incomplete: no organization yet
 * (`OrgGuard`), or an organization that never finished onboarding
 * (`GenomeGuard`) — closing setup abandoned at any point routes back to
 * exactly where it left off on the next login, not into a broken shell.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <OrgGuard>
      <GenomeGuard>
        <AppShell>{children}</AppShell>
      </GenomeGuard>
    </OrgGuard>
  );
}
