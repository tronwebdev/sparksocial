'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { platformLabel } from '@/lib/platforms';
import { invoke } from '@/lib/tools';
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
 * Step 2 is where this deviates from the sketch, deliberately. §8.4 describes a
 * "campaign type" the agent suggests; the engine has no type dimension —
 * `planCampaign` derives the whole content mix from the objective and the Asset
 * Graph. Inventing a type field to satisfy the wireframe would mean a control
 * that changes nothing. What the owner is shown instead is the proposed *mix*,
 * which is the thing a type would have been a proxy for, and it is adjustable
 * on the calendar afterwards (`CAL-05`'s mix nudge).
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

  // CMP-01.1
  const [objective, setObjective] = useState<string>('bookings');
  const [windowDays, setWindowDays] = useState(30);
  const [targetCount, setTargetCount] = useState('');
  const [targetLabel, setTargetLabel] = useState('');

  // CMP-01.2
  const [plan, setPlan] = useState<ProposedPlan | null>(null);

  // CMP-01.3
  const [ctaUrl, setCtaUrl] = useState('');
  const [offerNote, setOfferNote] = useState('');

  // CMP-01.4
  const [platforms, setPlatforms] = useState<PlatformStatus[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  // CMP-01.5
  const [approvalMode, setApprovalMode] = useState<string>('review_first_week');
  const [learnFromPerformance, setLearnFromPerformance] = useState(true);
  /** Also change the brand's default, not just this campaign's — off by default. */
  const [applyToWholeBrand, setApplyToWholeBrand] = useState(false);

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
   * `CMP-01.3`'s write. Skipped entirely when nothing was entered.
   *
   * `GenomeOffer` carries `primary_cta` and a `products` list, and no free-text
   * summary field — so the "anything specific to push" answer becomes a named
   * product rather than being dropped or a new column being invented for it.
   * The CTA url is attached to that product too, since it is where the offer
   * points.
   */
  async function saveOffer(): Promise<boolean> {
    const cta = ctaUrl.trim();
    const note = offerNote.trim();
    if (!cta && !note) return true;

    const res = await invoke('genome.offer.set', {
      genomeId,
      offer: {
        ...(cta ? { primary_cta: cta } : {}),
        ...(note ? { products: [{ name: note, ...(cta ? { cta_url: cta } : {}) }] } : {}),
      },
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
        name: `${new Date().toLocaleString('en', { month: 'long' })} campaign`,
        objective,
        windowDays,
        platforms: selected,
        approvalMode,
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
    const generated = await invoke('calendar.generate', { campaignId: created.output.campaignId });
    setBusy(false);
    if (generated.status !== 'succeeded') {
      setError(
        generated.status === 'failed'
          ? `The campaign was created but its calendar was not: ${generated.error.message}`
          : 'The campaign was created but generating its calendar was gated.',
      );
      return;
    }

    onActivated(created.output.campaignId);
  }

  const connectedCount = platforms?.filter((p) => p.connected).length ?? 0;

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
          <div className="grid grid-cols-1 gap-5">
            <ul className="grid grid-cols-1 gap-2">
              {APPROVAL_MODES.map((m) => (
                <li key={m.value}>
                  <button
                    type="button"
                    aria-pressed={approvalMode === m.value}
                    onClick={() => setApprovalMode(m.value)}
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

            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                checked={applyToWholeBrand}
                onChange={(e) => setApplyToWholeBrand(e.target.checked)}
                className="mt-1 size-4 accent-[--ss-primary]"
              />
              <span>
                <span className="text-[14px] font-medium text-ink">Use this for every campaign</span>
                <span className="mt-0.5 block text-[13px] text-ink-muted">
                  Off by default: this choice applies to this campaign only, so a cautious launch does not
                  put your routine posting into review as well.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                checked={learnFromPerformance}
                onChange={(e) => setLearnFromPerformance(e.target.checked)}
                className="mt-1 size-4 accent-[--ss-primary]"
              />
              <span>
                <span className="text-[14px] font-medium text-ink">Learn from what works</span>
                <span className="mt-0.5 block text-[13px] text-ink-muted">
                  SPARK shifts the content mix toward whatever this audience actually responds to.
                </span>
              </span>
            </label>

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
              <Row label="Goal" value={OBJECTIVES.find((o) => o.value === objective)?.label ?? objective} />
              <Row label="Over" value={`${windowDays} days`} />
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
