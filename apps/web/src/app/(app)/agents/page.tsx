import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { CommandCenterOverview } from '@/components/command-center/CommandCenterOverview';
import { RunTimeline } from '@/components/agents/RunTimeline';

/**
 * CC-01, the Command Center Overview (PRD §CC-01) — identity, current focus,
 * controls, and what's waiting on a decision. The Agent Timeline (plan §4.5)
 * lives underneath it as the activity record: CC-01 is "what's happening
 * now", the Timeline is "what already happened and why", and an owner
 * deciding whether to trust autopublish needs both on the same screen.
 */
export default function AgentsPage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="grid grid-cols-1 gap-10 p-8">
        <CommandCenterOverview />

        <section>
          <header className="mb-6">
            <h2 className="text-[20px] font-medium text-ink">Activity</h2>
            <p className="mt-1 text-[14px] text-ink-muted">
              Every run SPARK has made for this brand, and every step inside it.
            </p>
          </header>
          <RunTimeline />
        </section>
      </div>
    </>
  );
}
