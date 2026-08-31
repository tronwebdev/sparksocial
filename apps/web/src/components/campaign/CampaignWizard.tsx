'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  rungFromBrandAutonomy,
  type CampaignType,
  type CampaignWeight,
  type EngagementRung,
} from '@sparksocial/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { platformLabel } from '@/lib/platforms';
import { invoke } from '@/lib/tools';
import { EmptyCalendarReason } from '@/components/calendar/EmptyCalendarReason';
import { cn } from '@/lib/utils';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';

/**
 * `CMP-01` — the campaign wizard, PRD §8.4.
 *
 * ── What existed before ────────────────────────────────────────────────────
 *
 * A two-click propose-then-create control embedded in the calendar. It captured
 * an objective and a window length, and `campaign.create` accepted nothing else:
 * no campaign type, no offer details, **no connected-account selection**, and no
 * responsibilities or learning toggles — all four of which §8.4 lists as inputs.
 *
 * The account selection was the one with teeth. Because no campaign had ever
 * recorded where it should publish, `apps/api/src/scheduler.ts` carried a
 * fallback to *"the playbook's first declared platform"* for every scheduled
 * post — a brand with three connected accounts had every post go to whichever
 * one its formats happened to name first, with no way to say otherwise.
 *
 * ── The six steps, and which are real ──────────────────────────────────────
 *
 * `CMP-01.1` goal · `.2` type (SPARK proposes, the owner adjusts the mix) ·
 * `.3` offer + CTA · `.4` accounts · `.5` responsibilities and learning ·
 * `.6` review and activate. Each writes through an existing tool —
 * `campaign.propose_plan`, `genome.offer.set`, `campaign.create`,
 * `agent.approval_mode.set`, `calendar.generate` — rather than a new endpoint,
 * so the wizard is a sequence of tool calls and not a capability of its own.
 *
 * Step 2 shows two things at once, which is a change from how it read before 22
 * August. §8.4 describes a "campaign type" the agent suggests, and there was
 * nowhere to put one: `planCampaign` derives the whole content mix from the
 * objective and the Asset Graph, so a type field would have been a control that
 * changed nothing, and the step showed the proposed *mix* instead — the thing a
 * type is a proxy for. `campaigns.campaign_type` exists now, so the step shows
 * both: the type, preselected from the goal, above the mix it summarises.
 *
 * ── Which of these fields the engine acts on ────────────────────────────────
 *
 * Worth being exact, because a wizard is the easiest place in a product to
 * imply more than is true:
 *
 *   - `engagementRung` governs every reply this campaign makes — `policy.ts`
 *     rule 6 reads it through `rungAutonomy`, and Sales Assist's handoff rules
 *     apply only on the top rung.
 *   - `learnFromPerformance`, unticked, calls `learning.freeze`.
 *   - `approvalMode` is what `policy.ts` reads to decide whether this
 *     campaign's posts queue for review.
 *   - `campaignType`, `weight` and `adjustMixAutomatically` are recorded on the
 *     campaign and shown back on review. Nothing on this screen tells the owner
 *     they change the plan, because today they do not.
 */

const OBJECTIVES = [
  { value: 'bookings', label: 'More bookings', hint: 'Appointments, tables, jobs' },
  { value: 'leads', label: 'More enquiries', hint: 'People asking about you' },
  { value: 'sales', label: 'More sales', hint: 'Orders and purchases' },
  { value: 'trials', label: 'More sign-ups', hint: 'Trials and free accounts' },
  { value: 'audience', label: 'A bigger audience', hint: 'Reach and following' },
  { value: 'hiring', label: 'Hiring', hint: 'Applications from good people' },
] as const;

const APPROVAL_MODES = [
  {
    value: 'autopublish',
    label: 'Publish on its own',
    hint: 'The PRD default. Guardrails still hold anything risky back.',
  },
  {
    value: 'review_first_week',
    label: 'Review the first week',
    hint: 'Then it publishes on its own once you have seen how it writes.',
  },
  { value: 'review_everything', label: 'Review everything', hint: 'Nothing goes out unseen.' },
] as const;

/**
 * `CMP-01.2`'s type, in the prototype's own words.
 *
 * Four, matching the four `campaigns.campaign_type` accepts. Note that the
 * prototype's step 1 and step 2 lists overlap — "Build Authority & Trust" is
 * offered there as a *goal* and "Authority / Education" as a *type* — which is
 * exactly the conflation the build keeps apart: the goal is what success looks
 * like and the type is the shape of the content chasing it.
 */
