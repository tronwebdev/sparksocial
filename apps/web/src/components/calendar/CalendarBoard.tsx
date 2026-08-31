'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { WhyPopover } from '@/components/explain/WhyPopover';
import { CampaignWizard } from '@/components/campaign/CampaignWizard';
import { EmptyCalendarReason } from './EmptyCalendarReason';
import { CampaignList, type CampaignRow } from './CampaignList';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';
import { DraftPanel } from '@/components/command-center/draft-panel/DraftPanel';
import { MixBar, type MixSlice } from './MixBar';
import { DayActionSheet } from './DayActionSheet';
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
  /** Null for a slot placed on a day rather than on an account. */
  platform: string | null;
  /** Resolved from the playbook by `calendar.get`, not stored. Null when the playbook no longer resolves. */
  mediaType: string | null;
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
  /**
   * Which day's action sheet is open — `F9`/`CAL-07`.
   *
   * Clicking an empty day used to open the Draft Panel's trigger phase directly,
   * which asks *you* what the post should be. That is the inverse of the design,
   * where the agent proposes. The sheet sits in front of that route rather than
   * replacing it: "create something specific" is still there, and is now one of
   * three answers instead of the only one.
   */
  const [daySheet, setDaySheet] = useState<string | null>(null);
  /** Calendar grid or a flat list — `CAL-08`. */
  const [layout, setLayout] = useState<'calendar' | 'list'>('calendar');
  const [mixPreview, setMixPreview] = useState<MixImpactPreview | null>(null);
  /** §8.7's three filters. `all` rather than an empty string so the select's value is never ambiguous. */
  const [filters, setFilters] = useState<SlotFilterState>({ status: 'all', platform: 'all', mediaType: 'all' });
  const [previewOverride, setPreviewOverride] = useState<Record<string, number> | null>(null);

  /**
   * Filtering is client-side, deliberately.
   *
   * `calendar.get` returns a campaign's whole slot list in one read — a 30-day
   * campaign at three posts a week is ninety rows — so a filter that went back
   * to the server would spend a round trip to remove rows the browser already
   * has. It also keeps drag-and-drop honest: `moveSlot` writes through
   * `content.schedule` and then reloads, and a server-side filter would make a
   * slot dragged out of the current filter vanish mid-gesture.
   */
  const visibleSlots = useMemo(() => filterSlots(view?.slots ?? [], filters), [view?.slots, filters]);
  const [previewing, setPreviewing] = useState(false);
  const [pickerDate, setPickerDate] = useState('');
  // The objective and the proposed plan moved to `CampaignWizard` (CMP-01.1/.2)
  // along with the screen that collected them.
  /** Remount counter for the CMP-01 wizard — see its `onCancel` below. */
  const [wizardRun, setWizardRun] = useState(0);

  /**
   * `?new=1` — the cockpit's Create Campaign action, arriving here.
   *
   * The wizard used to be reachable only as this screen's *empty state*, which
   * meant a brand with one campaign had no way to start a second one from
   * anywhere in the app. `/home`'s primary action needed a destination, and the
   * honest one is the screen that already owns the wizard rather than a second
   * copy of it behind a modal.
   *
   * Read once into state rather than off the URL on every render, so cancelling
   * returns to the calendar instead of being re-opened by the parameter that is
   * still sitting in the address bar.
   */
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(searchParams.get('new') === '1');
  /**
   * Every campaign for this brand, not just the one on screen.
   *
   * "Why can't I create multiple campaigns?" — you can, and nothing in
   * `campaign.create`, `campaigns` or `campaign.list` has ever stopped you. This
   * screen stopped you: it read `campaigns[0]` (most recent by `startAt`), drew
   * that one, and offered the wizard only when there were *none*. So a second
   * campaign silently replaced the first on screen and the first became
   * unreachable — which reads exactly like a one-campaign limit.
   */
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);

  /**
   * The campaign list, on its own so activation can refresh it.
   *
   * Without this the picker was populated once at mount, so a campaign created
   * *after* mount was drawn but absent from the list that switches between them —
   * which is the same "you can only have one" symptom, one step further along.
   */
  const listCampaigns = useCallback(async (genomeId: string): Promise<CampaignRow[]> => {
    /**
     * The tool's maximum, not its default of 10.
     *
     * This list is titled "Campaigns" and states a count, so a silent truncation
     * at ten would make it say something false. Fifty is the schema's ceiling; a
     * brand past it needs pagination, and `CampaignList` says so rather than
     * quietly dropping the tail.
     */
    const list = await invoke<{ campaigns: CampaignRow[] }>('campaign.list', { genomeId, limit: 50 });
    return list.status === 'succeeded' ? list.output.campaigns : [];
  }, []);

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
    // Cleared up front, not left stale: switching brands (BrandSwitcher)
    // re-runs this on the same mounted component, and without this a genome
    // with no campaign would keep showing the *previous* genome's calendar
    // until this effect happened to find nothing to replace it with.
    setView(null);
    void (async () => {
      const rows = await listCampaigns(genome.genomeId);
      if (cancelled) return;
      setCampaigns(rows);
      // Most recently started first (the tool's own ordering) — opened by
      // default, but no longer the only one reachable.
      const active = rows[0];
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

  /**
   * Accepting the agent's suggestion: draft the named format straight onto the
   * day, then schedule it.
   *
   * Two calls rather than one because there is no tool that does both — and there
   * should not be: `content.draft` writes copy and `content.schedule` sets a date,
   * and a combined tool would have to decide what to do when the second half
   * fails after the first has already spent a model call.
   */
  const acceptRecommendation = useCallback(
    async (day: string, playbookId: string) => {
      if (!genome || !view) return;
      const drafted = await invoke<{ contentItemId: string }>(
        'content.draft',
        { genomeId: genome.genomeId, playbookId, intent: '' },
        crypto.randomUUID(),
      );
      if (drafted.status !== 'succeeded') {
        setError(drafted.status === 'failed' ? drafted.error.message : 'That draft was gated.');
        return;
      }
      const scheduled = await invoke('content.schedule', {
        contentItemId: drafted.output.contentItemId,
        genomeId: genome.genomeId,
        scheduledAt: `${day}T${String(SCHEDULE_HOUR_UTC).padStart(2, '0')}:00:00.000Z`,
      });
      if (scheduled.status !== 'succeeded') {
        // The draft exists and is unscheduled, which is a real and recoverable
        // state — it shows up in the Drafts list. Said plainly rather than
        // reported as "failed", which would imply nothing happened.
        setError('Drafted, but could not place it on that day. It is in your drafts.');
      }
      await reload(view.campaignId);
    },
    [genome, view, reload],
  );

  /** Accepting the move suggestion — the same reschedule a drag performs. */
  const acceptMove = useCallback(
    async (day: string, contentItemId: string) => {
      if (!genome || !view) return;
      const res = await invoke('content.schedule', {
        contentItemId,
        genomeId: genome.genomeId,
        scheduledAt: `${day}T${String(SCHEDULE_HOUR_UTC).padStart(2, '0')}:00:00.000Z`,
      });
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That move was gated.');
        return;
      }
      await reload(view.campaignId);
    },
    [genome, view, reload],
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

  if (!view || creating) {
    /**
     * `CMP-01` — the six-step wizard, replacing the two-click propose-then-create
     * control that used to live here.
     *
     * That control captured an objective and a window and nothing else, which is
     * why `campaign.create` accepted nothing else — no accounts, no offer, no
     * oversight choice. See `CampaignWizard`'s own header on what each step
     * writes and why the scheduler had to guess a platform without step 4.
     *
     * Two ways in: this screen's empty state, and `?new=1` from the cockpit's
     * Create Campaign action. Cancel means different things in each — see below.
     */
    return (
      <CampaignWizard
        key={wizardRun}
        genomeId={genome!.genomeId}
        onActivated={(campaignId) => {
          setCreating(false);
          void reload(campaignId);
          // So the new one appears in the picker beside the old ones, rather than
          // being the only one reachable until the next full page load.
          if (genome) void listCampaigns(genome.genomeId).then(setCampaigns);
        }}
        onCancel={() => {
          // Arrived deliberately: Cancel means "never mind", so it goes back to
          // the calendar that is already there. As the empty state there is
          // nowhere to go back *to*, so it restarts the wizard at step one by
          // remounting — bumping a key rather than threading a reset through six
          // steps of state.
          if (view) setCreating(false);
          else setWizardRun((n) => n + 1);
        }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      {/*
        Every campaign, above the one that is open.
        
        Ordered before the calendar because it answers a question the calendar
        cannot: *which* campaign am I looking at, and what else is there. That was
        unanswerable — this screen drew `campaigns[0]` and offered no way to the
        rest, which reads exactly like a product that allows one.
      */}
      {campaigns.length > 0 ? (
        <CampaignList
          campaigns={campaigns}
          selectedId={view.campaignId}
          busy={busy}
          onSelect={(id) => void reload(id)}
          onChanged={() => {
            // Both, because a rename changes the list and a status change changes
            // the badge on the open campaign too.
            if (genome) void listCampaigns(genome.genomeId).then(setCampaigns);
            void reload(view.campaignId);
          }}
          onNew={() => setCreating(true)}
        />
      ) : null}

      <section className="rounded border border-border bg-surface p-5">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-medium text-ink">{view.name}</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {view.slots.length} posts · for {view.objective}
            </p>
          </div>
          {/* The status and its controls live in the list above, beside every
              other campaign's — see `CampaignList`. Repeating them here would give
              two places to activate one campaign. */}
          <Badge className="bg-surface-muted capitalize text-ink-muted">{view.status}</Badge>
        </header>

        {/* The headline. Step 4 is judged here, not in the grid below. */}
        <MixBar mix={view.mixActual} onAdjust={adjust} busy={busy || previewing} />

        {/*
          A campaign with no posts in it, explained.

          `calendar.generate` runs the moment a campaign is created and can
          legitimately place zero slots — it only draws on playbooks whose assets
          already exist. That is a success, so nothing reported it, and the mix bar
          said "Nothing scheduled yet" as though a step had been skipped. See
          `EmptyCalendarReason` for the full account.
        */}
        {view.slots.length === 0 && genome ? (
          <div className="mt-4">
            <EmptyCalendarReason
              genomeId={genome.genomeId}
              plannedCount={view.mixActual.reduce((sum, m) => sum + m.count, 0)}
              busy={busy}
              onRegenerate={() => void regenerate(view.campaignId, {})}
            />
          </div>
        ) : null}

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SlotFilters slots={view.slots} value={filters} onChange={setFilters} />
        {/*
          `CAL-08`'s calendar-versus-list toggle. The list is not a lesser view:
          a month grid answers "what is this week shaped like" and a list answers
          "what is next", and the second question is the one somebody with 40
          scheduled posts is actually asking.
        */}
        <div className="flex shrink-0 items-center gap-1 rounded border border-border p-0.5">
          {(['calendar', 'list'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayout(l)}
              className={`rounded px-3 py-1.5 text-[13px] capitalize ${
                layout === l ? 'bg-ink text-surface' : 'text-ink-muted'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {layout === 'list' ? (
        <SlotList
          slots={visibleSlots}
          onOpenSlot={(id) => setDraftPanel({ open: true, contentItemId: id })}
        />
      ) : (
      <MonthGrid
        slots={visibleSlots}
        busy={busy}
        onAddToDay={(day) => setDaySheet(day)}
        onOpenSlot={(id) => setDraftPanel({ open: true, contentItemId: id })}
        onDropSlot={(slot, day) => void moveSlot(slot, day)}
      />
      )}

      {/*
        `F9`'s day action sheet. Mounted here rather than inside the grid so it
        can reach `reload` and the draft panel — accepting a suggestion writes a
        draft and a date, and both belong to the board, not to a cell.
      */}
      {daySheet && view ? (
        <DayActionSheet
          day={daySheet}
          campaignId={view.campaignId}
          genomeId={genome?.genomeId ?? ''}
          open
          onClose={() => setDaySheet(null)}
          onCreateSpecific={openTriggerFor}
          onAcceptCreate={(day, playbookId) => void acceptRecommendation(day, playbookId)}
          onAcceptMove={(day, contentItemId) => void acceptMove(day, contentItemId)}
        />
      ) : null}

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

/* ── §8.7's filters ─────────────────────────────────────────────────────── */

interface SlotFilterState {
  status: string;
  platform: string;
  mediaType: string;
}

/**
 * §8.7 asks the calendar for status, platform and content-type filters. It had
 * none, which mattered most at exactly the scale a calendar is for: ninety slots
 * across a month, and no way to answer "what is waiting on me" or "what is going
 * to Instagram" without reading all of them.
 *
 * ── Options come from the data, not from an enum ──────────────────────────
 *
 * A fixed list of five platforms and four media types would offer filters that
 * match nothing — a campaign posting only to TikTok would still show an
 * Instagram option that empties the board. Deriving them from the slots means
 * every option has at least one thing behind it, and it cannot drift when a
 * platform is added to the registry.
 *
 * `platform: null` gets its own option rather than being hidden: the date-picker
 * and drag-and-drop paths place a post on a day without choosing an account, so
 * "no account yet" is a real and actionable state — those are the slots the
 * scheduler will fall back to a playbook default for.
 */
function SlotFilters({
  slots,
  value,
  onChange,
}: {
  slots: Slot[];
  value: SlotFilterState;
  onChange: (next: SlotFilterState) => void;
}) {
  const statuses = distinct(slots.map((s) => s.status));
  const platforms = distinct(slots.map((s) => s.platform ?? UNSET));
  const mediaTypes = distinct(slots.map((s) => s.mediaType ?? UNSET));

  const active = value.status !== 'all' || value.platform !== 'all' || value.mediaType !== 'all';
  const shown = filterSlots(slots, value).length;

  // One option means no choice. A select that can only be set to what it
  // already shows is furniture.
  const useful = statuses.length > 1 || platforms.length > 1 || mediaTypes.length > 1;
  if (!useful) return null;

  return (
    <section className="flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-4">
      <span className="pb-2 text-[13px] font-medium text-ink-muted">Show</span>

      {statuses.length > 1 ? (
        <FilterSelect
          id="cal-status"
          label="Status"
          value={value.status}
          options={statuses}
          onChange={(status) => onChange({ ...value, status })}
        />
      ) : null}

      {platforms.length > 1 ? (
        <FilterSelect
          id="cal-platform"
          label="Account"
          value={value.platform}
          options={platforms}
          onChange={(platform) => onChange({ ...value, platform })}
        />
      ) : null}

      {mediaTypes.length > 1 ? (
        <FilterSelect
          id="cal-type"
          label="Type"
          value={value.mediaType}
          options={mediaTypes}
          onChange={(mediaType) => onChange({ ...value, mediaType })}
        />
      ) : null}

      {active ? (
        <div className="flex items-center gap-3 pb-1.5">
          <span className="text-[13px] tabular-nums text-ink-muted">
            {shown} of {slots.length}
          </span>
          <button
            type="button"
            onClick={() => onChange({ status: 'all', platform: 'all', mediaType: 'all' })}
            className="text-[13px] font-medium text-brand-purple underline"
          >
            Clear
          </button>
        </div>
      ) : null}
    </section>
  );
}

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <label className="block text-[12px] text-ink-muted" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] capitalize text-ink"
      >
        <option value="all">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {optionLabel(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The sentinel for "this slot has no account yet". A literal rather than `null`
 * because it has to survive a round trip through an `<option value>`, which is
 * always a string.
 */
const UNSET = '__unset__';

function optionLabel(value: string): string {
  if (value === UNSET) return 'No account yet';
  return value.replace(/_/g, ' ');
}

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => {
    // The unset bucket sorts last: it is a gap to fill, not a category.
    if (a === UNSET) return 1;
    if (b === UNSET) return -1;
    return a.localeCompare(b);
  });
}

function filterSlots(slots: Slot[], f: SlotFilterState): Slot[] {
  return slots.filter(
    (s) =>
      (f.status === 'all' || s.status === f.status) &&
      (f.platform === 'all' || (s.platform ?? UNSET) === f.platform) &&
      (f.mediaType === 'all' || (s.mediaType ?? UNSET) === f.mediaType),
  );
}

/**
 * The flat, chronological view — `CAL-08`.
 *
 * Ordered soonest-first and grouped by day, with unscheduled slots last rather
 * than dropped: a slot with a status and no date is a real state (a placement
 * that never got a time), and hiding it here would make it findable only in the
 * grid's `Unscheduled` column, which is the one place nobody scrolls to.
 */
function SlotList({
  slots,
  onOpenSlot,
}: {
  slots: Slot[];
  onOpenSlot: (id: string) => void;
}) {
  const dated = slots
    .filter((s) => Boolean(s.scheduledAt))
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
  const undated = slots.filter((s) => !s.scheduledAt);

  if (slots.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-6 py-8 text-center text-[13px] text-ink-muted">
        Nothing matches those filters.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <ul className="grid grid-cols-1">
        {[...dated, ...undated].map((slot) => {
          const style = pillarStyle(slot.pillar);
          return (
            <li key={slot.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => onOpenSlot(slot.id)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted"
              >
                <span className="w-[7.5rem] shrink-0 text-[13px] tabular-nums text-ink-muted">
                  {slot.scheduledAt
                    ? new Date(slot.scheduledAt).toLocaleDateString('en', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })
                    : 'Unscheduled'}
                </span>
                <span className="min-w-0 flex-1 text-[14px] text-ink">
                  {slot.playbookName ?? slot.playbookId ?? 'Post'}
                </span>
                <span className={cn('shrink-0 rounded border px-2 py-0.5 text-[11px] font-medium', style.chip)}>
                  {style.label}
                </span>
                {slot.platform ? (
                  <span className="shrink-0 text-[12px] capitalize text-ink-muted">
                    {slot.platform.replace('_', ' ')}
                  </span>
                ) : null}
                <span className="shrink-0 text-[12px] capitalize text-ink-muted">{slot.status}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
