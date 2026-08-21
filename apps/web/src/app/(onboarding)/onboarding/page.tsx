'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StepShell } from '@/components/onboarding/StepShell';
import { ChipReview, type Chip } from '@/components/onboarding/ChipReview';
import { QuestionStep } from '@/components/onboarding/QuestionStep';
import { ConnectAccountsStep } from '@/components/onboarding/ConnectAccountsStep';
import { PersonalizeStep } from '@/components/onboarding/PersonalizeStep';
import { QUESTIONS, questionsFor, type Question } from '@/components/onboarding/questions';
import { invoke } from '@/lib/tools';

/**
 * ONB-01 → ONB-06 — `Onboarding.dc.html`.
 *
 * Every tool behind this has existed since P2 and nothing called them: a new
 * account reached a shell with no genome, and the only way to make one was
 * curl. This is that path.
 *
 * ── Two tool calls, and nothing invented around them ───────────────────────
 *
 * Invariant 1 says every capability is a tool, and the corollary for a UI is
 * that a screen may not collect something no tool accepts.
 *
 * That rule used to exclude the prototype's connect, brand-kit and
 * agent-avatar steps outright — *"no tool behind them yet"*, true when written.
 * The tools exist now, so `ONB-04` (connect accounts) and `ONB-05`
 * (personalisation) are drawn, and the rule bites in a narrower place instead:
 * `ONB-05` has no alias field, because nothing in the registry accepts one, and
 * a text box that quietly discards what you typed is worse than its absence.
 * Both steps are skippable, since neither is required to finish setup and one
 * of them depends on platform approvals nobody here controls.
 *
 * The brand name is the exception worth naming: it is collected because it is
 * the one thing a person expects to be asked first, and it is used *locally* to
 * name the workspace on the completion screen. It is not persisted, because
 * `brands.name` is set by Clerk's organisation and there is no tool to change
 * it.
 *
 * ── Why the URL step is the slow one ───────────────────────────────────────
 *
 * `genome.bootstrap_from_url` crawls up to five pages with a real browser and
 * runs an inference pass — measured at ~29 seconds. That is far past the point
 * where a spinner reads as broken, so the step says what it is doing and why it
 * is worth the wait, and the wait is the only place in onboarding that has one.
 */

/** Brand name · URL · chips · then one screen per unresolved dimension. */
const FIXED_STEPS = 3;

/**
 * `ONB-04` and `ONB-05`, after the questions rather than before them.
 *
 * The five questions are what the whole engine routes on, and they are the only
 * part of setup that cannot be done later. Putting two optional, externally
 * blocked steps in front of them would be putting the skippable work first and
 * risking the essential work to a drop-off.
 */
const TRAILING_STEPS = 2;

/** The `identity.*` fields `genome.identity.set` accepts flat, matching `GenomeIdentity`'s scalar keys. */
const IDENTITY_SCALAR_FIELDS = new Set(['business_name', 'category', 'sub_category', 'one_liner', 'price_tier']);

interface Draft {
  genomeId: string;
  chips: Chip[];
  unresolved: string[];
  businessName: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { orgId } = useAuth();

