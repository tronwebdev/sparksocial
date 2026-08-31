'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PanelSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { invoke } from '@/lib/tools';
import { AutonomyStep } from './engagement/AutonomyStep';
import { BoundariesStep } from './engagement/BoundariesStep';
import { PlatformsStep, type PlatformDraft } from './engagement/PlatformsStep';
import { SalesStep } from './engagement/SalesStep';
import { VoiceStep } from './engagement/VoiceStep';
import {
  ENGAGEMENT_LEVELS,
  PLATFORMS,
  STEPS,
  STEP_TITLES,
  splitList,
  type EmojiLevel,
  type EngagementAutonomy,
  type EngagementTone,
  type EscalationBehavior,
  type Governance,
  type PlatformsRead,
  type Step,
} from './engagement/types';

/**
 * ENGAGEMENT INTELLIGENCE — `Settings WS Engagement Start` through `… Done`.
 *
 * ── Five screens are five steps, not one long panel ───────────────────────
 *
 * The design draws a Start screen, five steps with a Back/Continue rail, and a
 * Done screen that says "Configured". The build had two of the five as blocks in
 * a single scrolling panel with one Save at the bottom, so three of the design's
 * screens had nowhere to be and the two that existed did not read as a decision
 * with a beginning and an end.
 *
 * ── Each step saves on Continue ───────────────────────────────────────────
 *
 * Not one save at the end. `brand.governance.set` is a partial patch by
 * contract, so a step can send its own fields and nothing else; somebody who
 * abandons the flow at step 4 keeps steps 1 to 3. A single terminal save would
 * throw that away, and would also mean the Done screen's claim depended on a
 * request that had not happened yet at the moment the owner made each choice.
 *
 * ── "Configured" is recorded, not inferred ────────────────────────────────
 *
 * `brands.engagement_configured_at` is stamped by the final Continue. The
 * alternative was to guess from whether any field looked non-default, which gets
 * wrong the one case that matters most: an owner who walks the whole flow and
 * agrees with every default would be told they had never configured it, on the
 * screen whose entire job is to say whether they had.
 *
 * ── What is enforced ──────────────────────────────────────────────────────
 *
 * Autonomy: `policy.ts` rule 6. Message types: the same rule, per kind. Hard
 * rules: four as prohibitions in the reply writer's prompt, and
 * `never_auto_reply_to_complaints` as an escalation before any prompt runs.
 * Keywords: `engage.classify` overrides itself deterministically on a match.
 * Platforms: `applyPlatformOverride`, which can only narrow. Voice and emoji: the
 * writer's prompt. Handoff: `engage.opportunity.create`. The qualification moves
 * are read by the reply writer as what the agent may offer.
 */

