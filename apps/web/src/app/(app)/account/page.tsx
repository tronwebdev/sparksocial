import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { AccountHome } from '@/components/dashboard/AccountHome';

/**
 * `DASH-A-01` — Account Home (PRD §8.3, §8.13): the org level, which had no
 * route at all. Every screen was brand-scoped, and the multi-brand roster and
 * billing lived inside *brand* settings — one level below where they belong.
 */
export default function AccountHomePage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="p-8">
        <header className="mb-6">
          <h1 className="text-[20px] font-medium text-ink">Account</h1>
          <p className="mt-1 text-[14px] text-ink-muted">Every brand you run, and how it is billed.</p>
        </header>
        <AccountHome />
      </div>
    </>
  );
}