  const [step, setStep] = useState(0);
  const [brandName, setBrandName] = useState('');
  const [url, setUrl] = useState('');
  const [draft, setDraft] = useState<Draft | undefined>();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  // Separate from `busy`: that flag is the ~29s crawl, and step 1's render
  // used to show *its* copy ("Opening your pages, reading them…") for this
  // path too, since both actions shared one boolean. `genome.create` has no
  // crawl to be reading — the fast, no-website path was rendering "reading
  // your site" text describing something that was not happening.
  const [manualBusy, setManualBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Set once the crawl has failed, so the manual path is offered rather than
  // pre-empting the faster one before it has been tried.
  const [crawlFailed, setCrawlFailed] = useState(false);
  /** Lifted out of `ConnectAccountsStep` so the footer can say Continue rather than Skip. */
  const [connectedCount, setConnectedCount] = useState(0);

  // Which dimensions still need asking depends on what the crawl resolved, so
  // the flow's length is not known until step 1 has run.
  const questions = useMemo<Question[]>(
    () => (draft ? questionsFor(draft.unresolved) : QUESTIONS),
    [draft],
  );
  const total = FIXED_STEPS + questions.length + TRAILING_STEPS;

  async function bootstrap() {
    /**
     * Guard rather than `orgId ?? ''`.
     *
     * `brandId` is `z.string()`, so an empty string validates cleanly and
     * creates a genome keyed to no brand — a row that looks correct and is
     * unreachable by every later query. `OrgGuard` should make this
     * unreachable; if it ever is not, refusing beats writing a wrong value.
     */
    if (!orgId) {
      setError('Your workspace is still opening. Give it a moment and try again.');
      return;
    }

    setBusy(true);
    setError(undefined);

    const result = await invoke<{
      draftGenomeId: string;
      identity: { businessName: string };
      chips: Chip[];
      unresolved: string[];
    }>('genome.bootstrap_from_url', {
      url: url.trim(),
      brandId: orgId,
      // Five pages is the crawler's own budget. Asking for more here would
      // stretch a wait that is already the longest in the product.
      maxPages: 5,
    });

    setBusy(false);

    if (result.status !== 'succeeded') {
      setError(
        result.status === 'gated'
          ? 'That needs approval before it can run.'
          : // The API's message names the actual cause — blocked, not found,
            // unreachable — and each has a different next step, so it is shown
            // rather than replaced with a generic failure.
            result.error.message,
      );
      setCrawlFailed(true);
      return;
    }

    setDraft({
      genomeId: result.output.draftGenomeId,
      chips: result.output.chips ?? [],
      unresolved: result.output.unresolved ?? [],
      businessName: result.output.identity?.businessName ?? brandName,
    });
    setStep(2);
  }

  /**
   * Start without a crawl.
   *
   * The same shape as `bootstrap`, minus the wait: `genome.create` makes a thin
   * draft from the brand name and leaves all four dimensions unresolved, so the
   * questions that follow cover everything. It is the path for a site behind a
   * firewall and for a business that has no site at all — which, for the SMB
   * motion this product targets, is not the edge case it sounds like.
   */
  async function createManually() {
    if (!orgId) {
      setError('Your workspace is still opening. Give it a moment and try again.');
      return;
    }

    setManualBusy(true);
    setError(undefined);

    const result = await invoke<{
      draftGenomeId: string;
      identity: { businessName: string };
      unresolved: string[];
    }>('genome.create', {
      brandId: orgId,
      businessName: brandName.trim(),
      // Asked properly on a later pass; the brand name is what the owner has
      // already given us and the category is display-only either way.
      category: 'business',
      locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
    });

    setManualBusy(false);

    if (result.status !== 'succeeded') {
      setError(result.status === 'failed' ? result.error.message : 'That needs approval before it can run.');
      return;
    }

    setDraft({
      genomeId: result.output.draftGenomeId,
      chips: [],
      unresolved: result.output.unresolved ?? [],
      businessName: result.output.identity?.businessName ?? brandName,
    });
    // Straight past chip review: there are no inferences to correct.
    setStep(FIXED_STEPS);
  }

  async function finish() {
    if (!draft) return;
    setBusy(true);
    setError(undefined);

    const result = await invoke('genome.dimensions.set', {
      genomeId: draft.genomeId,
      proof_asset: answers.proof_asset ?? [],
      capture_capability: answers.capture_capability ?? [],
      objective: answers.objective?.[0],
      secondary_objectives: [],
      talent_availability: answers.talent_availability?.[0],
    });

    setBusy(false);

    if (result.status !== 'succeeded') {
      setError(result.status === 'failed' ? result.error.message : 'That needs approval before it can run.');
      return;
    }

    /**
     * The cookie the tool proxy forwards as `x-genome-id`. Set here rather than
     * at the end of the flow because the two steps that follow *are* tool
     * calls — `integration.health` and `genome.consent.grant` are both
     * genome-scoped, and without this they would be scoped to nothing.
     */
    document.cookie = `spark_genome=${encodeURIComponent(draft.genomeId)}; path=/; samesite=lax`;
    setStep(FIXED_STEPS + questions.length);
  }

  /** `ONB-06`'s completion, minus the prototype's hold-to-confirm gesture. */
  function done() {
    router.push('/');
  }

  /**
   * ONB-02's missing save. `ChipReview` only ever touched local state — until
   * `genome.identity.set` existed, "Looks right" (and any correction made
   * before clicking it) had nowhere to go, so a wrong inferred business name
   * (or category, or anything else the crawl misread) stayed wrong forever.
   *
   * Only flat, recognised `identity.<field>` chips are sent — a chip pointing
   * at a nested path like `identity.geography.locale` is skipped rather than
   * guessed at, since `genome.identity.set` merges one JSON key at a time and
   * a dotted key would not merge into the right place.
   */
  async function confirmChips() {
    if (!draft) return;
    const patch: Record<string, string> = {};
    for (const chip of draft.chips) {
      const field = chip.field.startsWith('identity.') ? chip.field.slice('identity.'.length) : null;
      if (field && !field.includes('.') && IDENTITY_SCALAR_FIELDS.has(field)) {
        patch[field] = chip.value;
      }
    }

    if (Object.keys(patch).length > 0) {
      setBusy(true);
      setError(undefined);
      const result = await invoke('genome.identity.set', { genomeId: draft.genomeId, identity: patch });
      setBusy(false);
      if (result.status !== 'succeeded') {
        setError(result.status === 'failed' ? result.error.message : 'That correction needs approval before it can run.');
        return;
      }
      // The completion screen and every later step's eyebrow read this from
      // local state, not from a fresh fetch — keep it in sync with what was
      // just saved so a corrected name actually shows corrected.
      if (patch['business_name']) setDraft({ ...draft, businessName: patch['business_name'] });
    }

    setStep(3);
  }

  const back = step > 0 ? () => { setError(undefined); setStep(step - 1); } : undefined;

  /* ── 0 · Brand name ─────────────────────────────────────────────── */
  if (step === 0) {
    return (
      <StepShell
        step={0}
        total={total}
        eyebrow="Let’s set up your brand identity"
        title="What is your brand called?"
        footer={
          <Button
            className="w-full md:w-auto"
            disabled={brandName.trim().length === 0}
            onClick={() => setStep(1)}
          >
            Continue
          </Button>
        }
      >
        <Input
          autoFocus
          value={brandName}
          onChange={(e) => setBrandName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && brandName.trim() && setStep(1)}
          placeholder="Enter your brand name"
          aria-label="Brand name"
        />
      </StepShell>
    );
  }

  /* ── 1 · The URL. The expensive step. ───────────────────────────── */
  if (step === 1) {
    return (
      <StepShell
        step={1}
        total={total}
        onBack={back}
        eyebrow="Now for your brand knowledge"
        title="What’s your website?"
        subtitle="SPARK reads a few pages to work out what you do, so you answer fewer questions."
        footer={
          <div className="flex flex-col gap-3">
            {error ? <p className="text-[14px] text-[var(--ss-danger)]">{error}</p> : null}
            <Button
              className="w-full md:w-auto"
              disabled={!looksLikeUrl(url) || busy || manualBusy}
              onClick={bootstrap}
            >
              {busy ? 'Reading your site…' : 'Continue'}
            </Button>
            {busy ? (
              // Named, because thirty seconds of silence reads as a hang. The
              // steps are the real ones the tool performs.
              <p className="text-[14px] text-ink-muted">
                Opening your pages, reading them, and drafting your profile. This takes about half a
                minute and only happens once.
              </p>
            ) : null}

            {/*
              Always available, but worded differently once the crawl has
              failed. Before: a quiet opt-out for someone with no site. After:
              the obvious next action, because the alternative is retrying
              something that just told us it will not work.
            */}
            {!busy && !manualBusy ? (
              <button
                type="button"
                onClick={() => void createManually()}
                disabled={brandName.trim().length === 0}
                className="self-start text-[14px] text-ink-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
              >
                {crawlFailed ? 'Set up by answering questions instead' : 'I don’t have a website'}
              </button>
            ) : null}
            {manualBusy ? <p className="text-[14px] text-ink-muted">Setting up your workspace…</p> : null}
          </div>
        }
      >
        <Input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && looksLikeUrl(url) && !busy && void bootstrap()}
          placeholder="Enter your website URL"
          aria-label="Website URL"
          inputMode="url"
          disabled={busy || manualBusy}
        />
      </StepShell>
    );
  }

