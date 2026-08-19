'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
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

interface ProposedPlan {
  objective: string;
  windowDays: number;
  buildableNow: number;
  potentialWithCapture: number;
  mix: { pillar: string; count: number }[];
  capture: { missingRoles: string[]; sittings: number; minutesPerSitting: number } | null;
  why: { summary: string };
}

/** `Objective` (packages/shared/src/types.ts), labeled for the proposal step. */
const OBJECTIVES: { value: string; label: string }[] = [
  { value: 'leads', label: 'Generate leads' },
  { value: 'bookings', label: 'Fill bookings' },
  { value: 'trials', label: 'Drive trials' },
  { value: 'sales', label: 'Drive sales' },
  { value: 'audience', label: 'Grow audience' },
  { value: 'hiring', label: 'Hire' },
];

/** One nudge, in mix-weight terms. Small enough that a click is a nudge, not a lurch. */
const ADJUST_STEP = 0.12;
/** Local noon, so a scheduled date never rounds onto the neighbouring day across timezones. */
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
  const [objective, setObjective] = useState(OBJECTIVES[1]!.value); // 'bookings' — the prior hardcoded default, now a starting point rather than the only option
  const [proposal, setProposal] = useState<ProposedPlan | null>(null);
  const [proposing, setProposing] = useState(false);

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
    setProposal(null);
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

  /**
   * `campaign.propose_plan` — the review step §6.8 Steps 2–3 describe and
   * `campaign.create`'s own summary asks for ("Call campaign.propose_plan
   * first to show them the numbers"). Read-only: proposing commits nothing,
   * so re-proposing on a different objective just replaces the preview.
   */
  const proposePlan = useCallback(async () => {
    if (!genome) return;
    setProposing(true);
    setError(null);
    const res = await invoke<ProposedPlan>('campaign.propose_plan', {
      genomeId: genome.genomeId,
      objective,
      windowDays: 30,
    });
    setProposing(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setProposal(res.output);
  }, [genome, objective]);

  const createCampaign = useCallback(async () => {
    if (!genome || !proposal) return;
    setBusy(true);
    setError(null);

    const created = await invoke<{ campaignId: string }>(
      'campaign.create',
      {
        genomeId: genome.genomeId,
        name: `${new Date().toLocaleString('en', { month: 'long' })} campaign`,
        objective: proposal.objective,
        windowDays: proposal.windowDays,
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
    setProposal(null);
    await regenerate(created.output.campaignId, {});
  }, [genome, proposal, regenerate]);

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
    return (
      <div className="mx-auto max-w-lg rounded border border-border bg-surface p-8 text-center">
        <p className="text-[16px] font-medium text-ink">No calendar yet</p>
        <p className="mx-auto mt-1 max-w-md text-[14px] text-ink-muted">
          A campaign starts with an outcome, not a format. SPARK works out how many posts are possible
          from what {genome?.name ?? 'this brand'} already has — and what filming would add.
        </p>

        {!proposal ? (
          <div className="mt-5 grid grid-cols-1 gap-3 text-left">
            <label className="text-[13px] font-medium text-ink-muted" htmlFor="cb-objective">
              What's the outcome?
            </label>
            <select
              id="cb-objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink"
            >
              {OBJECTIVES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
            <Button onClick={() => void proposePlan()} disabled={proposing || !genome}>
              {proposing ? 'Working out the numbers…' : 'See the plan'}
            </Button>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-3 text-left">
            <div className="rounded border border-border p-4">
              <p className="text-[14px] text-ink">{proposal.why.summary}</p>
              <p className="mt-2 text-[13px] text-ink-muted">
                <span className="font-medium text-ink">{proposal.buildableNow}</span> posts buildable right now
                {proposal.potentialWithCapture > proposal.buildableNow ? (
                  <>
                    {' · '}
                    <span className="font-medium text-ink">{proposal.potentialWithCapture}</span> possible if you film
                  </>
                ) : null}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {proposal.mix.map((m) => (
                  <span
                    key={m.pillar}
                    className={cn('rounded border px-2 py-0.5 text-[11px] font-medium', pillarStyle(m.pillar).chip)}
                  >
                    {pillarStyle(m.pillar).label} · {m.count}
                  </span>
                ))}
              </div>
              {proposal.capture ? (
                <p className="mt-3 text-[12px] text-warn">
                  Needs {proposal.capture.sittings} filming sitting(s), ~{proposal.capture.minutesPerSitting} min each,
                  to close: {proposal.capture.missingRoles.join(', ')}.
                </p>
              ) : null}
            </div>
            {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
            <div className="flex items-center justify-center gap-2">
              <Button variant="ghost" onClick={() => setProposal(null)} disabled={busy}>
                Choose a different outcome
              </Button>
              <Button onClick={() => void createCampaign()} disabled={busy}>
                {busy ? 'Starting…' : 'Start this campaign'}
              </Button>
            </div>
          </div>
        )}
      </div>
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
