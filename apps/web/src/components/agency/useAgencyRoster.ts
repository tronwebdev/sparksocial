'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import type { Explanation } from '@/components/explain/WhyPopover';

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
      setError(res.status === 'failed' ? res.error.message : 'Reading the roster needs an approval.');
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
 * The connected publishing accounts, for the home card's chip row.
 *
 * `integration.health` rather than anything agency-specific: the chips in the
 * design are the accounts posts go out through, which is exactly what that
 * read answers.
 */
export function useConnectedAccounts() {
  const [accounts, setAccounts] = useState<Array<{ platform: string; label: string }>>([]);

  useEffect(() => {
    void (async () => {
      const res = await invoke<{
        platforms: Array<{ platform: string; connected: boolean; accountLabel?: string }>;
      }>('integration.health', {});
      if (res.status !== 'succeeded') return;
      setAccounts(
        res.output.platforms
          .filter((p) => p.connected)
          .map((p) => ({ platform: p.platform, label: p.accountLabel ?? p.platform })),
      );
    })();
  }, []);

  return accounts;
}
