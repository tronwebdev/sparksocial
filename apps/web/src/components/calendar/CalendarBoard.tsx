'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';
import { MixBar, type MixSlice } from './MixBar';
import { pillarStyle } from './pillars';

/**
 * THE CALENDAR — engine spec §6.8 Step 4, PRD `CAL-01`→`CAL-06`.
 *
 * Deliberately ordered mix-first, month-second. Step 4 says the calendar is
 * reviewed *at mix level*, and "if the user has to open all 24 posts, the
 * product failed" — so the mix bar is the headline and the grid is the
 * supporting detail, not the other way round.
 *
 * Adjustment is relative ("less offer, more craft"), never absolute counts: the
 * user is expressing a preference about balance, and absolute counts would let
 * them set a mix the promotional ceiling forbids. The override rides through
 * `deriveMix`, which re-caps — the API enforces it regardless of what this sends.
 */

interface Slot {
  id: string;
  scheduledAt: string | null;
  pillar: string | null;
  playbookId: string | null;
  playbookName: string | null;
  mode: string | null;
  status: string;
}

interface CalendarView {
  campaignId: string;
  name: string;
  objective: string;
  status: string;
  mixActual: MixSlice[];
  slots: Slot[];
}

interface GenomeRow {
  genomeId: string;
  name: string;
}

/** One nudge, in mix-weight terms. Small enough that a click is a nudge, not a lurch. */
const ADJUST_STEP = 0.12;

export function CalendarBoard() {
  const [genome, setGenome] = useState<GenomeRow | null>(null);
  const [view, setView] = useState<CalendarView | null>(null);
  const [override, setOverride] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** The brand switcher's cookie is the source of truth for which genome is selected. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await invoke<{ genomes: GenomeRow[] }>('genome.list', {});
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

  const regenerate = useCallback(
    async (campaignId: string, mixOverride: Record<string, number>) => {
      setBusy(true);
      const gen = await invoke('calendar.generate', {
        campaignId,
        ...(Object.keys(mixOverride).length ? { mixOverride } : {}),
      });
      if (gen.status !== 'succeeded') {
        setError(gen.status === 'failed' ? gen.error.message : 'That change was gated.');
        setBusy(false);
        return;
      }
      const got = await invoke<CalendarView>('calendar.get', { campaignId });
      if (got.status === 'succeeded') {
        setView(got.output);
        setError(null);
      }
      setBusy(false);
    },
    [],
  );

  const createCampaign = useCallback(async () => {
    if (!genome) return;
    setBusy(true);
    setError(null);

    const created = await invoke<{ campaignId: string }>(
      'campaign.create',
      {
        genomeId: genome.genomeId,
        name: `${new Date().toLocaleString('en', { month: 'long' })} campaign`,
        objective: 'bookings',
        windowDays: 30,
      },
      // Non-idempotent: without a key the API refuses, which is the guard
      // against a double-click creating two campaigns.
      `campaign:${genome.genomeId}:${Date.now()}`,
    );

    if (created.status !== 'succeeded') {
      setError(created.status === 'failed' ? created.error.message : 'That request was gated.');
      setBusy(false);
      return;
    }
    setOverride({});
    await regenerate(created.output.campaignId, {});
  }, [genome, regenerate]);

  const adjust = useCallback(
    (pillar: string, direction: 'more' | 'less') => {
      if (!view) return;
      const current = override[pillar] ?? 0.2;
      const next = Math.max(0, Math.min(1, current + (direction === 'more' ? ADJUST_STEP : -ADJUST_STEP)));
      const merged = { ...override, [pillar]: next };
      setOverride(merged);
      void regenerate(view.campaignId, merged);
    },
    [view, override, regenerate],
  );

  if (loading) return <Skeleton className="h-64 w-full rounded" />;

  if (error && !view) {
    return (
      <div className="rounded border border-border bg-surface p-6">
        <p className="text-[14px] text-ink-muted">{error}</p>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="rounded border border-border bg-surface p-8 text-center">
        <p className="text-[16px] font-medium text-ink">No calendar yet</p>
        <p className="mx-auto mt-1 max-w-md text-[14px] text-ink-muted">
          A campaign starts with an outcome, not a format. SPARK works out how many posts are possible
          from what {genome?.name ?? 'this brand'} already has — and what filming would add.
        </p>
        <Button className="mt-4" onClick={() => void createCampaign()} disabled={busy || !genome}>
          {busy ? 'Planning…' : 'Plan 30 days'}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <section className="rounded border border-border bg-surface p-5">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-medium text-ink">{view.name}</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {view.slots.length} posts · for {view.objective}
            </p>
          </div>
          <Badge className="bg-surface-muted capitalize text-ink-muted">{view.status}</Badge>
        </header>

        {/* The headline. Step 4 is judged here, not in the grid below. */}
        <MixBar mix={view.mixActual} onAdjust={adjust} busy={busy} />

        {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
      </section>

      <MonthGrid slots={view.slots} busy={busy} />
    </div>
  );
}

/**
 * The month, as a scannable grid.
 *
 * Grouped by ISO date rather than laid over a real month calendar: a campaign
 * window is thirty days from whenever it started, which rarely aligns to a
 * month boundary, and an empty first row of a September grid would imply the
 * campaign is idle rather than that it began on the 4th.
 */
function MonthGrid({ slots, busy }: { slots: Slot[]; busy: boolean }) {
  const byDay = new Map<string, Slot[]>();
  for (const slot of slots) {
    const day = slot.scheduledAt?.slice(0, 10) ?? 'unscheduled';
    byDay.set(day, [...(byDay.get(day) ?? []), slot]);
  }

  return (
    <section className={cn('rounded border border-border bg-surface p-5', busy && 'opacity-60')}>
      <h3 className="mb-4 text-[14px] font-medium text-ink">The month</h3>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...byDay.entries()].map(([day, daySlots]) => (
          <li key={day} className="rounded border border-border p-3">
            <p className="text-[12px] uppercase tracking-wide text-ink-muted">
              {day === 'unscheduled'
                ? 'Unscheduled'
                : new Date(`${day}T00:00:00Z`).toLocaleDateString('en', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    timeZone: 'UTC',
                  })}
            </p>
            <ul className="mt-2 grid gap-2">
              {daySlots.map((slot) => {
                const style = pillarStyle(slot.pillar);
                return (
                  <li key={slot.id} className="grid gap-1">
                    <span
                      className={cn(
                        'inline-flex w-fit items-center rounded border px-2 py-0.5 text-[11px] font-medium',
                        style.chip,
                      )}
                    >
                      {style.label}
                    </span>
                    <span className="truncate text-[13px] text-ink" title={slot.playbookName ?? undefined}>
                      {slot.playbookName ?? slot.playbookId ?? 'Unassigned'}
                    </span>
                    {/* Mode matters to the owner: `direct_finish` is the one
                        that will ask them to film something. */}
                    {slot.mode === 'direct_finish' ? (
                      <span className="text-[11px] text-warn">needs filming</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
