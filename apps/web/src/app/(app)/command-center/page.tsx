import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { EngagementFeed } from '@/components/engagement/EngagementFeed';

/**
 * Engagement Intelligence (PRD §8.8, `ENG-01`→`ENG-02.4`) — the inbox feed
 * `engage.list` reads. Read-only: replying, auto-handling and escalating
 * (`.reply.*`/`.autohandle`/`.escalate`/`.opportunity.*`) are a separate
 * follow-up, not built here.
 */
export default function CommandCenterPage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="p-8">
        <header className="mb-6">
          <h1 className="text-[20px] font-medium text-ink">Engagement Intelligence</h1>
          <p className="mt-1 text-[14px] text-ink-muted">Conversations and intent.</p>
        </header>
        <EngagementFeed />
      </div>
    </>
  );
}
