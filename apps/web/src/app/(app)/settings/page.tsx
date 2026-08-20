import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { ConsentPanel } from '@/components/settings/ConsentPanel';
import { AvatarConfigPanel } from '@/components/settings/AvatarConfigPanel';
import { PublishHealthPanel } from '@/components/settings/PublishHealthPanel';
import { OfferPanel } from '@/components/settings/OfferPanel';
import { AgencyPanel } from '@/components/settings/AgencyPanel';
import { ConnectionsPanel } from '@/components/settings/ConnectionsPanel';
import { PolicyPanel } from '@/components/settings/PolicyPanel';
import { GovernancePanel } from '@/components/settings/GovernancePanel';
import { LearningPanel } from '@/components/settings/LearningPanel';

/**
 * Was a placeholder tagged `phase="P3"` — three real tools (`genome.consent.*`,
 * `genome.avatar_config.set`, `publish.status`) have been reachable nowhere
 * else since the phase that shipped them. This is that home.
 *
 * Billing/plan management and the multi-brand roster (`AgencyPanel`, §12 P6)
 * landed here too — the org-level counterpart to everything above it, which is
 * all brand-level.
 *
 * `GovernancePanel` closed the gap this comment used to end on: workspace-level
 * guardrail and compliance configuration (PRD §8.2 `ONB-03`, §8.12 `SET-WS-01`,
 * §9) — restricted topics, claims to avoid, strict mode, voice, timezone and
 * posting windows. It leads the page because it is the one panel that changes
 * what SPARK is allowed to say.
 */
export default function SettingsPage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="grid grid-cols-1 gap-6 p-8">
        <header>
          <h1 className="text-[20px] font-medium text-ink">Settings</h1>
          <p className="mt-1 text-[14px] text-ink-muted">Workspace and personal</p>
        </header>
        <GovernancePanel />
        <ConsentPanel />
        <OfferPanel />
        <AvatarConfigPanel />
        <ConnectionsPanel />
        <PublishHealthPanel />
        <PolicyPanel />
        <LearningPanel />
        <AgencyPanel />
      </div>
    </>
  );
}
