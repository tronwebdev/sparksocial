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
 * ── The handoff rule applies itself ──────────────────────────────────────
 *
 * `engage.opportunity.create` reads the brand's Sales Assist configuration and
 * routes the lead itself when the rule for that temperature says `crm_notify`
 * and a destination is set. It returns `handoff` (which rule applied) and
 * `routedTo` (where it went, when it went anywhere).
 *
 * So this card's job after raising is to *report* that, not to ask again. The
 * manual box stays, because two of the three rules — `save_notify` and
 * `nurture_only` — deliberately leave the lead in this tab, and somebody may
 * still want to send one of those on by hand.
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
  /** Which of the three rules applied, from `create`'s own answer. */
  const [handoff, setHandoff] = useState<string | null>(null);
  /** True when the rule routed it, rather than a person doing so afterwards. */
  const [routedByRule, setRoutedByRule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!recommendedAction.trim()) return;
    setBusy(true);
    setError(null);
    // idempotent: false — "calling twice creates a duplicate, not a refresh"
    // (packages/engage/src/opportunity.ts), so each click needs its own key.
    const res = await invoke<{ opportunityId: string; handoff: string; routedTo?: string }>(
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
    setHandoff(res.output.handoff);
    // When the rule routed it, say so instead of offering the box again.
    if (res.output.routedTo) {
      setRoutedAs(res.output.routedTo);
      setRoutedByRule(true);
    }
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="success">Opportunity raised</Badge>
        <span className="text-[13px] text-ink-muted">
          {routedByRule
            ? /* Naming the rule matters: the next question anybody asks is
                 "why there", and the answer is a setting they can change. */
              `Sent to ${routedAs} — this brand routes ${temperature} leads on automatically`
            : `Routed to ${routedAs}`}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded border border-border bg-surface-muted p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">Opportunity raised</Badge>
        <span className="text-[12px] text-ink-muted">{temperature}</span>
      </div>
      {/* Why it is still here. `nurture_only` and `save_notify` both mean "keep
          it in this tab", and `crm_notify` reaching this branch means the rule
          wanted to send it but no destination is configured — which is worth
          saying, because it looks identical to "kept deliberately". */}
      {handoff === 'crm_notify' ? (
        <p className="mt-1.5 text-[12px] text-warn">
          This brand sends {temperature} leads on, but no destination is set — add one in Settings, or route
          it by hand below.
        </p>
      ) : handoff ? (
        <p className="mt-1.5 text-[12px] text-ink-muted">
          This brand keeps {temperature} leads here. Route it by hand if this one is different.
        </p>
      ) : null}
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