const CAMPAIGN_TYPES: ReadonlyArray<{ value: CampaignType; label: string; hint: string }> = [
  {
    value: 'promotion',
    label: 'Promotion / Offers',
    hint: 'Direct benefits, urgency, and a clear thing to do next.',
  },
  {
    value: 'lead_magnet',
    label: 'Lead magnet',
    hint: 'Teaching that earns an email or an enquiry.',
  },
  {
    value: 'authority',
    label: 'Authority / Education',
    hint: 'Explaining your work until people trust it.',
  },
  {
    value: 'launch',
    label: 'Launch / Announcement',
    hint: 'A short burst of visibility around one thing.',
  },
];

/**
 * The type this goal usually implies — a preselection, not a decision.
 *
 * The prototype phrases this as the agent's choice ("I've chosen a type for you
 * based on your goal"). It is presented as a default here instead, because
 * invariant 4 makes anything the owner sees SPARK *decide* owe them a structured
 * `Explanation`, and a two-line lookup table has no reasoning to show. Calling
 * it a preselection is both cheaper and truer.
 *
 * `launch` is absent on purpose: nothing about an objective says "short burst",
 * so it is a choice the owner makes rather than one a goal implies.
 */
const TYPE_FOR_OBJECTIVE: Record<string, CampaignType> = {
  bookings: 'promotion',
  sales: 'promotion',
  leads: 'lead_magnet',
  trials: 'lead_magnet',
  audience: 'authority',
  hiring: 'authority',
};

/**
 * The prototype's "how much attention should this get?", as three buttons rather
 * than its three-stop slider.
 *
 * A slider implies a continuum and this is three named values; it also has to be
 * dragged, where the buttons are reachable by keyboard for nothing.
 */
const WEIGHTS: ReadonlyArray<{ value: CampaignWeight; label: string; hint: string }> = [
  { value: 'light', label: 'Light', hint: 'A thread running under everything else' },
  { value: 'balanced', label: 'Balanced', hint: 'Shares the month with your usual posting' },
  { value: 'dominant', label: 'Dominant', hint: 'The main thing this month is about' },
];

/**
 * The engagement ladder — four rungs, the prototype's labels, explanations
 * written against what the build actually does.
 *
 * The prototype greys this whole group out; it is live here. `sales_assist` is
 * the one rung with configuration behind it, which is why it says where that
 * configuration lives.
 */
const RUNGS: ReadonlyArray<{ value: EngagementRung; label: string; hint: string }> = [
  { value: 'observe', label: 'Observe only', hint: 'Reads and sorts everything. Replies to nothing.' },
  { value: 'suggest', label: 'Suggest replies', hint: 'Drafts a reply and waits for you to send it.' },
  {
    value: 'auto_reply',
    label: 'Auto reply (safe)',
    hint: 'Answers the straightforward ones itself. Anything sensitive still waits for you.',
  },
  {
    value: 'sales_assist',
    label: 'Sales assist',
    hint: 'Also works leads — qualifies them in DMs and applies your handoff rules.',
  },
];


/**
 * How many posts the proposed mix adds up to.
 *
 * Not `plan.windowDays` and not `plan.buildableNow`: the pillar counts are the
 * only thing that describes the shape of the plan, and the widths in CMP-01.2
 * are shares of that shape.
 */
function mixTotal(mix: Array<{ count: number }>): number {
  return mix.reduce((n, m) => n + m.count, 0);
}

interface ProposedPlan {
  objective: string;
  windowDays: number;
  buildableNow: number;
  mix: Array<{ pillar: string; count: number }>;
  why: Explanation;
}

