import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { AccountHome } from '@/components/dashboard/AccountHome';
import { TeamPanel } from '@/components/account/TeamPanel';
import { BrandTransferPanel } from '@/components/account/BrandTransferPanel';
import { AuditPanel } from '@/components/account/AuditPanel';
import { AgencyPanel } from '@/components/settings/AgencyPanel';
import { UsagePanel } from '@/components/settings/UsagePanel';

/**
 * `DASH-A-01` / `SET-ORG-01` — the org layer.
 *
 * §8.12 describes two layers of settings, an org one and a workspace one, and
 * the product had one flat page. Everything org-level — the plan, the spend cap,
 * SSO, the default approval mode, the brand roster, this month's spend — sat
 * inside *brand* settings, one level below where it belongs: an agency operator
 * adding client #4 had to first pick client #3 in order to find the button.
 *
 * So the split is by *what the setting is about*, which is the only division
 * that survives contact with an agency:
 *
 *   - **Here (`/account`)**: things true of the organisation. Billing and plan,
 *     the brand roster, who is in the workspace and which brands they reach, the
 *     audit trail, moving a brand in or out.
 *   - **`/settings`**: things true of *this brand*. Its voice and rules, its
 *     knowledge, its connections, its consent records, its avatar.
 *
 * `AgencyPanel` and `UsagePanel` moved here rather than being duplicated. A
 * setting reachable from two screens is a setting two people can disagree about
 * the location of, and eventually one of the two copies stops being updated.
 *
 * The audit log is org-level for the same reason the roster is: `org.audit.query`
 * reads across every brand, and a per-brand audit page would be the one screen
 * that cannot answer "who touched what" for an org.
 */
export default function AccountHomePage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="grid grid-cols-1 gap-6 p-8">
        <header>
          <h1 className="text-[20px] font-medium text-ink">Account</h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            Your organisation: brands, billing, people, and the record of what happened.
          </p>
        </header>
        <AccountHome />
        <AgencyPanel />
        <UsagePanel />
        <TeamPanel />
        <BrandTransferPanel />
        <AuditPanel />
      </div>
    </>
  );
}
