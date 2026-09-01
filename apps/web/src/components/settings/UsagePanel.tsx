'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { toolLabel } from '@sparksocial/shared/toolLabel';
import { CREDIT_CATEGORY_HINT, creditsToCents } from '@sparksocial/shared/credits';
import type { CreditCategory } from '@sparksocial/shared/credits';
import { cn } from '@/lib/utils';

/**
 * `SET-WS-CREDIT-USAGE` — the Credit & Usage screen.
 *
 * Costs have been recorded on every paid tool since P1 and there was nothing
 * that read them back: a balance only ever came out of `org.credits.grant`, so
 * showing spend meant granting credits to render a number. This is the read, and
 * now also the write.
 *
 * ── Why the breakdown leads and the bar does not ───────────────────────────
 *
 * A progress bar answers "how much is left", which matters once a month. The
 * breakdown answers "what is this costing me", which is the question §12
 * actually asks — *"what consumes credits"* — and the one that changes what
 * somebody does next. An avatar video is 50¢ and a dub is 60¢, so a fortnight of
 * enthusiasm with either is visible here and nowhere else in the product.
 *
 * ── Why the limits are editable here and not on their own screen ───────────
 *
 * A per-category limit is only meaningful next to what that category has spent.
 * On its own screen it is a form full of numbers with nothing to judge them
 * against, and the first thing anybody would do is open this page in a second
 * tab. Editing in place also keeps one copy of the state: saving re-reads usage,
 * so the bars cannot show a limit the server did not accept.
 */

interface ToolSpend {
  tool: string;
  costCents: number;
  calls: number;
  share: number;
}

interface CategorySpend {
  category: CreditCategory;
  label: string;
  costCents: number;
  credits: number;
  calls: number;
  share: number;
  unavailable: boolean;
  allocationCents?: number;
  allocationCredits?: number;
  allocationUsedFraction?: number;
  paused: boolean;
}

