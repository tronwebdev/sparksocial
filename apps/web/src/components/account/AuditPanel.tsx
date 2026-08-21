'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';

/**
 * `SET-ORG-01` / §10 — the audit log.
 *
 * Two tools, two genuinely different questions, so two tabs rather than one
 * merged stream. **`org.audit.query`** is every tool call in the org: what
 * happened, whether policy allowed it, what it cost. **`engage.audit.query`** is
 * every resolved engagement action — the one §10 names specifically, because
 * *"engagement misfires"* is the risk whose mitigation is *"audit logs"*, and a
 * reply that went out is not the same kind of event as a render that was billed.
 *
 * ── Why filters were the actual work here ─────────────────────────────────
 *
 * The data has been complete and dense since P1: every call writes a row for
 * every outcome, denials included. A table dump of the last hundred rows is
 * therefore easy and close to useless — nobody opens an audit log to browse. The
 * questions people bring to it are "what did SPARK do to *this*", "what got
 * refused", and "what did *that day* look like", so the tool filter, the
 * refusals-only toggle and the date range are the feature; the table is the part
 * that came free.
 *
 * ── Refusals are the interesting rows, and they read as normal ────────────
 *
 * A denied or held call sits in the same list as a successful one and, without
 * colour, looks identical. It is the opposite: a denial is the governance layer
 * doing its job and the single most useful thing on this screen. So decisions
 * that were not `allow` are tinted and carry their `ruleId` — the policy rule
 * that fired, which is what turns "blocked" into something actionable.
 *
 * `org.audit.query` refuses an unfiltered sweep above 200 rows (its own soft
 * guard), which is why the limit control stops where it does rather than
 * offering a number the tool will reject.
 */

interface AuditCall {
  id: string;
  tool: string;
  caller: 'user' | 'agent';
  decision: string;
  status: string;
  costCents: number;
  at: string;
  ruleId?: string;
  reason?: string;
}

interface EngageAuditItem {
  id: string;
  platform: string;
  kind: string;
  authorHandle: string;
  authorName?: string;
  text: string;
  receivedAt: string;
  status: string;
  category?: string;
  intentScore?: number;
  suggestedReply?: string;
  why?: Explanation;
}

/** The tool's own ceiling for an unfiltered sweep. Offering 500 here would just produce an INVALID_INPUT. */
const LIMITS = [50, 100, 200] as const;

const money = (cents: number) => (cents === 0 ? '—' : `$${(cents / 100).toFixed(2)}`);

/**
 * `allow` is the uninteresting case, so a real refusal gets the colour.
 *
 * `not_evaluated` deliberately does not: it means the call failed before the
 * policy gate — a schema rejection, a missing idempotency key — and colouring it
 * like a governance refusal is exactly the conflation this panel used to show.
 * A typo is not the governance layer doing its job.
 */
function decisionTone(decision: string): 'success' | 'warn' | 'destructive' | 'neutral' {
  if (decision === 'allow' || decision === 'not_evaluated') return 'neutral';
  if (decision === 'deny') return 'destructive';
  return 'warn';
}

/** Reads as what it is, rather than as a policy verdict nobody made. */
const DECISION_LABEL: Record<string, string> = { not_evaluated: 'rejected before policy' };

