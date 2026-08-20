import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { EngagementFeed } from '@/components/engagement/EngagementFeed';
import { EngagementGate } from '@/components/engagement/EngagementGate';

/**
 * Engagement Intelligence (PRD §8.8, `ENG-01`→`ENG-02.4`).
 *
 * `ENG-01`'s eligibility gate (`EngagementGate`) wraps `ENG-02`'s four-tab feed,
 * so the three states §8.8 requires are all reachable: ineligible with the
 * reason, eligible-but-unconfigured with a way to configure, and active.
 *
 * This comment used to say the screen was read-only, with replying and
 * escalating "a separate follow-up, not built here". They were built; the
 * comment was not updated. Recorded because the doc comments in this repo are
 * its design record, and a stale one is worse than none — it is a claim
 * somebody will act on.
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
        <EngagementGate>
          <EngagementFeed />
        </EngagementGate>
      </div>
    </>
  );
}
