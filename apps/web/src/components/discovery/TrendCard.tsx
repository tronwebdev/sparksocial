'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';

export interface RankedTrendItem {
  trendId: string;
  source: string;
  topic: string;
  score: number;
  relevance: number;
  opportunity: number;
  metrics: { volume: number; velocity: number; saturation: number; growth: number };
  factors: Array<{ label: string; detail: string; weight?: number }>;
}

export interface WatchlistTrendItem {
  trendId: string;
  source: string;
  topic: string;
  note?: string;
  createdAt: string;
}

interface RepurposeSuggestion {
  playbookId: string;
  playbookName: string;
  pillar: string;
  intent: string;
  unlockable: boolean;
  missingRoles: string[];
}

/**
 * One trend on the Discovery feed — the score/opportunity/relevance
 * breakdown `trend.rank` already computed, plus the two actions that turn
 * "interesting" into "actionable": watch it, or ask for a repurpose
 * suggestion (`trend.repurpose`, read-only — see that tool's own comment on
 * why it doesn't create a draft itself).
 */
export function TrendCard({
  trend,
  genomeId,
  onWatchChanged,
}: {
  trend: RankedTrendItem;
  genomeId: string;
  onWatchChanged?: (trendId: string, watched: boolean) => void;
}) {
  const [watching, setWatching] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<RepurposeSuggestion | null | undefined>(undefined);
  const [repurposeBusy, setRepurposeBusy] = useState(false);
  const [repurposeError, setRepurposeError] = useState<string | null>(null);

  async function toggleWatch() {
    if (watchBusy) return;
    setWatchBusy(true);
    const action = watching ? 'remove' : 'add';
    const res = await invoke('trend.watchlist', { genomeId, action, trendId: trend.trendId, topic: trend.topic });
    setWatchBusy(false);
    if (res.status !== 'succeeded') return;
    setWatching(!watching);
    onWatchChanged?.(trend.trendId, !watching);
  }

  async function repurpose() {
    if (repurposeBusy) return;
    setRepurposeBusy(true);
    setRepurposeError(null);
    const res = await invoke<{ suggestion: RepurposeSuggestion | null; why: { summary: string } }>(
      'trend.repurpose',
      { genomeId, trendId: trend.trendId },
    );
    setRepurposeBusy(false);
    if (res.status !== 'succeeded') {
      setRepurposeError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setSuggestion(res.output.suggestion);
    if (!res.output.suggestion) setRepurposeError(res.output.why.summary);
  }

  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">{trend.topic}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="neutral" className="capitalize">{trend.source}</Badge>
            <Badge variant={trend.score >= 0.5 ? 'success' : 'neutral'}>{Math.round(trend.score * 100)}% match</Badge>
          </div>
        </div>
        <Button size="sm" variant={watching ? 'outline' : 'ghost'} disabled={watchBusy} onClick={() => void toggleWatch()}>
          {watching ? 'Watching' : 'Watch'}
        </Button>
      </div>

      <ul className="mt-2 grid grid-cols-1 gap-0.5">
        {trend.factors.slice(0, 2).map((f, i) => (
          <li key={i} className="text-[13px] text-ink-muted">
            <span className="capitalize text-ink">{f.label}:</span> {f.detail}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={repurposeBusy} onClick={() => void repurpose()}>
          {repurposeBusy ? 'Thinking…' : 'Suggest a post'}
        </Button>
      </div>

      {suggestion ? (
        <div className="mt-3 rounded border border-border bg-surface-muted p-3">
          <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
            Suggested — {suggestion.playbookName}
          </p>
          <p className="mt-1 text-[14px] text-ink">{suggestion.intent}</p>
          {suggestion.unlockable ? (
            <p className="mt-1 text-[12px] text-warn">Needs {suggestion.missingRoles.join(', ')} first.</p>
          ) : null}
        </div>
      ) : null}
      {repurposeError ? <p className="mt-2 text-[13px] text-ink-muted">{repurposeError}</p> : null}
    </li>
  );
}
