import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { DiscoveryFeed } from '@/components/discovery/DiscoveryFeed';

/**
 * Discovery (PRD §8.9, `DISC-01`/`DISC-02`) — trends worth acting on, per
 * `trend.rank`'s ranking and `trend.repurpose`'s suggestions.
 */
export default function DiscoveryPage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="p-8">
        <header className="mb-6">
          <h1 className="text-[20px] font-medium text-ink">Discovery</h1>
          <p className="mt-1 text-[14px] text-ink-muted">Trends worth acting on.</p>
        </header>
        <DiscoveryFeed />
      </div>
    </>
  );
}
