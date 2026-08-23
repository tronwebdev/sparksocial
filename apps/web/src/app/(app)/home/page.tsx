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
 *
 * The page-level header is gone as of the cockpit rework: "Home / Where this
 * brand stands" sat directly above the brand's own name and the two primary
 * actions, so the screen opened with two headings and one of them was the word
 * for the route. `BrandHome` owns its heading now.
 */
export default function BrandHomePage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="p-8">
        <BrandHome />
      </div>
    </>
  );
}