interface PlatformStatus {
  platform: string;
  connected: boolean;
  accountLabel?: string;
  supported: boolean;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const STEP_TITLES: Record<Step, string> = {
  1: 'What is this campaign for?',
  2: 'What SPARK plans to make',
  3: 'What are you pointing people at?',
  4: 'Where should it post?',
  5: 'How much should this campaign do on its own?',
  6: 'Ready to go',
};

export function CampaignWizard({
  genomeId,
  onActivated,
  onCancel,
}: {
  genomeId: string;
  onActivated: (campaignId: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>(1);

  /**
   * The campaign's name, asked rather than derived.
   *
   * It was `` `${month} campaign` `` — so two campaigns started in August were
   * both "August campaign" and indistinguishable in any list. Defaulted to that
   * same string, because a default is what stops this becoming another required
   * field on a six-step form, and pre-filled rather than placeholdered so the
   * owner can see what they are accepting.
   */
  const [name, setName] = useState(() => `${new Date().toLocaleString('en', { month: 'long' })} campaign`);

  /**
   * Set when the campaign was created but its calendar came back empty.
   *
   * `calendar.generate` can legitimately place zero slots — it draws only on
   * playbooks whose assets already exist — and that is a *success*, so the wizard
   * used to close on it and hand back to a calendar reading "Nothing scheduled
   * yet". The owner had just walked six steps and been shown "Posts planned: 0 of
   * 13"; closing silently made that number look like a mistake rather than a
   * statement.
   */
  const [emptyResult, setEmptyResult] = useState<{ campaignId: string; planned: number } | null>(null);

  // CMP-01.1
  const [objective, setObjective] = useState<string>('bookings');
  const [windowDays, setWindowDays] = useState(30);
  const [targetCount, setTargetCount] = useState('');
  const [targetLabel, setTargetLabel] = useState('');

  // CMP-01.2
  const [plan, setPlan] = useState<ProposedPlan | null>(null);
  /**
   * Null means "whatever the goal implies", so changing the goal on step 1 keeps
   * the suggestion current — until the owner picks a type, after which their
   * choice survives going back and forth. An effect that re-derived the type on
   * every objective change would quietly undo that choice.
   */
  const [typeChoice, setTypeChoice] = useState<CampaignType | null>(null);
  const campaignType: CampaignType = typeChoice ?? TYPE_FOR_OBJECTIVE[objective] ?? 'promotion';

  // CMP-01.3
  const [ctaUrl, setCtaUrl] = useState('');
  const [offerNote, setOfferNote] = useState('');

  // CMP-01.4
  const [platforms, setPlatforms] = useState<PlatformStatus[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  // CMP-01.5
  const [approvalMode, setApprovalMode] = useState<string>('review_first_week');
  const [learnFromPerformance, setLearnFromPerformance] = useState(true);
  const [adjustMixAutomatically, setAdjustMixAutomatically] = useState(true);
  const [weight, setWeight] = useState<CampaignWeight>('balanced');
  const [engagementRung, setEngagementRung] = useState<EngagementRung>('observe');
  /** Also change the brand's default, not just this campaign's — off by default. */
  const [applyToWholeBrand, setApplyToWholeBrand] = useState(false);
  /**
   * Set the moment the owner touches either governance control, so a slow
   * governance read cannot land afterwards and overwrite their choice.
   * The fetch is fired at mount rather than on reaching step 5 precisely so this
   * race is nearly impossible, but "nearly" is not a reason to leave it open.
   *
   * A ref rather than state: nothing renders from it, and it has to be readable
   * inside the fetch without making the effect depend on it and re-run.
   */
  const governanceTouched = useRef(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* CMP-01.2 — SPARK's proposal, fetched when the goal is settled. */
  const propose = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await invoke<ProposedPlan>('campaign.propose_plan', { genomeId, objective, windowDays });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setPlan(res.output);
    setStep(2);
  }, [genomeId, objective, windowDays]);

  /**
   * `CMP-01.5`'s two governance controls, preselected from the brand.
   *
   * The brand is the template a campaign is seeded from — `campaign.create`
   * applies exactly this when the caller names neither field. The wizard names
   * both on every activation, so without this the screen would show
   * `review_first_week` and `Observe only` to a brand that had already chosen
   * otherwise, and activating would silently demote it. Showing the brand's
   * current posture makes the step a confirmation rather than a reset.
   *
   * `rungFromBrandAutonomy` is imported from `@sparksocial/shared` rather than
   * rewritten here for the same reason: the wizard must widen `auto` onto the
   * ladder the same way the server does, or the screen disagrees with what it is
   * about to send.
   *
   * Two reads because the two fields live on two tools: the approval ladder has
   * its own `agent.approval_mode.get` (it also computes when a first-week brand
   * graduates, which is why it is not a governance field), and the engagement
   * autonomy comes back with the rest of `brand.governance.get`.
   *
   * A failed fetch leaves the cautious defaults in place, which is the right
   * direction to fail in.
   */
  useEffect(() => {
    void (async () => {
      const [mode, gov] = await Promise.all([
        invoke<{ approvalMode: string }>('agent.approval_mode.get', {}),
        invoke<{ engagementAutonomy?: 'off' | 'suggest' | 'auto' }>('brand.governance.get', {}),
      ]);
      if (governanceTouched.current) return;
      if (mode.status === 'succeeded') setApprovalMode(mode.output.approvalMode);
      if (gov.status === 'succeeded') {
        setEngagementRung(rungFromBrandAutonomy(gov.output.engagementAutonomy));
      }
    })();
  }, []);

  /* CMP-01.4 — only accounts that are actually connected can be chosen. */
  useEffect(() => {
    if (step !== 4 || platforms !== null) return;
    void (async () => {
      const res = await invoke<{ platforms: PlatformStatus[] }>('integration.health', {});
      if (res.status !== 'succeeded') {
        setPlatforms([]);
        return;
      }
      const connected = res.output.platforms.filter((p) => p.connected);
      setPlatforms(res.output.platforms);
      // Preselect everything connected — §8.4 calls for an "AI preselect", and
      // "all the accounts you have actually connected" is the honest version of
      // that rather than a guess dressed up as a recommendation.
      setSelected(connected.map((p) => p.platform));
    })();
  }, [step, platforms]);

  /**
   * `CMP-01.3`'s brand-level write. Skipped entirely when no product was named.
   *
   * `GenomeOffer` carries `primary_cta` and a `products` list, and no free-text
   * summary field — so the "anything specific to push" answer becomes a named
   * product rather than being dropped or a new column being invented for it.
   * The CTA url is attached to that product, since it is where the offer points.
   *
   * ── Why the url no longer goes into `offer.primary_cta` ──────────────────
   *
   * It used to, and that was wrong in kind. `genome:offer.primary_cta` is the
   * source for a `cta` beat in sixteen playbooks — it becomes the words on the
   * screen and in the voiceover, which is why `publish/linkTool.ts` says
   * outright that it is free text ("Book Now"), not a URL. Writing `https://…`
   * into it put a URL where a phrase belongs, in every video the brand made.
   *
   * The url now goes to `campaigns.primary_cta`, which is where a destination
   * that lasts one campaign belongs anyway: the brand's own CTA is a standing
   * default, and a lead-magnet campaign pointing at its opt-in page should stop
   * pointing there when the campaign ends.
   */
  async function saveOffer(): Promise<boolean> {
    const cta = ctaUrl.trim();
    const note = offerNote.trim();
    if (!note) return true;

    const res = await invoke('genome.offer.set', {
      genomeId,
      offer: { products: [{ name: note, ...(cta ? { cta_url: cta } : {}) }] },
    });
    if (res.status === 'succeeded') return true;
    setError(res.status === 'failed' ? res.error.message : 'Saving the offer needs approval.');
    return false;
  }

  /* CMP-01.6 — activate. Four calls, in the order their effects depend on. */
  async function activate() {
    setBusy(true);
    setError(null);

    /**
     * The oversight choice is stored on the *campaign* now, not the brand — PRD
     * §7.2's per-campaign approval scope, which had no representation until
     * `campaigns.approval_mode` existed.
     *
     * That is the meaningful change from setting `agent.approval_mode.set` here:
     * it used to overwrite the whole brand's posture, so activating a cautious
     * launch campaign quietly put every *other* running campaign into review
     * too. A campaign's mode now applies to its own posts and nothing else, and
     * `applyToWholeBrand` is the explicit way to do the old thing on purpose.
     */
    if (applyToWholeBrand) {
      const modeRes = await invoke('agent.approval_mode.set', { mode: approvalMode });
      if (modeRes.status !== 'succeeded') {
        setBusy(false);
        setError(modeRes.status === 'failed' ? modeRes.error.message : 'Setting the approval mode was gated.');
        return;
      }
    }

    if (!learnFromPerformance) {
      // Freezing is the explicit act; leaving it unfrozen is the default, so
      // there is nothing to call in the other direction.
      await invoke('learning.freeze', { genomeId, enabled: true });
    }

    const created = await invoke<{ campaignId: string }>(
      'campaign.create',
      {
        genomeId,
        // Trimmed, with the derived default as the floor: `campaign.create`
        // requires a non-empty name and an owner who clears the field should get
        // a working campaign, not a validation error on the last step.
        name: name.trim() || `${new Date().toLocaleString('en', { month: 'long' })} campaign`,
        objective,
        windowDays,
        platforms: selected,
        approvalMode,
        // The wizard has asked all six, so it sends all six rather than letting
        // the server fall back to its own defaults for fields the owner just
        // answered. `engagementRung` and `approvalMode` were preselected from
        // the brand at mount, so sending them re-states the brand's posture
        // rather than overriding it — see the seeding effect.
        campaignType,
        weight,
        engagementRung,
        learnFromPerformance,
        adjustMixAutomatically,
        ...(ctaUrl.trim() ? { primaryCta: ctaUrl.trim() } : {}),
        ...(targetCount.trim() && Number(targetCount) > 0 ? { targetCount: Number(targetCount) } : {}),
        ...(targetLabel.trim() ? { targetLabel: targetLabel.trim() } : {}),
      },
      // Non-idempotent: without a key the API refuses, which is the guard
      // against a double-click creating two campaigns.
      `campaign:${genomeId}:${Date.now()}`,
    );

    if (created.status !== 'succeeded') {
      setBusy(false);
      setError(created.status === 'failed' ? created.error.message : 'That request was gated.');
      return;
    }

    // §8.4: "Campaign activation triggers: initial posting plan and schedule;
    // creation of content items with statuses." That is this call.
    const generated = await invoke<{ slotCount: number }>('calendar.generate', {
      campaignId: created.output.campaignId,
    });
    setBusy(false);
    if (generated.status !== 'succeeded') {
      setError(
        generated.status === 'failed'
          ? `The campaign was created but its calendar was not: ${generated.error.message}`
          : 'The campaign was created but generating its calendar was gated.',
      );
      return;
    }

    /**
     * Zero slots is a success with nothing in it, and it is reported rather than
     * handed off silently.
     *
     * The calendar explains it too, immediately, on the screen this hands back to
     * — but the moment that needs the explanation is *this* one: the owner just
     * pressed "Activate campaign" and the honest answer is "done, and nothing can
     * be built yet, here is what closes that". Handing back to a screen that says
     * "Nothing scheduled yet" makes them go looking for the step they missed.
     */
    if (generated.output.slotCount === 0) {
      setEmptyResult({
        campaignId: created.output.campaignId,
        planned: plan ? mixTotal(plan.mix) : 0,
      });
      return;
    }

    onActivated(created.output.campaignId);
  }

  const connectedCount = platforms?.filter((p) => p.connected).length ?? 0;

  /**
   * The campaign exists and its calendar is empty — said here rather than left to
   * the screen behind this one.
   *
   * Not an error state: nothing failed, and the wording has to make that clear
   * while still being the reason. The gaps and the fix come from
   * `EmptyCalendarReason`, the same component the calendar uses, so the two
   * screens cannot come to say different things about the same brand.
   */
  if (emptyResult) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">Created</p>
        <h2 className="mt-1 text-[20px] font-medium text-ink">
          {name.trim() || 'Your campaign'} is set up
        </h2>
        <p className="mt-1.5 max-w-prose text-[13px] text-ink-muted">
          The campaign, its window and its oversight are all saved. It has no posts in it yet though, and
          that is worth reading before you go looking for a step you missed.
        </p>

        <div className="mt-5">
          <EmptyCalendarReason genomeId={genomeId} plannedCount={emptyResult.planned} />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <Button onClick={() => onActivated(emptyResult.campaignId)}>Go to the calendar</Button>
          <span className="text-[13px] text-ink-muted">
            You can regenerate the calendar there once you have added something.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
            Step {step} of 6
          </p>
          <h2 className="mt-1 text-[20px] font-medium text-ink">{STEP_TITLES[step]}</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {/* Progress. Six segments, because six is few enough to show honestly. */}
      <div className="mt-4 flex gap-1" aria-hidden>
        {([1, 2, 3, 4, 5, 6] as Step[]).map((s) => (
          <span
            key={s}
            className={cn('h-1 flex-1 rounded-full', s <= step ? 'bg-primary' : 'bg-border')}
          />
        ))}
      </div>

      <div className="mt-6">
        {/* ── CMP-01.1 ────────────────────────────────────────────────── */}
        {step === 1 ? (
          <div className="grid grid-cols-1 gap-5">
            {/* Asked, not derived. Two campaigns started in the same month were
                both "August campaign" and told apart by nothing. */}
            <div>
              <label className="text-[12px] font-medium text-ink-muted" htmlFor="cmp-name">
                Call it
              </label>
              <Input
                id="cmp-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                placeholder="August campaign"
                className="mt-1.5 max-w-md"
              />
              <p className="mt-1 text-[12px] text-ink-muted">
                Just for you &mdash; it is how you will tell this campaign from the next one.
              </p>
            </div>

            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {OBJECTIVES.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => setObjective(o.value)}
                    aria-pressed={objective === o.value}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      objective === o.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-surface-muted',
                    )}
                  >
                    <span className="block text-[14px] font-medium text-ink">{o.label}</span>
                    <span className="mt-0.5 block text-[12px] text-ink-muted">{o.hint}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="text-[12px] font-medium text-ink-muted" htmlFor="cmp-window">
                  Over how long
                </label>
                <select
                  id="cmp-window"
                  value={windowDays}
                  onChange={(e) => setWindowDays(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-lg border border-border bg-field px-3 py-2 text-[14px] text-ink"
                >
                  <option value={14}>2 weeks</option>
                  <option value={30}>A month</option>
                  <option value={60}>2 months</option>
                  <option value={90}>3 months</option>
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-ink-muted" htmlFor="cmp-target">
                  Target (optional)
                </label>
                <Input
                  id="cmp-target"
                  value={targetCount}
                  inputMode="numeric"
                  onChange={(e) => setTargetCount(e.target.value)}
                  placeholder="40"
                  className="mt-1.5"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-ink-muted" htmlFor="cmp-target-label">
                  Of what
                </label>
                <Input
                  id="cmp-target-label"
                  value={targetLabel}
                  onChange={(e) => setTargetLabel(e.target.value)}
                  placeholder="bookings"
                  className="mt-1.5"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button disabled={busy} onClick={() => void propose()}>
                {busy ? 'Working it out…' : 'See the plan'}
              </Button>
            </div>
          </div>
        ) : null}

        {/* ── CMP-01.2 ────────────────────────────────────────────────── */}
        {step === 2 && plan ? (
          <div className="grid grid-cols-1 gap-5">
            <div className="rounded-lg border border-border bg-surface-muted p-4">
              <p className="text-[14px] text-ink">{plan.why.summary}</p>
              <WhyPopover why={plan.why} label="How this plan was worked out" />
            </div>

            {/* The type, preselected from the goal. Deliberately *not* framed as
                SPARK's choice — see TYPE_FOR_OBJECTIVE. */}
            <div>
              <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
                What kind of campaign
              </p>
              <p className="mt-1 text-[13px] text-ink-muted">
                Preselected from your goal. Change it if it is the wrong shape for what you have in mind.
              </p>
              <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CAMPAIGN_TYPES.map((t) => (
                  <li key={t.value}>
                    <button
                      type="button"
                      aria-pressed={campaignType === t.value}
                      onClick={() => setTypeChoice(t.value)}
                      className={cn(
                        'w-full rounded-lg border p-3 text-left transition-colors',
                        campaignType === t.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-surface-muted',
                      )}
                    >
                      <span className="block text-[14px] font-medium text-ink">{t.label}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-muted">{t.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* The mix describes the *plan's* balance, so it is both labelled
                and scaled by the plan total.

                It used to be labelled `{plan.buildableNow} posts SPARK can make
                right now` — which read "0 posts SPARK can make right now" above
                five rows summing to 13 — and each bar was divided by
                `buildableNow` too, so with nothing buildable yet every width
                came out as `count * 100%` and the track's `overflow-hidden`
                clipped all five to full. The chart carried no information in
                exactly the case a new brand always starts in.

                How many are buildable today is a different fact, and the
                summary above already states it against the alternative
                ("0 posts from what you have now — 13 if you film 3 × 5
                minutes"), which is the comparison that tells someone what to
                do next. */}
            <div>
              <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
                {mixTotal(plan.mix)} posts, balanced like this
              </p>
              <ul className="mt-2 grid grid-cols-1 gap-1.5">
                {plan.mix
                  .filter((m) => m.count > 0)
                  .map((m) => (
                    <li key={m.pillar} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-[13px] capitalize text-ink">{m.pillar}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.round((m.count / Math.max(1, mixTotal(plan.mix))) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="w-8 text-right text-[13px] tabular-nums text-ink-muted">
                        {m.count}
                      </span>
                    </li>
                  ))}
              </ul>
              <p className="mt-3 text-[12px] text-ink-muted">
                You can shift this balance any time from the calendar — nothing here is locked in.
              </p>
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)}>Looks right</Button>
            </div>
          </div>
        ) : null}

        {/* ── CMP-01.3 ────────────────────────────────────────────────── */}
        {step === 3 ? (
          <div className="grid grid-cols-1 gap-5">
            <div>
              <label className="text-[12px] font-medium text-ink-muted" htmlFor="cmp-cta">
                Where should posts send people?
              </label>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                A booking page, a product page, a form. Every post that needs a link uses this one.
              </p>
              <Input
                id="cmp-cta"
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://…"
                className="mt-1.5"
              />
            </div>

            <div>
              <label className="text-[12px] font-medium text-ink-muted" htmlFor="cmp-offer">
                Anything specific to push? (optional)
              </label>
              <Input
                id="cmp-offer"
                value={offerNote}
                onChange={(e) => setOfferNote(e.target.value)}
                placeholder="20% off first visit through August"
                className="mt-1.5"
              />
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const ok = await saveOffer();
                  setBusy(false);
                  if (ok) setStep(4);
                }}
              >
                {busy ? 'Saving…' : 'Next'}
              </Button>
            </div>
          </div>
        ) : null}

        {/* ── CMP-01.4 ────────────────────────────────────────────────── */}
        {step === 4 ? (
          <div className="grid grid-cols-1 gap-5">
            {platforms === null ? (
              <Skeleton className="h-32 w-full rounded-lg" />
            ) : connectedCount === 0 ? (
              <div className="rounded-lg border border-border bg-surface-muted p-4">
                <p className="text-[14px] font-medium text-ink">No accounts connected yet</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  SPARK will plan and draft the whole month, and hold everything until you connect an
                  account in Settings. Nothing is lost by continuing.
                </p>
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {platforms
                  .filter((p) => p.connected)
                  .map((p) => {
                    const on = selected.includes(p.platform);
                    return (
                      <li key={p.platform}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setSelected((prev) =>
                              prev.includes(p.platform)
                                ? prev.filter((x) => x !== p.platform)
                                : [...prev, p.platform],
                            )
                          }
                          className={cn(
                            'w-full rounded-lg border p-3 text-left transition-colors',
                            on ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
                          )}
                        >
                          <span className="block text-[14px] font-medium text-ink">
                            {platformLabel(p.platform)}
                          </span>
                          <span className="mt-0.5 block text-[12px] text-ink-muted">
                            {p.accountLabel ?? 'Connected'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(3)}>
                Back
              </Button>
              <Button onClick={() => setStep(5)}>Next</Button>
            </div>
          </div>
        ) : null}

        {/* ── CMP-01.5 ────────────────────────────────────────────────── */}
        {step === 5 ? (
          <div className="grid grid-cols-1 gap-6">
            {/* The prototype's step 5 has five groups. Four are here; its
                "Campaign Duration" is not, because the window is asked on step 1
                and a second control for the same field is how two answers come
                to disagree. */}
            <Group
              title="Content responsibility"
              hint="What this campaign may publish without you looking first."
            >
              <ul className="grid grid-cols-1 gap-2">
                {APPROVAL_MODES.map((m) => (
                  <li key={m.value}>
                    <button
                      type="button"
                      aria-pressed={approvalMode === m.value}
                      onClick={() => {
                        governanceTouched.current = true;
                        setApprovalMode(m.value);
                      }}
                      className={cn(
                        'w-full rounded-lg border p-3 text-left transition-colors',
                        approvalMode === m.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-surface-muted',
                      )}
                    >
                      <span className="block text-[14px] font-medium text-ink">{m.label}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-muted">{m.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>

              <label className="mt-2 flex items-start gap-3 rounded-lg border border-border p-3">
                <input
                  type="checkbox"
                  checked={applyToWholeBrand}
                  onChange={(e) => setApplyToWholeBrand(e.target.checked)}
                  className="mt-1 size-4 accent-[--ss-primary]"
                />
                <span>
                  <span className="text-[14px] font-medium text-ink">Use this for every campaign</span>
                  <span className="mt-0.5 block text-[13px] text-ink-muted">
                    Off by default: this choice applies to this campaign only, so a cautious launch does
                    not put your routine posting into review as well.
                  </span>
                </span>
              </label>
            </Group>

            {/* The ladder. Greyed out in the prototype; live here, and the one
                control on this screen that governs something irreversible —
                `policy.ts` rule 6 reads it through `rungAutonomy` before any
                reply goes out. */}
            <Group
              title="Engagement responsibilities"
              hint="How far it may go with comments and DMs. Each rung includes the ones below it."
            >
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {RUNGS.map((r) => (
                  <li key={r.value}>
                    <button
                      type="button"
                      aria-pressed={engagementRung === r.value}
                      onClick={() => {
                        governanceTouched.current = true;
                        setEngagementRung(r.value);
                      }}
                      className={cn(
                        'h-full w-full rounded-lg border p-3 text-left transition-colors',
                        engagementRung === r.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-surface-muted',
                      )}
                    >
                      <span className="block text-[14px] font-medium text-ink">{r.label}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-muted">{r.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {/* Said only on the rung it applies to, because on any other rung
                  the handoff rules are dormant and pointing at them would send
                  someone to change a setting and watch nothing happen. */}
              {engagementRung === 'sales_assist' ? (
                <p className="mt-2 text-[12px] text-ink-muted">
                  Where hot and warm leads go is set once for the brand, in Settings → Engagement. Words
                  you never want answered automatically are honoured on every rung, not just this one.
                </p>
              ) : null}
            </Group>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <Group
                title="Optimisation and learning"
                hint="Whether it adapts on its own as results come in."
              >
                <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <input
                    type="checkbox"
                    checked={learnFromPerformance}
                    onChange={(e) => setLearnFromPerformance(e.target.checked)}
                    className="mt-1 size-4 accent-[--ss-primary]"
                  />
                  <span>
                    <span className="text-[14px] font-medium text-ink">Learn from performance</span>
                    <span className="mt-0.5 block text-[13px] text-ink-muted">
                      What this audience responds to feeds back into what gets made next.
                    </span>
                  </span>
                </label>
                <label className="mt-2 flex items-start gap-3 rounded-lg border border-border p-3">
                  <input
                    type="checkbox"
                    checked={adjustMixAutomatically}
                    onChange={(e) => setAdjustMixAutomatically(e.target.checked)}
                    className="mt-1 size-4 accent-[--ss-primary]"
                  />
                  <span>
                    <span className="text-[14px] font-medium text-ink">Adjust the content mix</span>
                    <span className="mt-0.5 block text-[13px] text-ink-muted">
                      Lets the balance between pillars move over the month rather than holding the shape
                      you approved.
                    </span>
                  </span>
                </label>
              </Group>

              <Group title="Campaign frequency" hint="How much attention should this get?">
                <div className="flex gap-2">
                  {WEIGHTS.map((w) => (
                    <button
                      key={w.value}
                      type="button"
                      aria-pressed={weight === w.value}
                      onClick={() => setWeight(w.value)}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors',
                        weight === w.value
                          ? 'border-primary bg-primary/5 text-ink'
                          : 'border-border text-ink-muted hover:bg-surface-muted',
                      )}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[13px] text-ink-muted">
                  {WEIGHTS.find((w) => w.value === weight)?.hint}
                </p>
              </Group>
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(4)}>
                Back
              </Button>
              <Button onClick={() => setStep(6)}>Next</Button>
            </div>
          </div>
        ) : null}

        {/* ── CMP-01.6 ────────────────────────────────────────────────── */}
        {step === 6 ? (
          <div className="grid grid-cols-1 gap-5">
            <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
              <Row label="Name" value={name.trim() || 'August campaign'} />
              <Row label="Goal" value={OBJECTIVES.find((o) => o.value === objective)?.label ?? objective} />
              <Row
                label="Type"
                value={CAMPAIGN_TYPES.find((t) => t.value === campaignType)?.label ?? campaignType}
              />
              <Row label="Over" value={`${windowDays} days`} />
              <Row
                label="Weight"
                value={WEIGHTS.find((w) => w.value === weight)?.label ?? weight}
                note={WEIGHTS.find((w) => w.value === weight)?.hint}
              />
              {/* Both numbers, because either alone misleads here.
                  `plan.buildableNow` on its own — what this showed — said
                  "Posts planned: 0" for any brand without assets yet, which is
                  every brand at this point in onboarding, and made the plan
                  look empty on the screen that asks you to commit to it. The
                  plan total on its own overstates it the other way: activation
                  places `plan.mix`, but `placeCalendar` can only fill a slot a
                  ready playbook serves, so with nothing filmed the calendar
                  that appears next genuinely reads "0 posts".

                  "0 of 13" matches that calendar and still shows the size of
                  what was planned, and the note says what closes the gap. */}
              <Row
                label="Posts planned"
                value={
                  plan
                    ? plan.buildableNow === mixTotal(plan.mix)
                      ? `${mixTotal(plan.mix)}`
                      : `${plan.buildableNow} of ${mixTotal(plan.mix)}`
                    : '—'
                }
                note={
                  plan && plan.buildableNow < mixTotal(plan.mix)
                    ? 'Filming unlocks the rest — SPARK will ask, and the calendar fills in as you send clips.'
                    : undefined
                }
              />
              <Row
                label="Posting to"
                value={
                  selected.length
                    ? selected.map((p) => platformLabel(p)).join(', ')
                    : 'Nothing connected yet'
                }
              />
              <Row
                label="Oversight"
                value={`${APPROVAL_MODES.find((m) => m.value === approvalMode)?.label ?? approvalMode}${
                  applyToWholeBrand ? ' — for every campaign' : ' — this campaign only'
                }`}
              />
              {/* The rung, in the same words step 5 used. `sales_assist` is the
                  only one that reaches outside this campaign for its settings,
                  so it is the only one that says so. */}
              <Row
                label="Comments and DMs"
                value={RUNGS.find((r) => r.value === engagementRung)?.label ?? engagementRung}
                note={
                  engagementRung === 'sales_assist'
                    ? 'Handoff rules come from Settings → Engagement.'
                    : RUNGS.find((r) => r.value === engagementRung)?.hint
                }
              />
              <Row
                label="Learning"
                value={
                  !learnFromPerformance
                    ? 'Frozen for now'
                    : adjustMixAutomatically
                      ? 'Learns, and may shift the mix'
                      : 'Learns, mix stays as approved'
                }
              />
              <Row label="CTA" value={ctaUrl.trim() || 'None set'} />
            </dl>

            <p className="text-[13px] text-ink-muted">
              Activating writes the plan onto your calendar and SPARK starts working through it. You can
              pause it at any time from the Command Center.
            </p>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(5)}>
                Back
              </Button>
              <Button disabled={busy} onClick={() => void activate()}>
                {busy ? 'Activating…' : 'Activate campaign'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-4 text-[13px] text-ink-muted">{error}</p> : null}
    </section>
  );
}

/**
 * One labelled group of controls on step 5.
 *
 * Step 5 asks four unrelated questions — what it may publish, how far it may go
 * with replies, whether it adapts, and how loud it should be — and before the
 * last three existed it was a flat stack that read as one list. The headings are
 * what stop "Adjust the content mix" from looking like another approval mode.
 */
function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[14px] font-medium text-ink">{title}</h3>
      <p className="mt-0.5 text-[13px] text-ink-muted">{hint}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-surface p-3">
      <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[14px] text-ink">{value}</dd>
      {/* The confirm step is the last chance to say something that changes the
          decision, and "how many of these need filming first" is the only fact
          here that does. */}
      {note ? <dd className="mt-0.5 break-words text-[12px] text-ink-muted">{note}</dd> : null}
    </div>
  );
}
