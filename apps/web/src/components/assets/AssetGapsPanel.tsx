'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { WhyPopover } from '@/components/explain/WhyPopover';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { ASSET_ROLES } from './roles';

/**
 * `asset.gaps` — real since P2 (§4.4), reached from no screen until now. The
 * tool's own doc comment is explicit that this belongs "surfaced
 * conversationally... never as a bare error" — this panel is that surface.
 */

interface Gap {
  missingRole: string;
  /** `'upload'` — a file. `'capture'` — a shoot. The effort, which is the deciding fact. */
  unlockedBy: 'upload' | 'capture';
  playbooksBlocked: string[];
  impact: string;
}

interface GapsOutput {
  gaps: Gap[];
  producibleNow: number;
  producibleIfFilmed: number;
  why: { summary: string };
}

export function AssetGapsPanel({ refreshKey }: { refreshKey: number }) {
  const { genome } = useSelectedGenome();
  const [data, setData] = useState<GapsOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!genome) return;
    setData(null);
    void (async () => {
      const res = await invoke<GapsOutput>('asset.gaps', { genomeId: genome.genomeId });
      if (res.status === 'succeeded') {
        setData(res.output);
        setError(null);
      } else {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      }
    })();
  }, [genome, refreshKey]);

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">What's missing</h2>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
      {data === null && !error ? (
        <Skeleton className="mt-3 h-16 w-full rounded-xl" />
      ) : data ? (
        <>
          <p className="mt-2 text-[14px] text-ink">{data.why.summary}</p>
          <WhyPopover why={data.why} label="Which formats this unblocks" />
          {data.gaps.length > 0 ? (
            <ul className="mt-3 grid grid-cols-1 gap-2">
              {data.gaps.map((g) => (
                /* The route is a chip rather than more prose, because the list is
                   scanned for "which of these can I do right now" and the answer
                   should not have to be read out of a sentence. Amber for a shoot
                   is not a warning — it is the more expensive of two good
                   options, and it should look different from the one-minute one. */
                <li key={g.missingRole} className="rounded border border-border p-3 text-[13px]">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-medium text-ink">
                      {ASSET_ROLES.find((r) => r.value === g.missingRole)?.label ?? g.missingRole}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        g.unlockedBy === 'upload'
                          ? 'bg-success/10 text-success'
                          : 'bg-warn/10 text-warn'
                      }`}
                    >
                      {g.unlockedBy === 'upload' ? 'upload a file' : 'needs filming'}
                    </span>
                    <span className="text-ink-muted">— blocks {g.impact}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
