'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { ASSET_ROLES } from './roles';
import { AssetDetailPanel, type DetailAsset } from './AssetDetailPanel';

/**
 * `asset.retrieve` — real since P2, reached from no screen until now.
 *
 * There is no "list every asset" tool: retrieval is intent-scored by design
 * (§4.3), never a bare table scan. A browsing screen has no natural intent to
 * search with, so this defaults to the brand name — broad enough to surface
 * most of the library — and always offers the role filter (`requiredRoles`)
 * as the more reliable way to narrow it. Worth stating plainly rather than
 * pretending this is a generic list view wearing a search box.
 */

interface RetrievedAsset {
  assetId: string;
  role: string;
  caption: string | null;
  embeddingScore: number;
  usageCount: number;
  lastUsedAt: string | null;
  rightsStatus: string;
  folderId: string | null;
}

export function AssetSearchGrid({ refreshKey }: { refreshKey: number }) {
  const { genome } = useSelectedGenome();
  const [intent, setIntent] = useState('');
  const [role, setRole] = useState('');
  const [results, setResults] = useState<RetrievedAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DetailAsset | null>(null);

  const search = useCallback(async () => {
    if (!genome) return;
    setResults(null);
    const res = await invoke<{ results: RetrievedAsset[] }>('asset.retrieve', {
      genomeId: genome.genomeId,
      intent: intent.trim() || genome.name,
      ...(role ? { requiredRoles: [role] } : {}),
      k: 24,
    });
    if (res.status === 'succeeded') {
      setResults(res.output.results);
      setError(null);
    } else {
      setResults([]);
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
    }
  }, [genome, intent, role]);

  useEffect(() => {
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genome, refreshKey]);

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid grid-cols-1 min-w-[200px] flex-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="asset-intent">
            What are you looking for
          </label>
          <input
            id="asset-intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder={genome ? `e.g. ${genome.name} storefront` : 'e.g. storefront photo'}
            className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink placeholder:text-ink-placeholder"
          />
        </div>
        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="asset-role-filter">
            Role
          </label>
          <select
            id="asset-role-filter"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink"
          >
            <option value="">Any role</option>
            {ASSET_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => void search()}
          className="h-10 rounded border border-border px-4 text-[14px] font-medium text-ink hover:bg-surface-muted"
        >
          Search
        </button>
      </div>

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

      <div className="mt-5">
        {results === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <p className="text-[13px] text-ink-muted">
            Nothing matched. Upload something above, or broaden the search.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {results.map((a) => (
              <li key={a.assetId}>
                <button
                  type="button"
                  onClick={() => setSelected(a)}
                  className="w-full rounded-xl border border-border p-3 text-left hover:border-ring hover:bg-surface-muted"
                >
                  <p className="line-clamp-3 text-[13px] text-ink">{a.caption ?? '(no caption)'}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="neutral">{ASSET_ROLES.find((r) => r.value === a.role)?.label ?? a.role}</Badge>
                    <Badge variant={a.rightsStatus === 'cleared' ? 'success' : 'warn'}>{a.rightsStatus}</Badge>
                  </div>
                  <p className="mt-2 text-[11px] text-ink-muted">
                    used {a.usageCount}× · score {a.embeddingScore.toFixed(2)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AssetDetailPanel
        asset={selected}
        genomeId={genome?.genomeId ?? ''}
        open={selected !== null}
        onClose={() => setSelected(null)}
        onChanged={() => void search()}
      />
    </section>
  );
}
