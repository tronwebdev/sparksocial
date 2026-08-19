'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';
import type { EngagementItem } from './EngagementFeed';

/**
 * `engage.opportunity.create` / `.route` — Sales Opportunities tab only
 * (`EngagementFeed` renders this sibling to `ReplyAction` just on that tab).
 *
 * Deliberately local, in-memory state rather than a read from the store:
 * `engage.list` has no opportunity fields on a message (a message can be
 * classified `sales_opportunity` without ever having one raised), so this
 * component tracks "did I just raise one" itself for the session rather than
 * adding a lookup this feed doesn't otherwise need. Reloading the tab loses
 * that local state — a reasonable simplification for a first pass; the
 * opportunity itself is not lost, just this card's "already raised" hint.
 */

type Temperature = 'hot' | 'warm' | 'cold';

export function OpportunityActions({ item, genomeId }: { item: EngagementItem; genomeId: string }) {
  const [opportunityId, setOpportunityId] = useState<string | null>(null);
  const [temperature, setTemperature] = useState<Temperature>('warm');
  const [recommendedAction, setRecommendedAction] = useState('');
  const [routedTo, setRoutedTo] = useState('');
  const [routedAs, setRoutedAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!recommendedAction.trim()) return;
    setBusy(true);
    setError(null);
    // idempotent: false — "calling twice creates a duplicate, not a refresh"
    // (packages/engage/src/opportunity.ts), so each click needs its own key.
    const res = await invoke<{ opportunityId: string }>(
      'engage.opportunity.create',
      {
        genomeId,
        messageId: item.id,
        temperature,
        recommendedAction: recommendedAction.trim(),
      },
      crypto.randomUUID(),
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setOpportunityId(res.output.opportunityId);
  }

  async function route() {
    if (!opportunityId || !routedTo.trim()) return;
    setBusy(true);
    setError(null);
    const res = await invoke<{ routedTo: string }>('engage.opportunity.route', {
      genomeId,
      opportunityId,
      routedTo: routedTo.trim(),
    });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setRoutedAs(res.output.routedTo);
  }

  if (!opportunityId) {
    return (
      <div className="mt-3 rounded border border-border bg-surface-muted p-3">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">Raise as an opportunity</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={temperature}
            onChange={(e) => setTemperature(e.target.value as Temperature)}
            disabled={busy}
            className="h-9 rounded border border-border bg-surface px-2 text-[13px] text-ink disabled:opacity-50"
            aria-label="Temperature"
          >
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </select>
          <input
            value={recommendedAction}
            onChange={(e) => setRecommendedAction(e.target.value)}
            disabled={busy}
            placeholder="Recommended action, e.g. Call within the hour"
            className="h-9 min-w-[220px] flex-1 rounded border border-border bg-surface px-3 text-[13px] text-ink placeholder:text-ink-placeholder disabled:opacity-50"
          />
          <Button size="sm" disabled={busy || !recommendedAction.trim()} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create opportunity'}
          </Button>
        </div>
        {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
      </div>
    );
  }

  if (routedAs) {
    return (
      <div className="mt-3 flex items-center gap-2">
        <Badge variant="success">Opportunity raised</Badge>
        <span className="text-[13px] text-ink-muted">Routed to {routedAs}</span>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded border border-border bg-surface-muted p-3">
      <div className="flex items-center gap-2">
        <Badge variant="success">Opportunity raised</Badge>
        <span className="text-[12px] text-ink-muted">{temperature}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={routedTo}
          onChange={(e) => setRoutedTo(e.target.value)}
          disabled={busy}
          placeholder="Route to — a person, email, or CRM reference"
          className="h-9 min-w-[220px] flex-1 rounded border border-border bg-surface px-3 text-[13px] text-ink placeholder:text-ink-placeholder disabled:opacity-50"
        />
        <Button size="sm" variant="outline" disabled={busy || !routedTo.trim()} onClick={() => void route()}>
          {busy ? 'Routing…' : 'Route'}
        </Button>
      </div>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}
