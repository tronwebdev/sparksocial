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
import { GroundingStep } from '@/components/onboarding/GroundingStep';
import { BrandDetailsStep } from '@/components/onboarding/BrandDetailsStep';
import { BrandKitStep } from '@/components/onboarding/BrandKitStep';
import { CompanyDocsStep } from '@/components/onboarding/CompanyDocsStep';
import { AgentStep } from '@/components/onboarding/AgentStep';
import { CompletionScreen } from '@/components/onboarding/CompletionScreen';
import { QUESTIONS, questionsFor, type Question } from '@/components/onboarding/questions';
import { humanError, invoke } from '@/lib/tools';

/**
 * ONB-01 → ONB-06 — `Onboarding.dc.html`.
 *
 * Every tool behind this has existed since P2 and nothing called them: a new
 * account reached a shell with no genome, and the only way to make one was
 * curl. This is that path.
 *
 * ── The four groups (`F6`) ─────────────────────────────────────────────────
 *
 * The prototype counts four steps; this counted every screen, so a brand whose
 * crawl resolved nothing was told "Step 7 of 10" where the design says "Step 2 of
 * 4". That number is most of what F6 measured as "the build feels twice as long
 * as the design" — and it was not even a *stable* number, because the flow's
 * length depends on how much the crawl managed to infer.
 *
 *   1 · Brand identity   name → the URL crawl → its playback → the details and
 *                        logo the crawl did not fill
 *   2 · Brand knowledge  the questions the crawl could not answer, then
 *                        documents and what you already have
 *   3 · Brand kit        colours, type, voice, timezone, guardrails
 *   4 · Your agent       its name and face, and where it posts
 *
 * Two orderings in there are deliberate and were not the prototype's.
 *
 * The **details screen comes after the crawl**, where the prototype asks before
 * it. The crawl writes `one_liner` and guesses `category`, so asking first means
 * asking somebody to type a sentence SPARK was about to write for them — and then
 * showing them the chip review that contradicts it.
 *
 * The **questions come before the optional steps**. They are what the whole
 * engine routes on and the only part of setup that cannot be done later; putting
 * documents or account-connecting in front of them would put skippable,
 * externally-blocked work first and risk the essential work to a drop-off.
 *
 * ── Two tool calls, and nothing invented around them ───────────────────────
 *
 * Invariant 1 says every capability is a tool, and the corollary for a UI is
 * that a screen may not collect something no tool accepts. That rule used to
 * exclude the prototype's brand-kit, document and agent-naming steps outright —
 * *"no tool behind them yet"*, true when written. `brand.governance.set` covers
 * the kit and the agent's name, and `brand.knowledge.attach_document` was built
 * for the PDF step, so all three are drawn now. Where the rule still bites: the
 * prototype's "Use This Brand Preset" toggle over a kit *generated from your URL*
 * is absent, because nothing generates one — see `BrandKitStep`.
 *
 * The brand name is the exception worth naming: it is collected because it is
 * the one thing a person expects to be asked first, and it is used *locally* to
 * name the brand on the completion screen. It is not persisted, because
 * `brands.name` is set by Clerk's organisation and there is no tool to change it.
 *
 * ── Why the URL step is the slow one ───────────────────────────────────────
 *
 * `genome.bootstrap_from_url` crawls up to five pages with a real browser and
 * runs an inference pass — measured at ~29 seconds. That is far past the point
 * where a spinner reads as broken, so the step says what it is doing and why it
 * is worth the wait, and the wait is the only place in onboarding that has one.
 */

/** Named rather than counted: the arithmetic version broke every time a screen moved. */
const NAME = 0;
const URL_STEP = 1;
const CHIPS = 2;
const DETAILS = 3;
/** The questions occupy `QUESTIONS_AT … QUESTIONS_AT + questions.length - 1`. */
const QUESTIONS_AT = 4;

/** The `identity.*` fields `genome.identity.set` accepts flat, matching `GenomeIdentity`'s scalar keys. */
const IDENTITY_SCALAR_FIELDS = new Set(['business_name', 'category', 'sub_category', 'one_liner', 'price_tier']);

interface Draft {
  genomeId: string;
  chips: Chip[];
  unresolved: string[];
  businessName: string;
  /** What the crawl guessed, so the details screen opens on the guess. */
  category?: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { orgId } = useAuth();

  const [step, setStep] = useState(NAME);
  const [brandName, setBrandName] = useState('');
  const [url, setUrl] = useState('');
  const [draft, setDraft] = useState<Draft | undefined>();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  // Separate from `busy`: that flag is the ~29s crawl, and the URL step's render
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
  // the flow's length is not known until the URL step has run.
  const questions = useMemo<Question[]>(
    () => (draft ? questionsFor(draft.unresolved) : QUESTIONS),
    [draft],
  );

