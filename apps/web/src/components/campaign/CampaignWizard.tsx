'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRef } from 'react';
import {
  rungFromBrandAutonomy,
  type CampaignType,
  type CampaignWeight,
  type EngagementRung,
} from '@sparksocial/shared';
import { invoke } from '@/lib/tools';
import { Button } from '@/components/ui/button';
import { EmptyCalendarReason } from '@/components/calendar/EmptyCalendarReason';
import { MissingFactsRequest } from '@/components/campaign/MissingFactsRequest';
import type { Explanation } from '@/components/explain/WhyPopover';
import {
  AgentOrb,
  Chevron,
  ModalBlobs,
  STAGE,
  STEP_GEOM,
  Spinner,
  isLateHeader,
  type Step,
} from './campaignChrome';
import { CampaignIntro } from './CampaignIntro';
import { GoalStep, TypeStep } from './CampaignChoiceSteps';
import { OfferStep, type BrandCard } from './CampaignOfferStep';
import { AccountsStep, type PlatformStatus } from './CampaignAccountsStep';
import { AutonomyStep } from './CampaignAutonomyStep';
import { ReviewStep } from './CampaignReviewStep';
import { GOAL_CARDS, TYPE_CARDS, EXTRA_OBJECTIVES } from './campaignDraft';

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
  /**
   * Facts the brand has not supplied that its formats read directly.
   *
   * Null when there are none. This is the fix for a campaign that looked complete
   * and was not: fourteen playbooks read `genome:offer.primary_cta`, nothing
   * checked it, and the refusal landed a week later when somebody opened a post.
   */
  answers: {
    missing: Array<{ path: string; label: string; hint: string; fixWith: string }>;
    unlocksPosts: number;
    blockedPlaybooks: number;
  } | null;
  why: Explanation;
}

