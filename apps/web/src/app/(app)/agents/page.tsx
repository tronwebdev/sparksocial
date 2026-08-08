import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { RunTimeline } from '@/components/agents/RunTimeline';

/**
 * The Agent Timeline (plan §4.5) — a P1 deliverable, not polish: it is the
 * evidence a user needs before agreeing to let SPARK publish unattended.
 *
 * Unlike the other routes in this group, this one renders real data rather than
 * a placeholder, because the runs behind it exist today.
 */
export default function AgentsPage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} />
      <div className="p-8">
        <header className="mb-6">
          <h1 className="text-[20px] font-medium text-ink">Agents</h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            Every run SPARK has made for this brand, and every step inside it.
          </p>
        </header>
        <RunTimeline />
      </div>
    </>
  );
}
