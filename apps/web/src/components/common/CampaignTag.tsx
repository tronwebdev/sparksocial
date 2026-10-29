import { CAMPAIGN_STATE, type CampaignInfo } from '@/lib/useCampaigns';

/**
 * Which campaign a post belongs to, in a row that lists several campaigns' posts.
 *
 * The Command Center's campaign chip at a list row's size — the same white
 * fill and `#838383` hairline — with the campaign's state as a dot, so a row
 * reads "this is the October drive's post, and that campaign is running".
 * Drawn only where a brand has more than one campaign; with one, it would
 * repeat the same name on every row.
 */
export function CampaignTag({ campaign, className }: { campaign: CampaignInfo; className?: string }) {
  const state = CAMPAIGN_STATE[campaign.status] ?? CAMPAIGN_STATE.paused!;
  return (
    <span
      title={`${campaign.name} — ${state.label.toLowerCase()}`}
      className={`inline-flex h-[24px] max-w-[200px] items-center gap-[6px] rounded-[7px] bg-white px-[8px] text-12 font-semibold text-ink ${className ?? ''}`}
      style={{ boxShadow: 'inset 0 0 0 0.94px rgba(131,131,131,0.6)' }}
    >
      <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: state.dot }} />
      <span className="truncate">{campaign.name}</span>
    </span>
  );
}