export function AuditPanel() {
  const { genome } = useSelectedGenome();
  const [tab, setTab] = useState<'calls' | 'engagement'>('calls');

  const [calls, setCalls] = useState<AuditCall[] | null>(null);
  const [engagement, setEngagement] = useState<EngageAuditItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [tool, setTool] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [limit, setLimit] = useState<number>(100);
  const [refusalsOnly, setRefusalsOnly] = useState(false);

  /** A date input gives `YYYY-MM-DD`; both tools want a full ISO datetime. */
  const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
  const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (tab === 'calls') {
      const res = await invoke<{ calls: AuditCall[] }>('org.audit.query', {
        ...(tool.trim() ? { tool: tool.trim() } : {}),
        ...(dayStart(since) ? { since: dayStart(since) } : {}),
        ...(dayEnd(until) ? { until: dayEnd(until) } : {}),
        limit,
      });
      setLoading(false);
      if (res.status === 'succeeded') setCalls(res.output.calls);
      else setError(res.status === 'failed' ? res.error.message : 'Only an owner or admin can read the audit log.');
      return;
    }

    if (!genome) {
      setLoading(false);
      setError('Pick a brand to see its engagement history.');
      return;
    }
    const res = await invoke<{ items: EngageAuditItem[] }>('engage.audit.query', {
      genomeId: genome.genomeId,
      ...(dayStart(since) ? { since: dayStart(since) } : {}),
      ...(dayEnd(until) ? { until: dayEnd(until) } : {}),
      limit: Math.min(limit, 200),
    });
    setLoading(false);
    if (res.status === 'succeeded') setEngagement(res.output.items);
    else setError(res.status === 'failed' ? res.error.message : 'That request was held for review.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tool, since, until, limit, genome]);

  useEffect(() => {
    void load();
  }, [load]);

  // `not_evaluated` is excluded from "refusals only" for the same reason it is
  // not tinted: the point of that toggle is to find what governance stopped, and
  // a malformed request was stopped by a schema.
  const shown = refusalsOnly
    ? (calls ?? []).filter((c) => c.decision !== 'allow' && c.decision !== 'not_evaluated')
    : (calls ?? []);

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">Audit log</h2>
          <p className="mt-1 max-w-prose text-[14px] text-ink-muted">
            Everything SPARK and everybody else did, including what was refused and why. Inputs and outputs are
            never recorded — only what happened.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      <div className="mt-4 flex gap-1" role="tablist" aria-label="Audit view">
        {(
          [
            ['calls', 'Every action'],
            ['engagement', 'Replies and escalations'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-full border px-3 py-1.5 text-[13px] ${
              tab === id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-ink hover:bg-surface-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Filters. The feature, not the table. ────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {tab === 'calls' ? (
          <div className="min-w-[180px]">
            <label className="block text-[12px] text-ink-muted" htmlFor="audit-tool">
              Tool
            </label>
            <Input
              id="audit-tool"
              value={tool}
              onChange={(e) => setTool(e.target.value)}
              placeholder="publish.now"
              className="mt-1"
            />
          </div>
        ) : null}
        <div>
          <label className="block text-[12px] text-ink-muted" htmlFor="audit-since">
            From
          </label>
          <Input id="audit-since" type="date" value={since} onChange={(e) => setSince(e.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="block text-[12px] text-ink-muted" htmlFor="audit-until">
            To
          </label>
          <Input id="audit-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="block text-[12px] text-ink-muted" htmlFor="audit-limit">
            Rows
          </label>
          <select
            id="audit-limit"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink"
          >
            {LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        {tab === 'calls' ? (
          <label className="flex items-center gap-2 pb-2 text-[13px] text-ink">
            <input type="checkbox" checked={refusalsOnly} onChange={(e) => setRefusalsOnly(e.target.checked)} />
            Refusals only
          </label>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

      {/* ── Every action ────────────────────────────────────────────────── */}
      {tab === 'calls' ? (
        <div className="mt-4">
          {calls === null && !error ? (
            <Skeleton className="h-48 w-full rounded-lg" />
          ) : shown.length === 0 ? (
            <p className="text-[14px] text-ink-muted">
              {refusalsOnly ? 'Nothing was refused in this range — which is the good outcome.' : 'No calls in this range.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Tool</th>
                    <th className="py-2 pr-3 font-medium">By</th>
                    <th className="py-2 pr-3 font-medium">Decision</th>
                    <th className="py-2 pr-3 font-medium">Result</th>
                    <th className="py-2 pr-3 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr
                      key={c.id}
                      className={`border-b border-rule-soft ${
                        c.decision !== 'allow' && c.decision !== 'not_evaluated' ? 'bg-warn/5' : ''
                      }`}
                    >
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-ink-muted">
                        {new Date(c.at).toLocaleString('en', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[12px] text-ink">{c.tool}</td>
                      <td className="py-2 pr-3 text-ink-muted">{c.caller === 'agent' ? 'SPARK' : 'a person'}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={decisionTone(c.decision)}>{DECISION_LABEL[c.decision] ?? c.decision}</Badge>
                        {c.ruleId ? (
                          <span className="ml-2 font-mono text-[11px] text-ink-muted">{c.ruleId}</span>
                        ) : null}
                        {c.reason ? <p className="mt-0.5 text-[12px] text-ink-muted">{c.reason}</p> : null}
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">{c.status}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-muted">{money(c.costCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {/* ── Replies and escalations ─────────────────────────────────────── */}
      {tab === 'engagement' ? (
        <div className="mt-4">
          {engagement === null && !error ? (
            <Skeleton className="h-48 w-full rounded-lg" />
          ) : (engagement ?? []).length === 0 ? (
            <p className="text-[14px] text-ink-muted">Nothing has been replied to, escalated or dismissed in this range.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2">
              {(engagement ?? []).map((m) => (
                <li key={m.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[13px] font-medium text-ink">
                      {m.authorName ?? m.authorHandle}{' '}
                      <span className="font-normal text-ink-muted">
                        on {m.platform} · {m.kind.replace(/_/g, ' ')}
                      </span>
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      {m.category ? <Badge variant="neutral">{m.category}</Badge> : null}
                      <Badge variant={m.status === 'escalated' ? 'warn' : 'success'}>{m.status.replace(/_/g, ' ')}</Badge>
                      <span className="text-[12px] text-ink-muted">
                        {new Date(m.receivedAt).toLocaleDateString('en', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted">{m.text}</p>
                  {m.suggestedReply ? (
                    <p className="mt-1 text-[12px] text-ink-muted">
                      <span className="font-medium text-ink">Sent:</span> {m.suggestedReply}
                    </p>
                  ) : null}
                  {m.why ? <WhyPopover why={m.why} /> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
