import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { AutomationRecipes } from '@/components/automation/AutomationRecipes';

/**
 * Automation Recipes (PRD/plan §12 P5, `AUTO-01`→`AUTO-04.4`) — AutoTrend,
 * Bulk Connector, and RSS recipes, plus the output queue that keeps
 * "unattended" from meaning "unsupervised".
 */
export default function AutomationPage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="p-8">
        <header className="mb-6">
          <h1 className="text-[20px] font-medium text-ink">Automation Recipes</h1>
          <p className="mt-1 text-[14px] text-ink-muted">Work that runs unattended.</p>
        </header>
        <AutomationRecipes />
      </div>
    </>
  );
}