interface Usage {
  monthlyCapCents: number;
  monthlyCapCredits: number;
  spentCents: number;
  spentCredits: number;
  remainingCents: number;
  remainingCredits: number;
  usedFraction: number;
  alert: 'ok' | 'warning' | 'critical' | 'exhausted';
  byTool: ToolSpend[];
  byCategory: CategorySpend[];
  forecastCents?: number;
  forecastCredits?: number;
  forecastOverCap: boolean;
  periodStart: string;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const credits = (n: number) => n.toLocaleString('en');

/** The bar and the badge share one mapping, so they cannot disagree about severity. */
const ALERT: Record<Usage['alert'], { bar: string; badge: 'success' | 'warn' | 'neutral'; label: string }> = {
  ok: { bar: 'bg-success', badge: 'success', label: 'Healthy' },
  warning: { bar: 'bg-warn', badge: 'warn', label: 'Half spent' },
  critical: { bar: 'bg-warn', badge: 'warn', label: 'Nearly gone' },
  exhausted: { bar: 'bg-destructive', badge: 'neutral', label: 'Spent' },
};

export function UsagePanel() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const res = await invoke<Usage>('org.usage.get', { topTools: 8 });
    if (res.status === 'succeeded') {
      setUsage(res.output);
      setError(null);
      return;
    }
    setError(res.status === 'failed' ? res.error.message : 'Usage is only visible to owners and admins.');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="text-[18px] font-semibold text-ink">This month&rsquo;s spend</h2>
        <p className="mt-2 text-[14px] text-ink-muted">{error}</p>
      </section>
    );
  }

  if (!usage) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="text-[18px] font-semibold text-ink">This month&rsquo;s spend</h2>
        <Skeleton className="mt-4 h-32 w-full rounded-lg" />
      </section>
    );
  }

  const tone = ALERT[usage.alert];

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">This month&rsquo;s spend</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Since{' '}
            {new Date(usage.periodStart).toLocaleDateString('en', { day: 'numeric', month: 'long' })}. Paid
            tools stop working when the limit is reached.
          </p>
        </div>
        <Badge variant={tone.badge}>{tone.label}</Badge>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[22px] font-medium tabular-nums text-ink">
            {credits(usage.spentCredits)}{' '}
            <span className="text-[15px] text-ink-muted">/ {credits(usage.monthlyCapCredits)} credits</span>
          </p>
          <p className="text-[13px] tabular-nums text-ink-muted">
            {credits(usage.remainingCredits)} left &middot; {money(usage.spentCents)} of{' '}
            {money(usage.monthlyCapCents)}
          </p>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-valuenow={Math.round(usage.usedFraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Credit spend this month"
        >
          <span
            className={cn('block h-full rounded-full', tone.bar)}
            style={{ width: `${Math.round(usage.usedFraction * 100)}%` }}
          />
        </div>
        {usage.forecastCents !== undefined && (
          /* Straight-line, and it says so. A brand ten days into a month has ten
             days of history, and a confident curve drawn through it would be a
             guess wearing a model's clothes. */
          <p className={cn('mt-2 text-[12px]', usage.forecastOverCap ? 'text-warn' : 'text-ink-muted')}>
            {usage.forecastOverCap
              ? `At this rate you will pass the limit by ${credits(
                  (usage.forecastCredits ?? 0) - usage.monthlyCapCredits,
                )} credits before the month ends.`
              : `At this rate the month ends around ${credits(usage.forecastCredits ?? 0)} credits.`}
          </p>
        )}
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-medium text-ink">By kind of work</h3>
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Adjust limits'}
          </Button>
        </div>

        {editing ? (
          <LimitEditor
            usage={usage}
            onDone={async () => {
              setEditing(false);
              await load();
            }}
          />
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-3">
            {usage.byCategory.map((c) => (
              <CategoryRow key={c.category} category={c} spentCents={usage.spentCents} />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6">
        <h3 className="text-[13px] font-medium text-ink">Where it went</h3>
        {usage.byTool.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-ink-muted">Nothing charged yet this month.</p>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-2">
            {usage.byTool.map((t) => (
              <li key={t.tool} className="flex items-center gap-3">
                {/* What the credits went on, in words. `content.generate_avatar_video`
                    is the most expensive tool in the product and the least legible
                    line on a bill. */}
                <span className="w-52 shrink-0 truncate text-[12px] text-ink" title={t.tool}>
                  {toolLabel(t.tool)}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.round(t.share * 100)}%` }}
                  />
                </span>
                <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-ink">
                  {money(t.costCents)}
                </span>
                <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-ink-muted">
                  {t.calls} {t.calls === 1 ? 'call' : 'calls'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * One category row.
 *
 * Three states, deliberately distinguishable: no limit set (bounded only by the
 * monthly limit), a limit with room, and a limit that is spent — which is a real
 * refusal, not a warning, because `policy.ts` denies the call.
 *
 * `unavailable` is its own state again. A zero that means "nothing here charges
 * yet" is a different fact from one that means "you spent nothing", and a
 * workspace deciding whether its allocation is wrong needs to be able to tell
 * them apart.
 */
function CategoryRow({ category: c, spentCents }: { category: CategorySpend; spentCents: number }) {
  const bounded = c.allocationCents !== undefined;
  const fraction = bounded ? (c.allocationUsedFraction ?? 0) : spentCents > 0 ? c.share : 0;

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink">
          {c.label}
          {c.unavailable && <span className="ml-2 text-[11px] text-ink-muted">not available yet</span>}
        </span>
        <span className="text-[12px] tabular-nums text-ink-muted">
          {bounded ? `${credits(c.credits)} / ${credits(c.allocationCredits ?? 0)} cr` : `${credits(c.credits)} cr`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
        <span
          className={cn('block h-full rounded-full', c.paused ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      {c.paused ? (
        <p className="mt-1 text-[11px] text-destructive">
          Limit reached — {c.label.toLowerCase()} work is being refused until you raise it.
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-ink-muted">{CREDIT_CATEGORY_HINT[c.category]}</p>
      )}
    </li>
  );
}

/**
 * The limits form.
 *
 * Typed in credits, because that is the unit the rest of the screen shows, and
 * converted at the edge — the ledger stores cents and always will, since that is
 * what the vendors bill in.
 *
 * An empty field means **no limit**, which is why it is a separate state from
 * `0` rather than a falsy value coerced into one. Zero is "spend nothing on
 * this" and is enforced; empty is "do not bound this at all".
 */
function LimitEditor({ usage, onDone }: { usage: Usage; onDone: () => Promise<void> }) {
  const [cap, setCap] = useState(String(usage.monthlyCapCredits));
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      usage.byCategory.map((c) => [
        c.category,
        c.allocationCredits === undefined ? '' : String(c.allocationCredits),
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const allocatedCredits = Object.values(limits).reduce((n, v) => n + (v.trim() === '' ? 0 : Number(v) || 0), 0);
  const capCredits = Number(cap) || 0;
  const over = allocatedCredits > capCredits;

  const save = async () => {
    setSaving(true);
    setFailure(null);
    const allocationsCents: Record<string, number> = {};
    for (const [category, value] of Object.entries(limits)) {
      if (value.trim() === '') continue;
      allocationsCents[category] = creditsToCents(Number(value) || 0);
    }
    const res = await invoke<unknown>(
      'org.budget.set',
      { monthlyCapCents: creditsToCents(capCredits), allocationsCents },
      // Idempotent: this is a set, not an increment, so the same key twice leaves
      // the same limits. A fresh one per press keeps a retried save from replaying
      // an earlier body.
      crypto.randomUUID(),
    );
    setSaving(false);
    if (res.status === 'succeeded') {
      await onDone();
      return;
    }
    setFailure(
      res.status === 'failed' ? res.error.message : 'Only the account owner can change spending limits.',
    );
  };

  return (
    <div className="mt-3 grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface-muted p-4">
      <label className="grid gap-1">
        <span className="text-[12px] font-medium text-ink">Monthly limit</span>
        <span className="text-[11px] text-ink-muted">
          Your plan&rsquo;s ceiling is {credits(usage.monthlyCapCredits)} credits. You can hold the workspace
          below it, not above.
        </span>
        <Input
          type="number"
          min={0}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          className="mt-1 w-40 tabular-nums"
          aria-label="Monthly limit in credits"
        />
      </label>

      <div className="grid gap-3">
        <span className="text-[12px] font-medium text-ink">Limit per kind of work</span>
        {usage.byCategory.map((c) => (
          <label key={c.category} className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-ink">
              {c.label}
              <span className="ml-2 text-[11px] text-ink-muted">{credits(c.credits)} cr used</span>
            </span>
            <Input
              type="number"
              min={0}
              placeholder="No limit"
              value={limits[c.category] ?? ''}
              onChange={(e) => setLimits((prev) => ({ ...prev, [c.category]: e.target.value }))}
              className="w-32 tabular-nums"
              aria-label={`${c.label} limit in credits`}
            />
          </label>
        ))}
      </div>

      {/* Said before the save rather than after it. The server refuses this too —
          it has to, since it is the only place that can — but finding out by
          pressing Save is a worse way to learn it. */}
      {over && (
        <p className="text-[12px] text-warn">
          Those add up to {credits(allocatedCredits)} credits, more than the {credits(capCredits)} monthly
          limit. Lower one, or raise the limit.
        </p>
      )}
      {!over && capCredits > allocatedCredits && (
        <p className="text-[12px] text-ink-muted">
          {credits(capCredits - allocatedCredits)} credits left over, available to anything without a limit of
          its own.
        </p>
      )}
      {failure && <p className="text-[12px] text-destructive">{failure}</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving || over}>
          {saving ? 'Saving…' : 'Save limits'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void onDone()} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
