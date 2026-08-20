'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';

/**
 * `org.usage.get` — PRD §8.12's "usage slice and alerts".
 *
 * Costs have been recorded on every paid tool for a while and there was nothing
 * that read them back: a balance only ever came out of `org.credits.grant`, so
 * showing spend meant granting credits to render a number. This is the read.
 *
 * ── Why the breakdown leads and the bar does not ───────────────────────────
 *
 * A progress bar answers "how much is left", which matters once a month. The
 * breakdown answers "what is this costing me", which is the question §12
 * actually asks — *"what consumes credits"* — and the one that changes what
 * somebody does next. An avatar video is 50¢ and a dub is 60¢, so a fortnight of
 * enthusiasm with either is visible here and nowhere else in the product.
 */

interface ToolSpend {
  tool: string;
  costCents: number;
  calls: number;
  share: number;
}

interface Usage {
  monthlyCapCents: number;
  spentCents: number;
  remainingCents: number;
  usedFraction: number;
  alert: 'ok' | 'warning' | 'critical' | 'exhausted';
  byTool: ToolSpend[];
  periodStart: string;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

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

  useEffect(() => {
    void (async () => {
      const res = await invoke<Usage>('org.usage.get', { topTools: 8 });
      if (res.status === 'succeeded') {
        setUsage(res.output);
        return;
      }
      setError(
        res.status === 'failed'
          ? res.error.message
          : 'Usage is only visible to owners and admins.',
      );
    })();
  }, []);

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
            {new Date(usage.periodStart).toLocaleDateString('en', {
              day: 'numeric',
              month: 'long',
            })}
            . Paid tools stop working when the cap is reached.
          </p>
        </div>
        <Badge variant={tone.badge}>{tone.label}</Badge>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[22px] font-medium tabular-nums text-ink">{money(usage.spentCents)}</p>
          <p className="text-[13px] tabular-nums text-ink-muted">
            {money(usage.remainingCents)} left of {money(usage.monthlyCapCents)}
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
      </div>

      <div className="mt-5">
        <h3 className="text-[13px] font-medium text-ink">Where it went</h3>
        {usage.byTool.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-ink-muted">
            Nothing charged yet this month.
          </p>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-2">
            {usage.byTool.map((t) => (
              <li key={t.tool} className="flex items-center gap-3">
                <span className="w-52 shrink-0 truncate font-mono text-[12px] text-ink">{t.tool}</span>
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
