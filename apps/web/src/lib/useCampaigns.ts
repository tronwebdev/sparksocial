'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from './tools';

/** One campaign as `campaign.list` returns it — the fields every surface uses. */
export interface CampaignInfo {
  campaignId: string;
  name: string;
  status: string;
  objective: string;
  windowDays: number;
  startAt: string;
  campaignType?: 'promotion' | 'lead_magnet' | 'authority' | 'launch';
}

/**
 * A brand's campaigns, read once and shared.
 *
 * A brand can run several campaigns at once and the dashboard, the Command
 * Center and the queue all list its posts together. Each of them used to read
 * `campaign.list` with `limit: 1` or `limit: 5` and keep one — so nothing could
 * say which post belonged to which, or that more than one was running.
 */
export function useCampaigns(genomeId: string | undefined) {
  const [campaigns, setCampaigns] = useState<CampaignInfo[] | null>(null);

  const reload = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<{ campaigns: CampaignInfo[] }>('campaign.list', { genomeId, limit: 50 });
    setCampaigns(res.status === 'succeeded' ? res.output.campaigns : []);
  }, [genomeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byId = useMemo(() => new Map((campaigns ?? []).map((c) => [c.campaignId, c])), [campaigns]);

  return { campaigns, byId, reload };
}

/** Running first, then drafts and paused, newest first within each; ended last. */
export function orderCampaigns(list: readonly CampaignInfo[]): CampaignInfo[] {
  const rank: Record<string, number> = { active: 0, draft: 1, paused: 2, completed: 3 };
  return [...list].sort(
    (a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || b.startAt.localeCompare(a.startAt),
  );
}

/** What a campaign's state is called on screen, and the colour of its dot. */
export const CAMPAIGN_STATE: Record<string, { label: string; dot: string }> = {
  active: { label: 'Running', dot: '#13D711' },
  draft: { label: 'Draft', dot: '#FFB453' },
  paused: { label: 'Paused', dot: '#838383' },
  completed: { label: 'Ended', dot: 'rgba(131,131,131,0.5)' },
};
