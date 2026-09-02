'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { openAskSpark } from '@/lib/askSpark';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { SparkRail } from './SparkRail';

/**
 * What the Spark rail needs to know, fetched once for the rail itself.
 *
 * The rail is rendered by `CommandCenterShell` — it stands beside three of the
 * four tabs, so it cannot take its state as props from any one of them without
 * every tab having to thread it through. It reads `agent.status` and
 * `campaign.list` here instead.
 *
 * That does duplicate two calls the Overview already makes. The alternative is
 * lifting all of the Overview's state into the page and passing it down two
 * branches, which couples the Calendar and Performance tabs to data they do not
 * use. Two cached GET-shaped tool calls is the cheaper wrong thing, and it is
 * the reason the pause button here refreshes through `onChanged` rather than
 * assuming its own optimistic state.
 *
 * Ask Spark opens the drawer the Overview owns, through the same
 * `openAskSpark` channel the chrome's button uses — not a second `ChatDrawer`.
 */

interface Campaign {
  campaignId: string;
  name: string;
  status: string;
}

export function SparkRailContainer() {
  const { genome } = useSelectedGenome();
  const genomeId = genome?.genomeId;

  const [paused, setPaused] = useState(false);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [status, campaigns] = await Promise.all([
      invoke<{ paused: boolean }>('agent.status', {}),
      genomeId
        ? invoke<{ campaigns: Campaign[] }>('campaign.list', { genomeId, limit: 5 })
        : Promise.resolve(null),
    ]);

    if (status.status === 'succeeded') setPaused(status.output.paused);
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
  }, [load]);

  async function togglePause() {
    if (busy) return;
    setBusy(true);
    await invoke(paused ? 'agent.resume' : 'agent.pause', {});
    setBusy(false);
    void load();
  }

  return (
    <SparkRail
      paused={paused}
      campaign={campaign ? { name: campaign.name, status: campaign.status } : null}
      onOpenChat={() => openAskSpark()}
      onTogglePause={() => void togglePause()}
      busy={busy}
    />
  );
}
