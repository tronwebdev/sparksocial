import { TopBar } from './TopBar';

/**
 * P0 renders the frame, not the content. The screens behind these routes need
 * campaigns, drafts and generation jobs — none of which exist until P3 — so
 * building their cards now would mean binding UI to invented data shapes.
 */
export function PlaceholderCanvas({ title, subtitle, phase }: { title: string; subtitle?: string; phase: string }) {
  return (
    <>
      <TopBar title={title} {...(subtitle ? { subtitle } : {})} />
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <p className="text-[16px] text-ink-muted">Lands in {phase}.</p>
      </div>
    </>
  );
}
