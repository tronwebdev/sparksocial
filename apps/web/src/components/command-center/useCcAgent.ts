'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';

/**
 * The agent state the Command Center's chrome needs: name, voice, risk
 * tolerance, paused, and how many items are waiting on a person.
 *
 * It exists because the design shows that identity twice and never at the same
 * time — the Spark rail carries it on Overview, Performance and Engagement, and
 * the Agent Calendar tab inlines it into a full-width banner because it is the
 * one tab with no rail. Two components rendering the same five facts from two
 * fetches is how a screen ends up claiming the agent is both paused and active,
 * so they share this.
 *
 * `queue.review.list` is here rather than in the banner because the count feeds
 * both the Needs Attention strip and the Engagement tab's label.
 */

interface Governance {
  agentIdentity?: {
    name: string;
    named: boolean;
    voice: string[];
    riskTolerance: string;
    riskBecause: string;
  };
}

interface Campaign {
  campaignId: string;
  name: string;
  status: string;
}

export interface CcAgent {
  paused: boolean;
  name: string | null;
  voice: string[];
  riskTolerance: string;
  riskBecause: string | null;
  campaign: { name: string; status: string } | null;
  reviewCount: number;
  busy: boolean;
  reload: () => void;
  togglePause: () => Promise<void>;
}

export function useCcAgent(genomeId: string | undefined): CcAgent {
  const [paused, setPaused] = useState(false);
  const [gov, setGov] = useState<Governance | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reloads, setReloads] = useState(0);

  const load = useCallback(async () => {
    const [status, governance, campaigns, review] = await Promise.all([
      invoke<{ paused: boolean }>('agent.status', {}),
      invoke<Governance>('brand.governance.get', {}),
      genomeId
        ? invoke<{ campaigns: Campaign[] }>('campaign.list', { genomeId, limit: 5 })
        : Promise.resolve(null),
      invoke<{ items: unknown[] }>('queue.review.list', {}),
    ]);

    if (status.status === 'succeeded') setPaused(status.output.paused);
    if (governance.status === 'succeeded') setGov(governance.output);
    if (review.status === 'succeeded') setReviewCount(review.output.items.length);
    if (campaigns && campaigns.status === 'succeeded') {
      setCampaign(
        campaigns.output.campaigns.find((c) => c.status === 'active') ??
          campaigns.output.campaigns[0] ??
          null,
      );
    }
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load, reloads]);

  const togglePause = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    await invoke(paused ? 'agent.resume' : 'agent.pause', {});
    setBusy(false);
    setReloads((n) => n + 1);
  }, [busy, paused]);

  const id = gov?.agentIdentity;

  return {
    paused,
    name: id?.named ? id.name : null,
    voice: id?.voice ?? [],
    riskTolerance: id?.riskTolerance ?? 'Moderate',
    riskBecause: id?.riskBecause ?? null,
    campaign: campaign ? { name: campaign.name, status: campaign.status } : null,
    reviewCount,
    busy,
    reload: () => setReloads((n) => n + 1),
    togglePause,
  };
}