export function EngagementPanel() {
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step | null>(null);
  const [configuredAt, setConfiguredAt] = useState<string | undefined>(undefined);

  // Step 1
  const [autonomy, setAutonomy] = useState<EngagementAutonomy>('off');
  const [types, setTypes] = useState<string[]>([]);
  // Step 2
  const [hardRules, setHardRules] = useState<string[]>([]);
  const [escalation, setEscalation] = useState<EscalationBehavior>('hold');
  const [keywords, setKeywords] = useState('');
  // Step 3
  const [platformDrafts, setPlatformDrafts] = useState<PlatformDraft[]>([]);
  const [brandTypesFromServer, setBrandTypesFromServer] = useState<string[]>([]);
  // Step 4
  const [tone, setTone] = useState<EngagementTone | undefined>(undefined);
  const [emoji, setEmoji] = useState<EmojiLevel>('none');
  // Step 5
  const [qualification, setQualification] = useState<string[]>([]);
  const [handoff, setHandoff] = useState({ hot: 'crm_notify', warm: 'save_notify', cold: 'nurture_only' });
  const [usingDefaultHandoff, setUsingDefaultHandoff] = useState(true);
  const [destination, setDestination] = useState('');

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      /**
       * Both reads in parallel, and the platform read is allowed to fail without
       * taking the panel down: it is a matrix of overrides, and a brand with none
       * is the common case. Blocking the whole flow on it would make step 3's
       * absence break steps 1, 2, 4 and 5.
       */
      const [gov, plats] = await Promise.all([
        invoke<Governance>('brand.governance.get', {}),
        invoke<PlatformsRead>('brand.engagement.platforms.get', {}),
      ]);
      setLoading(false);

      if (gov.status === 'succeeded') {
        const g = gov.output;
        setAutonomy(g.engagementAutonomy);
        setTypes(g.engagementTypes);
        setHardRules(g.hardRules ?? []);
        setEscalation(g.escalationBehavior ?? 'hold');
        setKeywords(g.salesEscalationKeywords.join(', '));
        setTone(g.engagementTone);
        setEmoji(g.emojiLevel ?? 'none');
        setQualification(g.salesQualification);
        setHandoff(g.salesHandoff);
        setUsingDefaultHandoff(g.usingDefaultHandoff);
        setDestination(g.salesDestination ?? '');
        setConfiguredAt(g.engagementConfiguredAt);
      }

      if (plats.status === 'succeeded') {
        setBrandTypesFromServer(plats.output.brandEngagementTypes);
        setPlatformDrafts(
          plats.output.platforms.map((p) => ({
            platform: p.platform,
            /**
             * `autonomyInherited` rather than the row-level `inherited`, and
             * `!enabled` first: a muted platform is a choice, and reading it as
             * "following my default" would draw the row as inheriting while the
             * reply path silently answered nothing there.
             */
            choice: !p.enabled ? 'off' : p.autonomyInherited ? 'inherit' : p.autonomy,
            types: p.typesInherited ? null : p.engagementTypes,
          })),
        );
      }
    })();
  }, []);

  function patchPlatform(platform: string, patch: Partial<PlatformDraft>) {
    setPlatformDrafts((prev) => {
      const existing = prev.find((d) => d.platform === platform);
      const base: PlatformDraft = existing ?? { platform, choice: 'inherit', types: null };
      const next = { ...base, ...patch };
      return existing ? prev.map((d) => (d.platform === platform ? next : d)) : [...prev, next];
    });
  }

  /** Only this step's fields. `brand.governance.set` leaves the rest alone. */
  function fieldsFor(s: Step): Record<string, unknown> {
    switch (s) {
      case 'autonomy':
        return {
          engagementAutonomy: autonomy,
          // Empty means every type, which is a different fact from "none" — so
          // it clears rather than storing an empty list.
          engagementTypes: types.length ? types : null,
        };
      case 'boundaries':
        return {
          hardRules: hardRules.length ? hardRules : null,
          escalationBehavior: escalation,
          salesEscalationKeywords: splitList(keywords).length ? splitList(keywords) : null,
        };
      case 'platforms':
        // Written through the platform tools instead — see `savePlatforms`.
        return {};
      case 'voice':
        // `null` is the recommended state: it clears back to the brand voice.
        return { engagementTone: tone ?? null, emojiLevel: emoji };
      case 'sales':
        return {
          salesQualification: qualification.length ? qualification : null,
          // Only send a handoff map the brand has actually chosen. Sending the
          // resolved default back would convert "no preference" into a choice,
          // and the default could then never move.
          salesHandoff: usingDefaultHandoff ? null : handoff,
          salesDestination: destination.trim() ? destination.trim() : null,
        };
    }
  }

  async function savePlatforms(): Promise<string | null> {
    /**
     * One call per row, sequentially. Five requests at once against a table with
     * a unique index on `(brand, platform)` is fine, but the failure reporting is
     * not: the owner needs to know *which* platform did not save, and a
     * `Promise.all` that rejects tells them only that something did.
     */
    for (const p of PLATFORMS) {
      const draft = platformDrafts.find((d) => d.platform === p.value);
      if (!draft) continue;
      const res =
        draft.choice === 'inherit'
          ? await invoke('brand.engagement.platforms.set', { platform: p.value, clear: true })
          : await invoke('brand.engagement.platforms.set', {
              platform: p.value,
              // "Don't engage here" is stored as `enabled: false`; the other two
              // set an autonomy and re-enable the row.
              ...(draft.choice === 'off'
                ? { enabled: false }
                : { enabled: true, autonomy: draft.choice }),
              engagementTypes: draft.types,
            });
      if (res.status !== 'succeeded') {
        return res.status === 'failed' ? `${p.label}: ${res.error.message}` : `${p.label} needs approval.`;
      }
    }
    return null;
  }

  async function advance(from: Step) {
    setBusy(true);
    setMessage(null);

    const index = STEPS.indexOf(from);
    const last = index === STEPS.length - 1;

    if (from === 'platforms') {
      const err = await savePlatforms();
      setBusy(false);
      if (err) {
        setMessage({ kind: 'err', text: err });
        return;
      }
      setStep(STEPS[index + 1] ?? null);
      return;
    }

    const res = await invoke<Governance>('brand.governance.set', {
      ...fieldsFor(from),
      // Stamped only by the final step, and only after its own fields are in the
      // same request — so "Configured" can never be true for a save that failed.
      ...(last ? { engagementConfigured: true } : {}),
    });

    setBusy(false);
    if (res.status !== 'succeeded') {
      setMessage({
        kind: 'err',
        text: res.status === 'failed' ? res.error.message : 'That change needs approval.',
      });
      return;
    }

    if (from === 'sales') {
      // Resolved server-side, so an incomplete map the client sent comes back as
      // the defaults rather than leaving the screen claiming a rule nothing obeys.
      setUsingDefaultHandoff(res.output.usingDefaultHandoff);
      setHandoff(res.output.salesHandoff);
    }
    if (last) {
      setConfiguredAt(res.output.engagementConfiguredAt);
      setStep(null);
      setMessage({ kind: 'ok', text: 'Engagement Intelligence is configured.' });
      return;
    }
    setStep(STEPS[index + 1] ?? null);
  }

  if (loading) {
    return (
      <section aria-busy className="rounded-xl border border-border bg-surface p-6">
        <h2 className="text-[18px] font-semibold text-ink">Engagement Intelligence</h2>
        <PanelSkeleton rows={3} />
      </section>
    );
  }

  // ── Start / Done ──────────────────────────────────────────────────────────
  if (step === null) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold text-ink">Engagement Intelligence</h2>
            <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
              Decide how your agent listens, responds, and escalates conversations.
            </p>
          </div>
          {configuredAt ? (
            <span className="rounded-full border border-ok/40 bg-ok/10 px-3 py-1 text-[12px] text-ink">
              Configured
            </span>
          ) : null}
        </div>

        <p className="mt-4 max-w-2xl text-[13px] text-ink-muted">
          Your agent can do more than post content. It can monitor comments and DMs, draft replies, or
          respond automatically, all within the boundaries you set.
        </p>

        {configuredAt ? (
          <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Summary label="Replies" value={ENGAGEMENT_LEVELS.find((l) => l.value === autonomy)?.label ?? autonomy} />
            <Summary
              label="Hard rules"
              value={hardRules.length ? `${hardRules.length} of 5` : 'None set'}
            />
            <Summary
              label="Platforms"
              value={
                platformDrafts.filter((d) => d.choice !== 'inherit').length
                  ? `${platformDrafts.filter((d) => d.choice !== 'inherit').length} overridden`
                  : 'All follow your default'
              }
            />
          </dl>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <Button size="sm" onClick={() => setStep(STEPS[0])}>
            {configuredAt ? 'Edit configuration' : 'Configure Engagement Intelligence'}
          </Button>
          {message && (
            <span className={cn('text-[13px]', message.kind === 'ok' ? 'text-ink-muted' : 'text-destructive')}>
              {message.text}
            </span>
          )}
        </div>
      </section>
    );
  }

  // ── The five steps ────────────────────────────────────────────────────────
  const index = STEPS.indexOf(step);
  const last = index === STEPS.length - 1;

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div
        className="flex items-center gap-2"
        role="progressbar"
        aria-valuenow={index + 1}
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuetext={`Step ${index + 1} of ${STEPS.length}`}
      >
        {STEPS.map((s, i) => (
          <span key={s} className="h-[5px] flex-1 overflow-hidden rounded-full bg-border">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: i <= index ? '100%' : '0%' }}
            />
          </span>
        ))}
      </div>
      <p className="mt-2.5 text-[12px] text-ink-muted">
        Step {index + 1} of {STEPS.length}
      </p>

      <h2 className="mt-3 text-[18px] font-semibold text-ink">{STEP_TITLES[step]}</h2>

      <div className="mt-5">
        {step === 'autonomy' && (
          <AutonomyStep autonomy={autonomy} onAutonomy={setAutonomy} types={types} onTypes={setTypes} />
        )}
        {step === 'boundaries' && (
          <BoundariesStep
            hardRules={hardRules}
            onHardRules={setHardRules}
            escalation={escalation}
            onEscalation={setEscalation}
            keywords={keywords}
            onKeywords={setKeywords}
          />
        )}
        {step === 'platforms' && (
          <PlatformsStep
            drafts={platformDrafts}
            brandAutonomy={autonomy}
            /**
             * Step 1's live value, falling back to what the server reported. The
             * two agree except in the one moment that matters: somebody who just
             * changed their default on step 1 must see step 3 label the inherited
             * rows with the new answer, not the saved one.
             */
            brandTypes={types.length ? types : brandTypesFromServer}
            onChange={patchPlatform}
          />
        )}
        {step === 'voice' && <VoiceStep tone={tone} onTone={setTone} emoji={emoji} onEmoji={setEmoji} />}
        {step === 'sales' && (
          <SalesStep
            qualification={qualification}
            onQualification={setQualification}
            handoff={handoff}
            onHandoff={setHandoff}
            usingDefaultHandoff={usingDefaultHandoff}
            onUsingDefaultHandoff={setUsingDefaultHandoff}
            destination={destination}
            onDestination={setDestination}
          />
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button size="sm" disabled={busy} onClick={() => void advance(step)}>
          {busy ? 'Saving…' : last ? 'Finish' : 'Continue'}
        </Button>
        {/*
          Back revisits an answer; it does not undo the save the previous Continue
          already made. That is the honest reading — each step is committed — and
          it is why this is the flow's own control rather than browser history,
          which would imply the other thing.
        */}
        <button
          type="button"
          disabled={busy}
          onClick={() => setStep(index === 0 ? null : STEPS[index - 1]!)}
          className="text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
        >
          Back
        </button>
        {message && (
          <span className={cn('text-[13px]', message.kind === 'ok' ? 'text-ink-muted' : 'text-destructive')}>
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1 text-[13px] text-ink">{value}</dd>
    </div>
  );
}