  /* ── 2 · Chip playback (ONB-02) ─────────────────────────────────── */
  if (step === 2 && draft) {
    return (
      <StepShell
        step={2}
        total={total}
        onBack={back}
        eyebrow={`Read from ${hostOf(url)}`}
        title="Here’s what SPARK understood"
        subtitle="Tap anything that’s wrong. Getting this right now saves a month of off-brand posts."
        footer={
          <div className="flex flex-col gap-3">
            {error ? <p className="text-[14px] text-[var(--ss-danger)]">{error}</p> : null}
            <Button className="w-full md:w-auto" disabled={busy} onClick={() => void confirmChips()}>
              {busy ? 'Saving…' : 'Looks right'}
            </Button>
          </div>
        }
      >
        <ChipReview chips={draft.chips} onChange={(chips) => setDraft({ ...draft, chips })} />
      </StepShell>
    );
  }

  /* ── 3+ · One question per unresolved dimension (ONB-03) ────────── */
  const index = step - FIXED_STEPS;
  const question = questions[index];

  if (question) {
    const selected = answers[question.id] ?? [];
    const last = index === questions.length - 1;

    return (
      <StepShell
        step={step}
        total={total}
        onBack={back}
        eyebrow={draft ? `${draft.businessName}` : undefined}
        title={question.prompt}
        subtitle={question.help}
        footer={
          <div className="flex flex-col gap-3">
            {error ? <p className="text-[14px] text-[var(--ss-danger)]">{error}</p> : null}
            <Button
              className="w-full md:w-auto"
              disabled={selected.length === 0 || busy}
              onClick={() => (last ? void finish() : setStep(step + 1))}
            >
              {busy ? 'Saving…' : last ? 'Save answers' : 'Continue'}
            </Button>
          </div>
        }
      >
        <QuestionStep
          question={question}
          selected={selected}
          onChange={(values) => setAnswers({ ...answers, [question.id]: values })}
        />
      </StepShell>
    );
  }

