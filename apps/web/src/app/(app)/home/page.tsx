import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { BrandHome } from '@/components/dashboard/BrandHome';

/**
 * `DASH-B-01` — Brand Home (PRD §8.3), which had no route.
 *
 * `/` redirected to `/agents`, the Command Center, so a brand with no campaign
 * landed on a supervision screen for an agent that was not doing anything. §8.3
 * asks the opposite of that: lead with the one action that unblocks everything
 * else, and preview the rest.
 */
export default function BrandHomePage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="p-8">
        <header className="mb-6">
          <h1 className="text-[20px] font-medium text-ink">Home</h1>
          <p className="mt-1 text-[14px] text-ink-muted">Where this brand stands, and what to do next.</p>
        </header>
        <BrandHome />
      </div>
    </>
  );
}
