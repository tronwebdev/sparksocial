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
/**
 * The one `limit` every `campaign.list` on a screen asks with.
 *
 * Shared reads (`readCache.ts`) only share an identical request, and the
 * Command Center asked three ways — 5, 20 and 50 — so it still made three calls
 * for one list. Callers that want fewer take this many and slice, which gives
 * them exactly the rows the smaller limit did: the limit applies after the
 * server's ordering.
 */
export const CAMPAIGN_LIST_LIMIT = 50;

export function useCampaigns(genomeId: string | undefined) {
  const [campaigns, setCampaigns] = useState<CampaignInfo[] | null>(null);

  const reload = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<{ campaigns: CampaignInfo[] }>('campaign.list', { genomeId, limit: CAMPAIGN_LIST_LIMIT });
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

/**
 * What a campaign's state is called on screen, the colour of its dot, and the
 * badge tone where it is a chip. One table, so the Current Focus card, the
 * campaign list and the calendar never disagree about what to call a state.
 */
export const CAMPAIGN_STATE: Record<
  string,
  { label: string; dot: string; tone: 'success' | 'warn' | 'neutral' }
> = {
  active: { label: 'Running', dot: '#13D711', tone: 'success' },
  draft: { label: 'Draft', dot: '#FFB453', tone: 'warn' },
  paused: { label: 'Paused', dot: '#838383', tone: 'neutral' },
  completed: { label: 'Ended', dot: 'rgba(131,131,131,0.5)', tone: 'neutral' },
};
