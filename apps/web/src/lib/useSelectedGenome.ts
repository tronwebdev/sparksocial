'use client';

import { useEffect, useState } from 'react';
import { invoke } from './tools';

/**
 * Which genome the brand switcher has selected — the `spark_genome` cookie's
 * client-side reading, so every panel that needs a `genomeId` in its own
 * tool input (unlike `agent.*`, which reads `ctx.genomeId` off the request
 * automatically) resolves it the same way `CalendarBoard` first did, rather
 * than re-implementing the cookie parse and the "no cookie yet, fall back to
 * the first genome" rule per component.
 */

export interface SelectedGenome {
  genomeId: string;
  name: string;
}

export interface UseSelectedGenome {
  genome: SelectedGenome | null;
  loading: boolean;
  error: string | null;
}

export function useSelectedGenome(): UseSelectedGenome {
  const [genome, setGenome] = useState<SelectedGenome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await invoke<{ genomes: SelectedGenome[] }>('genome.list', {});
      if (cancelled) return;
      if (res.status !== 'succeeded' || res.output.genomes.length === 0) {
        setError(res.status === 'failed' ? res.error.message : 'No brands yet.');
        setLoading(false);
        return;
      }
      const cookie = document.cookie.match(/(?:^|;\s*)spark_genome=([^;]+)/)?.[1];
      const selected =
        res.output.genomes.find((g) => g.genomeId === (cookie ? decodeURIComponent(cookie) : '')) ??
        res.output.genomes[0]!;
      setGenome(selected);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { genome, loading, error };
}