  /** Everything after the questions, whose position depends on how many there are. */
  const DOCS = QUESTIONS_AT + questions.length;
  const GROUNDING = DOCS + 1;
  const KIT = GROUNDING + 1;
  const AGENT = KIT + 1;
  const ACCOUNTS = AGENT + 1;
  const DONE = ACCOUNTS + 1;

  /**
   * The cookie the tool proxy forwards as `x-genome-id`.
   *
   * Set as soon as a draft exists rather than after the questions, because every
   * screen from the chip review onward calls a genome-scoped tool — the logo
   * upload, the document attach, `asset.gaps` — and without it those are scoped
   * to nothing.
   */
  function selectGenome(genomeId: string) {
    document.cookie = `spark_genome=${encodeURIComponent(genomeId)}; path=/; samesite=lax`;
  }

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
      setError('Your brand is still opening. Give it a moment and try again.');
      return;
    }

    setBusy(true);
    setError(undefined);

    const result = await invoke<{
      draftGenomeId: string;
      identity: { businessName: string; category?: string };
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
      // The API's message names the actual cause — blocked, not found,
      // unreachable — and each has a different next step, so it is shown rather
      // than replaced with a generic failure.
      setError(humanError(result));
      setCrawlFailed(true);
      return;
    }

    selectGenome(result.output.draftGenomeId);
    setDraft({
      genomeId: result.output.draftGenomeId,
      chips: result.output.chips ?? [],
      unresolved: result.output.unresolved ?? [],
      businessName: result.output.identity?.businessName ?? brandName,
      ...(result.output.identity?.category ? { category: result.output.identity.category } : {}),
    });
    setStep(CHIPS);
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
      setError('Your brand is still opening. Give it a moment and try again.');
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
      // The details screen asks for the real one two screens later; the category
      // is display-only either way and nothing in the engine branches on it.
      category: 'business',
      locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
    });

    setManualBusy(false);

    if (result.status !== 'succeeded') {
      setError(humanError(result, 'That needs approval before it can run.'));
      return;
    }

    selectGenome(result.output.draftGenomeId);
    setDraft({
      genomeId: result.output.draftGenomeId,
      chips: [],
      unresolved: result.output.unresolved ?? [],
      businessName: result.output.identity?.businessName ?? brandName,
    });
    // Straight past chip review: there are no inferences to correct.
    setStep(DETAILS);
  }

  async function saveAnswers() {
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
      setError(humanError(result, 'That needs approval before it can run.'));
      return;
    }

    setStep(DOCS);
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
        setError(humanError(result, 'That correction needs approval before it can run.'));
        return;
      }
      // The completion screen and every later step's eyebrow read this from
      // local state, not from a fresh fetch — keep it in sync with what was
      // just saved so a corrected name actually shows corrected.
      setDraft({
        ...draft,
        ...(patch['business_name'] ? { businessName: patch['business_name'] } : {}),
        ...(patch['category'] ? { category: patch['category'] } : {}),
      });
    }

    setStep(DETAILS);
  }

  const back = step > NAME ? () => { setError(undefined); setStep(step - 1); } : undefined;
  const eyebrow = draft?.businessName;

  /* ── 1 · Brand identity ─────────────────────────────────────────────── */

  if (step === NAME) {
    return (
      <StepShell
        group={1}
        within={{ index: 0, total: 4 }}
        eyebrow="Let’s set up your brand identity"
        title="What is your brand called?"
        footer={
          <Button
            className="w-full md:w-auto"
            disabled={brandName.trim().length === 0}
            onClick={() => setStep(URL_STEP)}
          >
            Continue
          </Button>
        }
      >
        <Input
          autoFocus
          value={brandName}
          onChange={(e) => setBrandName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && brandName.trim() && setStep(URL_STEP)}
          placeholder="Enter your brand name"
          aria-label="Brand name"
        />
      </StepShell>
    );
  }

  if (step === URL_STEP) {
    return (
      <StepShell
        group={1}
        within={{ index: 1, total: 4 }}
        onBack={back}
        eyebrow={`Got your brand name, ${brandName.trim()}`}
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
            {manualBusy ? <p className="text-[14px] text-ink-muted">Setting up your brand…</p> : null}
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

  if (step === CHIPS && draft) {
    return (
      <StepShell
        group={1}
        within={{ index: 2, total: 4 }}
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

  if (step === DETAILS && draft) {
    return (
      <StepShell
        group={1}
        within={{ index: 3, total: 4 }}
        onBack={back}
        eyebrow={eyebrow}
        title="A bit more about the brand"
        subtitle="All optional — but the sentence below is what every caption gets written from, so it is the one worth typing."
        footer={
          <Button className="w-full md:w-auto" onClick={() => setStep(QUESTIONS_AT)}>
            Continue
          </Button>
        }
      >
        <BrandDetailsStep
          genomeId={draft.genomeId}
          brandName={draft.businessName}
          {...(draft.category ? { initialNiche: draft.category } : {})}
        />
      </StepShell>
    );
  }

  /* ── 2 · Brand knowledge ────────────────────────────────────────────── */

  const questionIndex = step - QUESTIONS_AT;
  const question = questionIndex >= 0 ? questions[questionIndex] : undefined;

  if (question && draft) {
    const selected = answers[question.id] ?? [];
    const last = questionIndex === questions.length - 1;

    return (
      <StepShell
        group={2}
        within={{ index: questionIndex, total: questions.length + 2 }}
        onBack={back}
        eyebrow={eyebrow}
        title={question.prompt}
        subtitle={question.help}
        footer={
          <div className="flex flex-col gap-3">
            {error ? <p className="text-[14px] text-[var(--ss-danger)]">{error}</p> : null}
            <Button
              className="w-full md:w-auto"
              disabled={selected.length === 0 || busy}
              onClick={() => (last ? void saveAnswers() : setStep(step + 1))}
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

  if (draft && step === DOCS) {
    return (
      <StepShell
        group={2}
        within={{ index: questions.length, total: questions.length + 2 }}
        onBack={back}
        eyebrow={eyebrow}
        title="Anything written down?"
        subtitle="SPARK reads these to learn your voice, your offer and the facts it is allowed to state. Optional, and addable later."
        footer={
          <Button className="w-full md:w-auto" onClick={() => setStep(GROUNDING)}>
            Continue
          </Button>
        }
      >
        <CompanyDocsStep genomeId={draft.genomeId} />
      </StepShell>
    );
  }

  if (draft && step === GROUNDING) {
    return (
      <StepShell
        group={2}
        within={{ index: questions.length + 1, total: questions.length + 2 }}
        onBack={back}
        eyebrow={eyebrow}
        title="What has SPARK got to work with?"
        subtitle="All optional, all changeable later — but each one is the difference between a post that could be any business and a post that is yours."
        footer={
          <Button className="w-full md:w-auto" onClick={() => setStep(KIT)}>
            Continue
          </Button>
        }
      >
        <GroundingStep genomeId={draft.genomeId} />
      </StepShell>
    );
  }

  /* ── 3 · Brand kit ──────────────────────────────────────────────────── */

  if (draft && step === KIT) {
    return (
      <StepShell
        group={3}
        onBack={back}
        eyebrow={eyebrow}
        title="How should it look and sound?"
        subtitle="Your colours, type and voice, and the things SPARK must never say. Every field here reaches a real post."
        footer={
          <Button className="w-full md:w-auto" onClick={() => setStep(AGENT)}>
            Continue
          </Button>
        }
      >
        <BrandKitStep />
      </StepShell>
    );
  }

  /* ── 4 · Your agent ─────────────────────────────────────────────────── */

  if (draft && step === AGENT) {
    return (
      <StepShell
        group={4}
        within={{ index: 0, total: 2 }}
        onBack={back}
        eyebrow={eyebrow}
        title="Who is doing the work?"
        footer={
          <Button className="w-full md:w-auto" onClick={() => setStep(ACCOUNTS)}>
            Continue
          </Button>
        }
      >
        <AgentStep genomeId={draft.genomeId} brandName={draft.businessName} />
      </StepShell>
    );
  }

  if (draft && step === ACCOUNTS) {
    return (
      <StepShell
        group={4}
        within={{ index: 1, total: 2 }}
        onBack={back}
        eyebrow={eyebrow}
        title="Where should SPARK post?"
        footer={
          <div className="flex flex-col gap-3">
            {error ? <p className="text-[14px] text-[var(--ss-danger)]">{error}</p> : null}
            <Button className="w-full md:w-auto" onClick={() => setStep(DONE)}>
              {connectedCount > 0 ? 'Finish setup' : 'Skip for now'}
            </Button>
          </div>
        }
      >
        <ConnectAccountsStep genomeId={draft.genomeId} onConnectedCountChange={setConnectedCount} />
      </StepShell>
    );
  }

  /* ── Done (`L5`) ────────────────────────────────────────────────────── */

  if (draft && step === DONE) {
    return (
      <CompletionScreen
        genomeId={draft.genomeId}
        brandName={draft.businessName}
        onDone={() => router.push('/')}
      />
    );
  }

  /* Reachable only if `draft` is missing past the URL step — a refresh mid-flow. */
  return (
    <StepShell
      group={1}
      title="Let’s start again"
      subtitle="That took longer than expected and the answers were lost. Nothing was saved."
      footer={<Button onClick={() => setStep(NAME)}>Start over</Button>}
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
