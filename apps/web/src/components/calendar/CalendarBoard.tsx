'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { WhyPopover } from '@/components/explain/WhyPopover';
import { CampaignWizard } from '@/components/campaign/CampaignWizard';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';
import { DraftPanel } from '@/components/command-center/draft-panel/DraftPanel';
import { MixBar, type MixSlice } from './MixBar';
import { pillarStyle } from './pillars';
import { CampaignReportPanel } from './CampaignReportPanel';

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
 *
 * ── CAL-02/04/05/06, added on top of the mix-first read ──────────────────
 * A slot click opens the Draft Panel on that item (CAL-06 — edit, regenerate,
 * approve, schedule all live there already). "+ Add" on a day, or the
 * standalone date picker for a day with nothing on it yet, opens the same
 * panel in its trigger phase and pins the result to that date once
 * `content.draft` returns an id (CAL-02/04) — one flow, not two, since the
 * panel already had a trigger phase from CC-02. Dragging a slot onto another
 * day calls `content.schedule` and offers an undo instead of a blocking
 * confirm dialog (CAL-05) — reversible beats a modal for a mistake this cheap
 * to fix. A mix nudge (`MixBar`'s +/−) is not that cheap — it regenerates
 * every future slot, not one date — so it gets the opposite treatment:
 * `calendar.impact_preview` first, an explicit Apply/Cancel, real
 * `calendar.generate` only on Apply. Two different actions, two different
 * amounts of ceremony, on purpose.
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

/** `calendar.impact_preview`'s output — what calendar.generate would change, without writing anything. */
interface MixImpactPreview {
  currentSlotCount: number;
  proposedSlotCount: number;
  mixBefore: { pillar: string; count: number }[];
  mixAfter: { pillar: string; count: number }[];
  unfilledPillars: { pillar: string; count: number }[];
  wouldChange: boolean;
  why: { summary: string };
}

// `ProposedPlan` and the objective labels moved to `CampaignWizard` with
// `CMP-01.1`/`.2`. This file is the calendar; creating a campaign is a
// six-step flow of its own and no longer half-lives here.

/** One nudge, in mix-weight terms. Small enough that a click is a nudge, not a lurch. */
const ADJUST_STEP = 0.12;
/**
 * UTC noon — not local noon, which is what this comment used to claim while the
 * constant's own name said otherwise.
 *
 * It is a *fallback* now rather than the rule. A drag places a post on a day;
 * the hour within that day belongs to the brand's posting windows, in the
 * brand's timezone (`brand.governance.get`), and `placeCalendar` applies them.
 * Noon UTC is only what a drag resolves to before those windows are known,
 * chosen because it is the hour least likely to round onto the neighbouring day
 * in any populated zone.
 */
const SCHEDULE_HOUR_UTC = 12;

export function CalendarBoard() {
  const { genome, loading, error: genomeError } = useSelectedGenome();
  const [view, setView] = useState<CalendarView | null>(null);
  const [override, setOverride] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftPanel, setDraftPanel] = useState<{ open: boolean; contentItemId?: string; pinDate?: string }>({
    open: false,
  });
  const [undo, setUndo] = useState<{ slotId: string; from: string; label: string } | null>(null);
  const [mixPreview, setMixPreview] = useState<MixImpactPreview | null>(null);
  const [previewOverride, setPreviewOverride] = useState<Record<string, number> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pickerDate, setPickerDate] = useState('');
  // The objective and the proposed plan moved to `CampaignWizard` (CMP-01.1/.2)
  // along with the screen that collected them.
  /** Remount counter for the CMP-01 wizard — see its `onCancel` below. */
  const [wizardRun, setWizardRun] = useState(0);

  const reload = useCallback(async (campaignId: string) => {
    const got = await invoke<CalendarView>('calendar.get', { campaignId });
    if (got.status === 'succeeded') setView(got.output);
  }, []);

  // Nothing hydrated `view` from the server on mount — `view` only ever got
  // set by `reload`, which only ever ran after `createCampaign`/`regenerate`
  // in this same session. Navigate away and back (a fresh mount) and `view`
  // started at `null` again regardless of what already existed, so the
  // propose-an-outcome screen showed even for a genome with a real campaign.
  const [hydrating, setHydrating] = useState(true);
  useEffect(() => {
    if (!genome) return;
    let cancelled = false;
    setHydrating(true);
    // Cleared up front, not left stale: switching brands (WorkspaceSwitcher)
    // re-runs this on the same mounted component, and without this a genome
    // with no campaign would keep showing the *previous* genome's calendar
    // until this effect happened to find nothing to replace it with.
    setView(null);
    void (async () => {
      const list = await invoke<{ campaigns: Array<{ campaignId: string; status: string }> }>('campaign.list', {
        genomeId: genome.genomeId,
      });
      if (cancelled) return;
      // Most recently started first (the tool's own ordering) — the active one.
      const active = list.status === 'succeeded' ? list.output.campaigns[0] : undefined;
      if (active) await reload(active.campaignId);
      if (!cancelled) setHydrating(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [genome, reload]);

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
      await reload(campaignId);
      setError(null);
      setBusy(false);
    },
    [reload],
  );

  // `calendar.impact_preview`'s own doc comment: "show what calendar.generate
  // would change before committing... nothing is written." A mix nudge
  // regenerates every future slot, not one date — a meaningfully bigger
  // action than the drag-move's single-slot swap below, which stays
  // instant-then-undo (§CAL-05's own "reversible beats a modal" call). This
  // one gets a preview-then-apply step instead: the click no longer commits
  // immediately, it shows what would change and waits for "Apply".
  const adjust = useCallback(
    async (pillar: string, direction: 'more' | 'less') => {
      if (!view) return;
      const current = override[pillar] ?? 0.2;
      const next = Math.max(0, Math.min(1, current + (direction === 'more' ? ADJUST_STEP : -ADJUST_STEP)));
      const merged = { ...override, [pillar]: next };
      setPreviewing(true);
      setMixPreview(null);
      const res = await invoke<MixImpactPreview>('calendar.impact_preview', { campaignId: view.campaignId, mixOverride: merged });
      setPreviewing(false);
      if (res.status === 'succeeded') {
        setMixPreview(res.output);
        setPreviewOverride(merged);
      } else {
        setError(res.status === 'failed' ? res.error.message : 'That preview was gated.');
      }
    },
    [view, override],
  );

  const applyMixPreview = useCallback(async () => {
    if (!view || !previewOverride) return;
    setOverride(previewOverride);
    setMixPreview(null);
    await regenerate(view.campaignId, previewOverride);
    setPreviewOverride(null);
  }, [view, previewOverride, regenerate]);

  const cancelMixPreview = useCallback(() => {
    setMixPreview(null);
    setPreviewOverride(null);
  }, []);

  const openTriggerFor = useCallback((day: string) => {
    setDraftPanel({ open: true, pinDate: day });
  }, []);

  const onDraftCreated = useCallback(
    (contentItemId: string) => {
      const day = draftPanel.pinDate;
      if (!genome || !day) return;
      void invoke('content.schedule', {
        contentItemId,
        genomeId: genome.genomeId,
        scheduledAt: `${day}T${String(SCHEDULE_HOUR_UTC).padStart(2, '0')}:00:00.000Z`,
      });
    },
    [draftPanel.pinDate, genome],
  );

  const moveSlot = useCallback(
    async (slot: Slot, toDay: string) => {
      if (!genome || !view) return;
      const fromDay = slot.scheduledAt?.slice(0, 10);
      if (!fromDay || fromDay === toDay) return;

      const res = await invoke('content.schedule', {
        contentItemId: slot.id,
        genomeId: genome.genomeId,
        scheduledAt: `${toDay}T${String(SCHEDULE_HOUR_UTC).padStart(2, '0')}:00:00.000Z`,
      });
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That move was gated.');
        return;
      }
      await reload(view.campaignId);
      setUndo({ slotId: slot.id, from: fromDay, label: slot.playbookName ?? slot.playbookId ?? 'Post' });
    },
    [genome, view, reload],
  );

  const undoMove = useCallback(async () => {
    if (!undo || !genome || !view) return;
    await invoke('content.schedule', {
      contentItemId: undo.slotId,
      genomeId: genome.genomeId,
      scheduledAt: `${undo.from}T${String(SCHEDULE_HOUR_UTC).padStart(2, '0')}:00:00.000Z`,
    });
    setUndo(null);
    await reload(view.campaignId);
  }, [undo, genome, view, reload]);

  if (loading || hydrating) return <Skeleton className="h-64 w-full rounded" />;

  if ((error || genomeError) && !view) {
    return (
      <div className="rounded border border-border bg-surface p-6">
        <p className="text-[14px] text-ink-muted">{error ?? genomeError}</p>
      </div>
    );
  }

  if (!view) {
    /**
     * `CMP-01` — the six-step wizard, replacing the two-click propose-then-create
     * control that used to live here.
     *
     * That control captured an objective and a window and nothing else, which is
     * why `campaign.create` accepted nothing else — no accounts, no offer, no
     * oversight choice. See `CampaignWizard`'s own header on what each step
     * writes and why the scheduler had to guess a platform without step 4.
     */
    return (
      <CampaignWizard
        key={wizardRun}
        genomeId={genome!.genomeId}
        onActivated={(campaignId) => void reload(campaignId)}
        // There is nowhere to navigate back to — this *is* the empty state — so
        // Cancel restarts the wizard at step one by remounting it. Bumping a key
        // rather than threading a reset through six steps of state.
        onCancel={() => setWizardRun((n) => n + 1)}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6">
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
        <MixBar mix={view.mixActual} onAdjust={adjust} busy={busy || previewing} />

        {previewing ? <p className="mt-2 text-[13px] text-ink-muted">Working out what that would change…</p> : null}

        {mixPreview ? (
          <div className="mt-3 rounded-lg border border-border bg-surface-muted p-4">
            <p className="text-[13px] text-ink">{mixPreview.why.summary}</p>
            <WhyPopover why={mixPreview.why} label="What this change is based on" />
            {mixPreview.wouldChange ? (
              <p className="mt-1 text-[13px] text-ink-muted">
                {mixPreview.currentSlotCount} → <b className="text-ink">{mixPreview.proposedSlotCount}</b> posts
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {mixPreview.mixAfter.map((m) => {
                const before = mixPreview.mixBefore.find((b) => b.pillar === m.pillar)?.count ?? 0;
                const style = pillarStyle(m.pillar);
                return (
                  <span key={m.pillar} className={cn('rounded border px-2 py-1 text-[12px] font-medium', style.chip)}>
                    {style.label} · {before} → {m.count}
                  </span>
                );
              })}
            </div>
            {mixPreview.unfilledPillars.length > 0 ? (
              <p className="mt-2 text-[12px] text-warn">
                Would leave {mixPreview.unfilledPillars.map((u) => `${pillarStyle(u.pillar).label} short ${u.count}`).join(', ')} — not
                enough cleared assets to fill it.
              </p>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" disabled={busy || !mixPreview.wouldChange} onClick={() => void applyMixPreview()}>
                {busy ? 'Applying…' : 'Apply'}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={cancelMixPreview}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {/* Step 6 — on demand, not auto-loaded, since it reads real metrics. */}
        <div className="mt-4">
          <CampaignReportPanel campaignId={view.campaignId} />
        </div>

        {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
      </section>

      {/* CAL-02 for a day with nothing on it yet — the grid below only ever
          renders days that already have a slot, so an empty day needs its own
          entry point. */}
      <section className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface p-4">
        <span className="text-[13px] font-medium text-ink-muted">What would you like to post, and when?</span>
        <Input
          type="date"
          value={pickerDate}
          onChange={(e) => setPickerDate(e.target.value)}
          className="h-10 w-auto"
          aria-label="Date"
        />
        <Button size="sm" disabled={!pickerDate} onClick={() => openTriggerFor(pickerDate)}>
          Create post
        </Button>
      </section>

      {undo ? (
        <div className="flex items-center gap-3 rounded border border-border bg-surface-muted px-4 py-2 text-[13px] text-ink-muted">
          <span>Moved &ldquo;{undo.label}&rdquo;.</span>
          <button type="button" onClick={() => void undoMove()} className="font-medium text-brand-purple underline">
            Undo
          </button>
        </div>
      ) : null}

      <MonthGrid
        slots={view.slots}
        busy={busy}
        onAddToDay={openTriggerFor}
        onOpenSlot={(id) => setDraftPanel({ open: true, contentItemId: id })}
        onDropSlot={(slot, day) => void moveSlot(slot, day)}
      />

      <DraftPanel
        genomeId={genome?.genomeId}
        contentItemId={draftPanel.contentItemId}
        open={draftPanel.open}
        onDraftCreated={onDraftCreated}
        onClose={() => {
          setDraftPanel({ open: false });
          if (view) void reload(view.campaignId);
        }}
      />
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
function MonthGrid({
  slots,
  busy,
  onAddToDay,
  onOpenSlot,
  onDropSlot,
}: {
  slots: Slot[];
  busy: boolean;
  onAddToDay: (day: string) => void;
  onOpenSlot: (contentItemId: string) => void;
  onDropSlot: (slot: Slot, day: string) => void;
}) {
  const byDay = new Map<string, Slot[]>();
  for (const slot of slots) {
    const day = slot.scheduledAt?.slice(0, 10) ?? 'unscheduled';
    byDay.set(day, [...(byDay.get(day) ?? []), slot]);
  }

  return (
    <section className={cn('rounded border border-border bg-surface p-5', busy && 'opacity-60')}>
      <h3 className="mb-4 text-[14px] font-medium text-ink">The month</h3>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...byDay.entries()].map(([day, daySlots]) => (
          <li
            key={day}
            onDragOver={(e) => day !== 'unscheduled' && e.preventDefault()}
            onDrop={(e) => {
              if (day === 'unscheduled') return;
              e.preventDefault();
              const slotId = e.dataTransfer.getData('text/plain');
              const dropped = daySlots.find((s) => s.id === slotId) ?? slots.find((s) => s.id === slotId);
              if (dropped) onDropSlot(dropped, day);
            }}
            className="rounded border border-border p-3"
          >
            <div className="flex items-center justify-between">
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
              {day !== 'unscheduled' ? (
                <button
                  type="button"
                  onClick={() => onAddToDay(day)}
                  aria-label={`Add a post to ${day}`}
                  className="text-[13px] font-medium text-brand-purple hover:underline"
                >
                  + Add
                </button>
              ) : null}
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-2">
              {daySlots.map((slot) => {
                const style = pillarStyle(slot.pillar);
                return (
                  <li
                    key={slot.id}
                    draggable={day !== 'unscheduled' && slot.status !== 'published'}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', slot.id)}
                    onClick={() => onOpenSlot(slot.id)}
                    className="grid grid-cols-1 cursor-pointer gap-1 rounded p-1 hover:bg-surface-muted"
                  >
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
