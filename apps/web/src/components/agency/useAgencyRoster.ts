'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import type { Explanation } from '@/components/explain/WhyPopover';
import { userMessage } from '@/lib/errorCopy';
import { platformLabel } from '@/lib/platforms';

/**
 * `agency.roster` — one row per brand in the organisation, over a trailing
 * window, plus the org totals the header would otherwise have to sum itself.
 *
 * 30 days to match the campaign window the rest of the product plans in, which
 * is the tool's own default and the reason it has one.
 */

export interface RosterBrand {
  genomeId: string;
  brandId: string;
  name: string;
  updatedAt: string;
  publishedCount: number;
  impressions: number;
  engagements: number;
  /** True when nothing published in the window — the cell an agency opens this for. */
  quiet: boolean;
  /** The genome's category label, when it has one. */
  industry?: string;
  /** People assigned to the brand; owners and admins are not counted. */
  teamMembers: number;
  /** Publishing platforms the brand has connected. */
  platforms: string[];
}

export interface Roster {
  windowDays: number;
  brands: RosterBrand[];
  totals: {
    brands: number;
    quiet: number;
    publishedCount: number;
    impressions: number;
    engagements: number;
  };
  why: Explanation;
}

export function useAgencyRoster() {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await invoke<Roster>('agency.roster', { windowDays: 30 });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? userMessage(res.error) : 'Reading the roster needs an approval.');
      setRoster(null);
      return;
    }
    setError(null);
    setRoster(res.output);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { roster, error, reload: load };
}

/**
 * The connected publishing accounts across every client, for the home card's
 * chip row and the wizard's summary — one chip per platform, saying how many
 * clients post through it.
 *
 * Read from the roster rather than `integration.health`. That tool answers for
 * *one selected brand*, and the Agency Portal is above any brand: on staging it
 * came back 400 "A brand must be selected" on every load, so the chips were
 * always empty. The roster already carries each brand's platforms.
 */
export function connectedAccounts(brands: RosterBrand[] | undefined): Array<{ platform: string; label: string }> {
  const count = new Map<string, number>();
  for (const b of brands ?? []) for (const p of b.platforms) count.set(p, (count.get(p) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([platform, n]) => ({ platform, label: `${platformLabel(platform)} · ${n} ${n === 1 ? 'client' : 'clients'}` }));
}
