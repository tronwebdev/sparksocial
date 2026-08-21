import Link from 'next/link';
import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { ConsentPanel } from '@/components/settings/ConsentPanel';
import { AvatarConfigPanel } from '@/components/settings/AvatarConfigPanel';
import { PublishHealthPanel } from '@/components/settings/PublishHealthPanel';
import { OfferPanel } from '@/components/settings/OfferPanel';
import { ConnectionsPanel } from '@/components/settings/ConnectionsPanel';
import { PolicyPanel } from '@/components/settings/PolicyPanel';
import { GovernancePanel } from '@/components/settings/GovernancePanel';
import { LearningPanel } from '@/components/settings/LearningPanel';
import { KnowledgePanel } from '@/components/settings/KnowledgePanel';

/**
 * `SET-WS-01` — the brand layer of §8.12's two.
 *
 * Was a placeholder tagged `phase="P3"` — three real tools (`genome.consent.*`,
 * `genome.avatar_config.set`, `publish.status`) have been reachable nowhere
 * else since the phase that shipped them. This is that home.
 *
 * ── The split, and why the org half left ──────────────────────────────────
 *
 * Billing, the plan, SSO and the multi-brand roster used to sit here too. They
 * are not settings *of a brand*, and keeping them here meant an agency operator
 * adding client #4 had to pick client #3 first to find the button. They moved to
 * `/account`, which is now the org layer — moved rather than duplicated, since a
 * setting reachable from two screens is one two people disagree about the
 * location of, and eventually one copy stops being updated.
 *
 * What is left is the answer to "what is true of *this brand*": what it may say,
 * what it knows, what it is connected to, who has consented to appear in it.
 *
 * `GovernancePanel` leads because it is the one panel that changes what SPARK is
 * allowed to say — restricted topics, claims to avoid, strict mode, voice,
 * timezone and posting windows (§8.2 `ONB-03`, §9). `KnowledgePanel` sits second
 * because it is the one that changes what SPARK is allowed to *claim*: with
 * nothing attached, `guard.claim_grounding` holds every specific statement.
 */
export default function SettingsPage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="grid grid-cols-1 gap-6 p-8">
        <header>
          <h1 className="text-[20px] font-medium text-ink">Brand settings</h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            Everything true of this brand. Plan, billing, people and the audit log live in{' '}
            <Link href="/account" className="font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline">
              Account
            </Link>
            .
          </p>
        </header>
        <GovernancePanel />
        <KnowledgePanel />
        <ConsentPanel />
        <OfferPanel />
        <AvatarConfigPanel />
        <ConnectionsPanel />
        <PublishHealthPanel />
        <PolicyPanel />
        <LearningPanel />
      </div>
    </>
  );
}
