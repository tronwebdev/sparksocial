import { TopBar } from './TopBar';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { UserMenu } from './UserMenu';

/**
 * P0 renders the frame, not the content. The screens behind these routes need
 * campaigns, drafts and generation jobs — none of which exist until P3 — so
 * building their cards now would mean binding UI to invented data shapes.
 *
 * The brand switcher is real, though: it is the one live path through the whole
 * stack, so it belongs here rather than waiting for content to wrap around it.
 */
export function PlaceholderCanvas({ title, subtitle, phase }: { title: string; subtitle?: string; phase: string }) {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-8">
        <p className="text-[20px] font-medium text-ink">{title}</p>
        {subtitle ? <p className="text-[16px] text-ink-muted">{subtitle}</p> : null}
        <p className="mt-2 text-[14px] text-ink-muted">Lands in {phase}.</p>
      </div>
    </>
  );
}