  /* ── ONB-04 · Connect the accounts (skippable) ──────────────────── */
  if (draft && step === FIXED_STEPS + questions.length) {
    return (
      <StepShell
        step={step}
        total={total}
        onBack={back}
        eyebrow={draft.businessName}
        title="Where should SPARK post?"
        footer={
          <div className="flex flex-col gap-3">
            {error ? <p className="text-[14px] text-[var(--ss-danger)]">{error}</p> : null}
            <Button className="w-full md:w-auto" onClick={() => setStep(step + 1)}>
              {connectedCount > 0 ? 'Continue' : 'Skip for now'}
            </Button>
          </div>
        }
      >
        <ConnectAccountsStep genomeId={draft.genomeId} onConnectedCountChange={setConnectedCount} />
      </StepShell>
    );
  }

  /* ── ONB-05 · Personalise (skippable) ──────────────────────────────── */
  if (draft && step === FIXED_STEPS + questions.length + 1) {
    return (
      <StepShell
        step={step}
        total={total}
        onBack={back}
        eyebrow={draft.businessName}
        title="Does SPARK have a face to use?"
        footer={
          <Button className="w-full md:w-auto" onClick={done}>
            Finish setup
          </Button>
        }
      >
        <PersonalizeStep genomeId={draft.genomeId} />
      </StepShell>
    );
  }

  /* Reachable only if `draft` is missing at step 2 — a refresh mid-flow. */
  return (
    <StepShell
      step={step}
      total={total}
      title="Let’s start again"
      subtitle="That took longer than expected and the answers were lost. Nothing was saved."
      footer={<Button onClick={() => setStep(0)}>Start over</Button>}
    >
      <span />
    </StepShell>
  );
}

/**
 * Enough to catch a typo, not enough to reject a valid address.
 *
 * The real check is `PublicHttpUrl` in the tool's schema, which rejects
 * `file://`, loopback and link-local. Duplicating that here would put a
 * security rule in two places and let them drift; this only stops someone
 * spending thirty seconds discovering they typed "emkacuts".
 */
function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim();
  return /^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(trimmed) || /^[^\s.]+\.[^\s]{2,}$/i.test(trimmed);
}

function hostOf(value: string): string {
  try {
    return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.replace(/^www\./, '');
  } catch {
    return 'your site';
  }
}
