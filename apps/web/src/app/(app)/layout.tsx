import { AppShell } from '@/components/shell/AppShell';
import { OrgGuard } from '@/components/auth/OrgGuard';

/**
 * `OrgGuard` wraps the whole shell rather than sitting on individual pages:
 * every route under `(app)` calls tools, and every tool call is rejected by the
 * API without an active organization on the session.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <OrgGuard>
      <AppShell>{children}</AppShell>
    </OrgGuard>
  );
}