export function CampaignWizard({
  genomeId,
  onActivated,
  onCancel,
  showIntro = false,
}: {
  genomeId: string;
  onActivated: (campaignId: string) => void;
  onCancel: () => void;
  /**
   * Show the prototype's entry card before step 1.
   *
   * Off by default: the calendar mounts this on a button press, where an "are
   * you sure you want to begin" card is a second click for nothing. The
   * first-run route turns it on.
   */
  showIntro?: boolean;
}) {
  const [step, setStep] = useState<Step>(1);


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

  /** The stage scale — see `campaignChrome.tsx`. */
  const [pageW, setPageW] = useState(STAGE);
  /** The prototype's entry card. Only shown where a caller asks for it. */
  const [intro, setIntro] = useState(showIntro);

  // CMP-01.1
  /**
   * Which of the design's four goal cards is chosen, if any.
   *
   * Stored beside `objective` rather than derived from it because two cards
   * write `audience` — see `campaignDraft.ts`. Null means the objective came
   * from the row beneath the grid instead.
   */
  const [goalKey, setGoalKey] = useState<string | null>('leads');
  const [objective, setObjective] = useState<string>('leads');
  const [windowDays, setWindowDays] = useState(30);

  // CMP-01.2
  const [plan, setPlan] = useState<ProposedPlan | null>(null);
  /**
   * Null means "whatever the goal implies", so changing the goal on step 1 keeps
   * the suggestion current — until the owner picks a type, after which their
   * choice survives going back and forth. An effect that re-derived the type on
   * every objective change would quietly undo that choice.
   */
  const [typeChoice, setTypeChoice] = useState<CampaignType | null>(null);
  /** What the chosen goal card implies, until step 2 is answered outright. */
  const [suggestedType, setSuggestedType] = useState<CampaignType>('lead_magnet');
  const campaignType: CampaignType = typeChoice ?? suggestedType;

  // CMP-01.3
  /** The design gates the URL field behind a switch; unset means "no CTA". */
  const [ctaOn, setCtaOn] = useState(false);
  const [ctaUrl, setCtaUrl] = useState('');

  // CMP-01.4
  const [platforms, setPlatforms] = useState<PlatformStatus[] | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  // CMP-01.5
  const [approvalMode, setApprovalMode] = useState<string>('review_first_week');
  const [learnFromPerformance, setLearnFromPerformance] = useState(true);
  const [adjustMixAutomatically, setAdjustMixAutomatically] = useState(true);
  const [weight, setWeight] = useState<CampaignWeight>('balanced');
  const [engagementRung, setEngagementRung] = useState<EngagementRung>('observe');
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

  /** The brand card on step 3, and the agent's name in the header. */
  const [brand, setBrand] = useState<BrandCard | null>(null);
  const [agentName, setAgentName] = useState('your agent');
  const [timezone, setTimezone] = useState('UTC');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set when somebody chooses "Continue without it".
   *
   * Per-session and not persisted: the request is worth making once per attempt
   * at this campaign, and a stored dismissal would mean the one screen that could
   * have caught the empty CTA never asked again.
   */
  const [answersDismissed, setAnswersDismissed] = useState(false);

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

  /*
    `genome.offer.set` used to be called here, writing a named product from a
    free-text "what are you pushing" field on step 3.

    The design's step 3 has no such field: its anchor is the brand card — what
    SPARK already knows about the brand — plus the campaign's CTA url. So there
    is nothing to write to the *brand's* offer, and the url goes where it
    belongs, on `campaigns.primary_cta`, which is also where a destination that
    lasts one campaign should live. Products are edited in the Brand Kit, which
    is where both buttons on that step now go.
  */

  /* CMP-01.6 — activate. Four calls, in the order their effects depend on. */
  async function activate() {
    setBusy(true);
    setError(null);

    /**
      * The oversight choice is stored on the *campaign*, not the brand — PRD
      * §7.2's per-campaign approval scope.
      *
      * `agent.approval_mode.set` used to be called here behind an "apply to the
      * whole brand" tickbox. The design has no such control, and its absence is
      * the better default: activating a cautious launch campaign should not
      * quietly put every *other* running campaign into review too. The brand's
      * own posture is changed in the Brand Kit, deliberately, on its own screen.
      */

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
    /**
      * The button says "Activate campaign", so the campaign is activated.
      *
      * It was not. `campaign.create` writes `status: 'draft'` and nothing here
      * moved it, so every campaign built through this wizard claimed to be
      * activated and sat in draft — with the Command Center saying, correctly and
      * contradictorily, *"is planned but not activated, so nothing is going out
      * yet"* on the screen the wizard hands off to.
      *
      * After `calendar.generate`, not before: activating a campaign with no
      * calendar would make it the outcome SPARK plans against while having nothing
      * planned. §8.4's order — plan, schedule, then run — is the order here.
      *
      * A failure is reported without unwinding. The campaign and its calendar both
      * exist and are correct; what failed is one status write, and the calendar's
      * own Activate button is right there. Deleting a good campaign to make the
      * error tidy would be worse than saying which step did not finish.
      */
    const activated = await invoke(
      'campaign.resume',
      { campaignId: created.output.campaignId },
      `campaign.activate:${created.output.campaignId}`,
    );
    if (activated.status !== 'succeeded') {
      setError(
        activated.status === 'failed'
          ? `The campaign and its calendar were created, but activating it did not finish: ${activated.error.message}. You can activate it from the calendar.`
          : 'The campaign and its calendar were created. Activating it needs approval — do it from the calendar.',
      );
      return;
    }

    if (generated.output.slotCount === 0) {
      setEmptyResult({
        campaignId: created.output.campaignId,
        planned: plan ? mixTotal(plan.mix) : 0,
      });
      return;
    }

    onActivated(created.output.campaignId);
  }


  /* The stage scales to the viewport, exactly as the prototype's own script
     does — a resize listener plus one read at mount. */
  useEffect(() => {
    const onResize = () => setPageW(window.innerWidth || STAGE);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /**
   * The brand card, the agent's name and the timezone — three reads that fill
   * the header on every step and the card on step 3.
   *
   * `brand.governance.get` carries the logo, colours, fonts, timezone and the
   * agent's own voice adjectives; `genome.list` carries the brand's name;
   * `knowledge.list` carries what SPARK has actually read about it. A failed
   * read leaves the card empty rather than filled with something plausible.
   */
  useEffect(() => {
    void (async () => {
      const [gov, list, docs] = await Promise.all([
        invoke<{
          logoUrl?: string;
          brandColors: string[];
          brandFonts?: { display?: string; body?: string };
          timezone: string;
          agentIdentity: { name: string; voice: string[] };
        }>('brand.governance.get', {}),
        invoke<{ genomes: Array<{ genomeId: string; name: string }> }>('genome.list', {}),
        invoke<{ docs: Array<{ docId: string; citationLabel?: string; preview: string }> }>(
          'knowledge.list',
          { genomeId },
        ),
      ]);

      const g = gov.status === 'succeeded' ? gov.output : null;
      if (g) {
        setAgentName(g.agentIdentity.name);
        setTimezone(g.timezone);
      }

      const name =
        list.status === 'succeeded'
          ? (list.output.genomes.find((x) => x.genomeId === genomeId)?.name ?? 'This brand')
          : 'This brand';

      setBrand({
        name,
        logoUrl: g?.logoUrl,
        colors: g?.brandColors ?? [],
        fonts: g?.brandFonts ?? {},
        timezone: g?.timezone ?? 'UTC',
        voice: g?.agentIdentity.voice ?? [],
        docs:
          docs.status === 'succeeded'
            ? docs.output.docs.map((d) => ({
                docId: d.docId,
                label: d.citationLabel ?? 'Attached document',
                preview: d.preview,
              }))
            : [],
      });
    })();
  }, [genomeId]);

  /**
   * Connecting an account from the tile grid.
   *
   * `integration.connect` is `human_only`, so it can only run from a real
   * click — which is what this is. It answers with an authorize url that has to
   * be opened in a window the user drives; the tiles re-read on focus, so
   * coming back from the provider updates the grid without a reload.
   */
  async function connectPlatform(platform: string) {
    setConnecting(platform);
    setError(null);
    const res = await invoke<{ authorizeUrl: string }>('integration.connect', { platform });
    setConnecting(null);
    if (res.status !== 'succeeded') {
      setError(
        res.status === 'failed'
          ? res.error.message
          : 'Connecting an account needs an approval this screen cannot give.',
      );
      return;
    }
    window.open(res.output.authorizeUrl, '_blank', 'noopener');
  }

  /* Coming back from a provider's consent screen should show the new account. */
  useEffect(() => {
    if (step !== 4) return;
    const refresh = () => setPlatforms(null);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [step]);

  const goalLabel =
    GOAL_CARDS.find((c) => c.key === goalKey)?.title ??
    EXTRA_OBJECTIVES.find((o) => o.value === objective)?.label ??
    objective;

  /**
   * The campaign's name, derived — the design never asks for one.
   *
   * It carries the goal as well as the month, because "August campaign" twice
   * over is what this used to produce and two campaigns started in the same
   * month were then indistinguishable in any list. The goal is the thing that
   * actually differs between two campaigns started together, so it is what
   * tells them apart. Renaming lives on the calendar, where campaigns are
   * managed; putting a field here would add a seventh question to a six-step
   * form the design deliberately keeps to six.
   */
  const name = `${new Date().toLocaleString('en', { month: 'long' })} ${goalLabel.toLowerCase()}`;


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
  /**
   * The stage, scaled.
   *
   * The prototype places every element absolutely on a 1728-wide stage and
   * scales the whole thing by `pageW / 1728`. That is reproduced rather than
   * reflowed — see `campaignChrome.tsx` for why this screen earns the
   * exception.
   */
  const geom = STEP_GEOM[step];
  const scale = pageW / STAGE;

  if (intro) {
    return (
      <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-label="Create a campaign">
        <div className="relative w-full overflow-hidden" style={{ height: Math.round(1117 * scale) }}>
          <div className="absolute left-0 top-0 w-[1728px] origin-top-left" style={{ transform: `scale(${scale})`, height: 1117 }}>
            <CampaignIntro onStart={() => setIntro(false)} onLater={onCancel} />
          </div>
        </div>
      </div>
    );
  }

  const lateHdr = isLateHeader(step);
  const hdrTop = lateHdr ? 51.262 : 46.262;
  const progTop = lateHdr ? 80.961 : 75.961;
  const avTop = step === 1 ? 109 : 104;

  /** Continue on the last step activates; everywhere else it advances. */
  function forward() {
    setError(null);
    if (step === 1) {
      void propose();
      return;
    }
    if (step === 6) {
      void activate();
      return;
    }
    setStep((step + 1) as Step);
  }

  function backward() {
    setError(null);
    if (step === 1) {
      onCancel();
      return;
    }
    setStep((step - 1) as Step);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Create a campaign">
      <div className="relative w-full overflow-hidden" style={{ height: Math.round(geom.frame * scale) }}>
        <div className="absolute left-0 top-0 w-[1728px] origin-top-left" style={{ transform: `scale(${scale})`, height: geom.frame }}>
          {/* The scrim. Clicking it leaves, the way a modal backdrop should. */}
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="absolute left-0 top-0 w-[1728px] cursor-default"
            style={{ height: geom.frame, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(10px)' }}
          />

          <div
            className="absolute w-cmp-modal overflow-hidden rounded-2xl bg-surface-200"
            style={{ left: 346, top: geom.modalTop, height: geom.modalH }}
          >
            <ModalBlobs />

            {/* ── header ────────────────────────────────────────────────── */}
            <button
              type="button"
              onClick={backward}
              className="absolute left-[47px] h-[43.522px] w-[110.023px] cursor-pointer rounded-[8.457px] transition-colors hover:bg-white/60 active:scale-[0.98]"
              style={{ top: hdrTop, backdropFilter: 'blur(26.946px)', boxShadow: '0 0 0 0.846px rgb(131,131,131)' }}
            >
              <Chevron className="absolute left-[13.532px] top-[14.125px]" style={{ transform: 'scaleX(-1)' }} />
              <span className="absolute left-[55px] top-[10.996px] whitespace-nowrap text-[16.915px] font-medium leading-[1.269]" style={{ color: 'rgb(131,131,131)' }}>
                Back
              </span>
            </button>

            <button
              type="button"
              onClick={forward}
              disabled={busy}
              className="absolute left-[857.023px] h-[43px] w-[132px] cursor-pointer rounded-[8.457px] transition-colors hover:bg-white/60 active:scale-[0.98] disabled:opacity-60"
              style={{ top: hdrTop, background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(26.946px)' }}
            >
              <span className="absolute top-[10.768px] whitespace-nowrap text-[16.915px] font-medium leading-[1.269] text-ink" style={{ left: step === 6 ? 18 : 15 }}>
                {busy ? 'Working…' : step === 6 ? 'Activate' : 'Continue'}
              </span>
              <Chevron className="absolute left-[109.135px] top-[13.864px]" color="rgb(12,12,12)" />
            </button>

            <span className="absolute left-[265px] top-[47px] whitespace-nowrap text-[18px] font-semibold leading-none text-ink">
              Step {step}
              <span className="font-normal"> of 6</span>
            </span>

            <div
              className="absolute left-[264px] h-[15px] w-cmp-progress overflow-hidden rounded-[16.843px]"
              style={{ top: progTop, background: 'rgba(12,12,12,0.05)' }}
              role="progressbar"
              aria-valuenow={step}
              aria-valuemin={1}
              aria-valuemax={6}
              aria-label={`Step ${step} of 6`}
            >
              <div
                className="absolute left-[1px] top-[1.039px] h-[13px] rounded-[24.137px] bg-cmp-progress"
                style={{ width: geom.prog, transition: 'width 0.5s cubic-bezier(0.22,1,0.36,1)' }}
              />
            </div>

            <div className="absolute left-[514px] top-[49px] h-[18px] w-[258px]">
              <Spinner className="absolute left-0 top-[2px]" />
              <span className="absolute right-0 top-0 whitespace-nowrap text-right text-[14px] font-normal leading-none" style={{ color: 'rgb(131,131,131)' }}>
                Assigning this campaign to <span className="font-bold text-purple">{agentName}</span>
              </span>
            </div>

            {step !== 6 ? <AgentOrb size={113} className="left-[461px]" style={{ top: avTop }} /> : null}

            {/* ── the step ──────────────────────────────────────────────── */}
            {step === 1 ? (
              <GoalStep
                goalKey={goalKey}
                objective={objective}
                onPickCard={(c) => {
                  setGoalKey(c.key);
                  setObjective(c.objective);
                  // The card carries the type it implies; an explicit later
                  // choice on step 2 still wins, which is why this only seeds
                  // the suggestion rather than setting `typeChoice`.
                  setSuggestedType(c.type);
                }}
                onPickExtra={(v) => {
                  setGoalKey(null);
                  setObjective(v);
                }}
              />
            ) : null}

            {step === 2 ? <TypeStep value={campaignType} onPick={setTypeChoice} /> : null}

            {step === 3 ? (
              <>
                <OfferStep
                  brand={brand}
                  ctaOn={ctaOn}
                  ctaUrl={ctaUrl}
                  onToggleCta={() => {
                    setCtaOn((v) => !v);
                    if (ctaOn) setCtaUrl('');
                  }}
                  onCtaUrl={setCtaUrl}
                />
                {/*
                  Facts the brand has not supplied that its formats read
                  directly. The design has no slot for this; it is shown anyway,
                  below the panel, because it is the one check that catches a
                  campaign which looks complete and produces refusals a week
                  later. Step 3 is where it belongs — these are offer facts.
                */}
                {plan?.answers && !answersDismissed ? (
                  <div className="absolute left-[199px] top-[1032px] w-[638px]">
                    <MissingFactsRequest
                      genomeId={genomeId}
                      facts={plan.answers.missing}
                      unlocksPosts={plan.answers.unlocksPosts}
                      blockedPlaybooks={plan.answers.blockedPlaybooks}
                      onFilled={propose}
                      onSkip={() => setAnswersDismissed(true)}
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            {step === 4 ? (
              <AccountsStep
                platforms={platforms}
                selected={selected}
                onToggle={(p) => setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]))}
                onConnect={(p) => void connectPlatform(p)}
                connecting={connecting}
              />
            ) : null}

            {step === 5 ? (
              <AutonomyStep
                approvalMode={approvalMode}
                onApprovalMode={(m) => {
                  governanceTouched.current = true;
                  setApprovalMode(m);
                }}
                learn={learnFromPerformance}
                onLearn={() => setLearnFromPerformance((v) => !v)}
                mix={adjustMixAutomatically}
                onMix={() => setAdjustMixAutomatically((v) => !v)}
                windowDays={windowDays}
                onWindowDays={setWindowDays}
                weight={weight}
                onWeight={setWeight}
                rung={engagementRung}
                onRung={(r) => {
                  governanceTouched.current = true;
                  setEngagementRung(r);
                }}
                timezone={timezone}
              />
            ) : null}

            {step === 6 ? (
              <ReviewStep
                agentName={agentName}
                brandLogo={brand?.logoUrl}
                goalLabel={goalLabel}
                typeLabel={TYPE_CARDS.find((t) => t.value === campaignType)?.title ?? campaignType}
                windowDays={windowDays}
                weight={weight}
                ctaUrl={ctaUrl.trim()}
                requireApproval={approvalMode === 'review_everything'}
                onRequireApproval={() => {
                  governanceTouched.current = true;
                  setApprovalMode(approvalMode === 'review_everything' ? 'review_first_week' : 'review_everything');
                }}
                onActivate={() => void activate()}
                busy={busy}
              />
            ) : null}

            {error ? (
              <p className="absolute left-[265px] w-[720px] text-[15px] text-destructive" style={{ top: geom.modalH - 42 }} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
