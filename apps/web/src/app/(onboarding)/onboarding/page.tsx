'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { UNSET_CATEGORY } from '@sparksocial/shared';
import { writeSelectedGenome } from '@/lib/selectedGenome';
import { Button } from '@/components/ui/button';
import { Busy, SparkLoader } from '@/components/brand/SparkLoader';
import { StepShell } from '@/components/onboarding/StepShell';
import { ComposerGlobeIcon, PromptComposer } from '@/components/onboarding/PromptComposer';
import type { Chip } from '@/components/onboarding/ChipReview';
import { BrandDetailsStep } from '@/components/onboarding/BrandDetailsStep';
import { QuestionStep } from '@/components/onboarding/QuestionStep';
import { QUESTIONS, questionsFor, type Question } from '@/components/onboarding/questions';
import { BrandKitStep } from '@/components/onboarding/BrandKitStep';
import { CompanyDocsStep } from '@/components/onboarding/CompanyDocsStep';
import { AgentStep } from '@/components/onboarding/AgentStep';
import { CompletionScreen } from '@/components/onboarding/CompletionScreen';
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

/**
 * Named rather than counted: the arithmetic version broke every time a screen moved.
 *
 * Only the screens *before* the questions can be numbered up front. How many
 * question screens there are depends on what the crawl resolved, so `DOCS`
 * onward are derived from `asks.length` inside the component.
 */
const NAME = 0;
const URL_STEP = 1;
const DETAILS = 2;
/** The first question screen. There are between zero and four of them. */
const Q_FIRST = 3;

/** The four routing dimensions, as `genome.dimensions.set` takes them. */
type Answers = Partial<Record<Question['id'], string[]>>;

/*
 * ── Why these screens did not exist ───────────────────────────────────────
 *
 * `genome.create` (the no-website path) writes `dimensions: {}` and says so in
 * its own `why`: "the next questions cover everything that matters". There were
 * no next questions. `QuestionStep`, `QUESTIONS` and `questionsFor` have been
 * complete in this directory the whole time with nothing importing them, so
 * every genome created through the app carried four empty dimensions — which is
 * why `classifyProfile` returned one profile for every brand, why the pillar
 * mix came out the same whatever the campaign asked for, and why `buildableNow`
 * was zero for brands whose owners had answered every question the app put to
 * them.
 *
 * Which ones get asked is `questionsFor`'s decision, not this file's: the
 * unresolved ones, and all four when the crawl resolved everything, since
 * confirming an inference costs one tap and is the last cheap moment to catch
 * it. That also means the step is never empty, so the complete set
 * `DimensionsSetInput` requires is always collected.
 */
/**
 * Flatten the crawl's dimensions into the one shape the question cards use.
 *
 * `proof_asset` and `capture_capability` are arrays in the genome; `objective`
 * and `talent_availability` are single values. `QuestionStep` is a `string[]`
 * either way — `multiple: false` just means it replaces rather than toggles —
 * so the split is undone here and re-applied when saving.
 */
function normaliseInferred(raw: Record<string, string | string[] | undefined> | undefined): Answers {
  const out: Answers = {};
  for (const q of QUESTIONS) {
    const value = raw?.[q.id];
    if (Array.isArray(value)) {
      if (value.length) out[q.id] = value;
    } else if (value) {
      out[q.id] = [value];
    }
  }
  return out;
}

interface Draft {
  genomeId: string;
  chips: Chip[];
  unresolved: string[];
  businessName: string;
  /** What the crawl guessed, so the details screen opens on the guess. */
  category?: string;
  /**
   * The dimensions the crawl inferred, so the questions open on the inference
   * and only the genuinely unknown ones are asked. Empty on the manual path.
   */
  dimensions?: Answers;
  /**
   * The palette, fonts and logo the crawl read off the site.
   *
   * Carried so the Brand Kit step can tell a kit that came from the URL from
   * one the owner typed in — the two look identical in governance, because
   * the crawl writes into the same fields, and the step's own copy promises
   * "generated from your URL".
   */
  kit?: { colors: string[]; fonts?: { display?: string; body?: string }; logoUrl?: string };
}

/** The brand this run of onboarding created, and the name it was created under. */
interface MadeBrand {
  brandId: string;
  name: string;
}

/**
 * One run of onboarding, as far as it has got.
 *
 * Everything here lived only in component state, so a refresh — or a phone
 * reloading a backgrounded tab — dropped the person on "What is your Brand
 * Name?" with no trace of the brand they had half set up. That brand was
 * still in the account, with its crawl, answers and logo saved, and starting
 * again made a second one beside it.
 *
 * `sessionStorage`, keyed by organisation: it survives a reload, is gone when
 * the tab is, and never carries one account's draft into another's. Nothing
 * in it is a secret — ids and the answers the person just typed.
 */
interface Progress {
  step: number;
  brandName: string;
  url: string;
  draft?: Draft;
  answers: Answers;
  made?: MadeBrand;
}

const progressKey = (orgId: string) => `spark:onboarding:${orgId}`;

function readProgress(orgId: string): Progress | null {
  try {
    const raw = window.sessionStorage.getItem(progressKey(orgId));
    return raw ? (JSON.parse(raw) as Progress) : null;
  } catch {
    return null;
  }
}

function writeProgress(orgId: string, progress: Progress | null) {
  try {
    if (progress) window.sessionStorage.setItem(progressKey(orgId), JSON.stringify(progress));
    else window.sessionStorage.removeItem(progressKey(orgId));
  } catch {
    /* storage unavailable — the run simply does not survive a reload */
  }
}

/**
 * What the person typed, as an address the API accepts.
 *
 * `PublicHttpUrl` is `z.string().url()`, which rejects `bettys.co.uk` — and
 * that, not `https://www.bettys.co.uk`, is how nearly everybody writes their
 * own site. `looksLikeUrl` accepted it, Continue lit up, and the crawl came
 * back with "url: Invalid url".
 */
function normaliseUrl(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { orgId } = useAuth();

  const [step, setStep] = useState(NAME);
  const [brandName, setBrandName] = useState('');
  const [url, setUrl] = useState('');
  const [draft, setDraft] = useState<Draft | undefined>();
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
  /**
   * The four dimensions, lifted here for the same reason the connect step's
   * state was: `StepShell` owns the footer, so the button that saves them and
   * advances cannot live inside the card that collects them.
   */
  const [answers, setAnswers] = useState<Answers>({});
  const [savingDimensions, setSavingDimensions] = useState(false);
  /** See `provisionBrand`: one brand per run, however many attempts it takes. */
  const [made, setMade] = useState<MadeBrand | undefined>();
  /** False until a saved run has been looked for — see `Progress`. */
  const [restored, setRestored] = useState(false);
  /** Lifted out of `ConnectAccountsStep` so the footer can say Continue rather than Skip. */

  // Which dimensions still need asking depends on what the crawl resolved, so
  // the flow's length is not known until the URL step has run.

  /** Everything after the questions, whose position depends on how many there are. */

  /**
   * The cookie the tool proxy forwards as `x-genome-id`.
   *
   * Set as soon as a draft exists rather than after the questions, because every
   * screen from the chip review onward calls a genome-scoped tool — the logo
   * upload, the document attach, `asset.gaps` — and without it those are scoped
   * to nothing.
   */
  /** `BrandKitStep`'s own `save`, so Continue can flush it. See the KIT step below. */
  const kitSave = useRef<null | (() => Promise<boolean>)>(null);

  function selectGenome(genomeId: string) {
    // The org goes in with it. A cookie with no org is dropped by the proxy, and
    // one written under the wrong org is what stopped a second account from
    // onboarding in a browser the first had used — see `lib/selectedGenome.ts`.
    if (orgId) writeSelectedGenome(orgId, genomeId);
  }

  /**
   * A brand of its own for this run of onboarding.
   *
   * Both entry points used to pass `brandId: orgId`, which is not a brand — it
   * is the whole account. One genome belongs to one brand, so the second time
   * anybody onboarded, `genome.create` found the org's existing genome and
   * patched it: the new business's identity and dimensions landed on top of the
   * previous one. Watched it happen — a bakery's genome became a bicycle
   * workshop's, and nothing anywhere said a brand had been overwritten rather
   * than created. The crawl path failed the other way, writing a second genome
   * under the same brand, which is the duplicate `genome.create`'s own comment
   * describes.
   *
   * `brand.create` mints `brand_<uuid>`, provisions the governance row and
   * pairs an empty genome with it. Its id is what every later call here is
   * keyed to, so onboarding creates a brand every time it is run — which is
   * what the screen says it does.
   */
  async function provisionBrand(name: string): Promise<string | undefined> {
    /*
     * Once per run, not once per press.
     *
     * The brand used to be created before every attempt, and the attempt is
     * the part that fails: a mistyped address, a site that blocks the
     * crawler, then "Set up by answering questions instead". Each of those
     * left an empty brand behind in the account — three tries at the URL step
     * was three brands named after the same business, two of them blank. The
     * second attempt reuses the first's brand; `genome.bootstrap_from_url` and
     * `genome.create` both fill the brand's existing genome rather than adding
     * another, so reuse is exactly what they expect.
     *
     * If the name was changed in between (Back, edit, Continue), the brand
     * follows it rather than keeping the first spelling.
     */
    if (made) {
      if (name && name !== made.name) {
        const renamed = await invoke('brand.settings.patch', { brandId: made.brandId, name });
        if (renamed.status === 'succeeded') setMade({ ...made, name });
      }
      return made.brandId;
    }

    const created = await invoke<{ brandId: string; genomeId: string; name: string }>(
      'brand.create',
      {
        name,
        // Onboarding asks for the real category two screens later, and nothing in
        // the engine branches on it — same reasoning `genome.create` gives.
        category: UNSET_CATEGORY,
        locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
      },
      /*
       * Fresh per press, because each one is a new brand.
       *
       * `brand.create` is `idempotent: false`, so `invoke.ts` refuses the call
       * outright when no key is given — the first version of this had none and
       * would have made the button do nothing at all. A stable key would be
       * worse than none: it would collapse every later onboarding onto the first
       * brand, which is the bug this whole change exists to fix.
       */
      crypto.randomUUID(),
    );

    if (created.status !== 'succeeded') {
      setError(humanError(created, 'That needs approval before it can run.'));
      return undefined;
    }
    setMade({ brandId: created.output.brandId, name });
    return created.output.brandId;
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

    const brandId = await provisionBrand(brandName.trim() || url.trim());
    if (!brandId) {
      setBusy(false);
      return;
    }

    const result = await invoke<{
      draftGenomeId: string;
      identity: { businessName: string; category?: string };
      chips: Chip[];
      unresolved: string[];
      /** `GenomeDimensions.partial()` — single-valued for objective and talent. */
      dimensions?: Record<string, string | string[] | undefined>;
      kit?: { colors: string[]; fonts?: { display?: string; body?: string }; logoUrl?: string };
    }>('genome.bootstrap_from_url', {
      url: normaliseUrl(url),
      brandId,
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

    /*
     * The name the person typed is the brand's name.
     *
     * The crawl writes the name the *site* uses into the genome, so a brand
     * entered as "Onboarding QA Bakery" was greeted on the next screen as
     * "Bettys", listed everywhere else under the typed name, and written about
     * in posts under the crawled one. They were asked the question first and
     * answered it; `brand.settings.patch` sets both the brand and its genome to
     * that answer. Non-fatal: the crawl itself succeeded, and a name can be
     * changed in settings.
     */
    const typed = brandName.trim();
    const crawledName = result.output.identity?.businessName;
    if (typed && crawledName && crawledName !== typed) {
      await invoke('brand.settings.patch', { brandId, name: typed });
    }

    selectGenome(result.output.draftGenomeId);
    setDraft({
      genomeId: result.output.draftGenomeId,
      chips: result.output.chips ?? [],
      unresolved: result.output.unresolved ?? [],
      businessName: typed || crawledName || url.trim(),
      ...(result.output.identity?.category ? { category: result.output.identity.category } : {}),
      dimensions: normaliseInferred(result.output.dimensions),
      ...(result.output.kit ? { kit: result.output.kit } : {}),
    });
    setStep(DETAILS);
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

    const brandId = await provisionBrand(brandName.trim());
    if (!brandId) {
      setManualBusy(false);
      return;
    }

    const result = await invoke<{
      draftGenomeId: string;
      identity: { businessName: string };
      unresolved: string[];
    }>('genome.create', {
      brandId,
      businessName: brandName.trim(),
      // The details screen asks for the real one two screens later; the category
      // is display-only either way and nothing in the engine branches on it.
      category: UNSET_CATEGORY,
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

  /* ── Where the screens after the questions sit ─────────────────────── */

  const asks = draft ? questionsFor(draft.unresolved) : [];
  const DOCS = Q_FIRST + asks.length;
  const KIT = DOCS + 1;
  const AGENT = KIT + 1;
  const DONE = AGENT + 1;

  /** Whatever the crawl inferred, overridden by anything the owner answered. */
  const dimensionValues: Answers = { ...draft?.dimensions, ...answers };

  /* ── Surviving a reload — see `Progress` ───────────────────────────────── */

  // Read once, after mount: `sessionStorage` does not exist during the server
  // render, so reading it in a `useState` initialiser would hydrate a
  // different screen from the one the server drew.
  useEffect(() => {
    if (!orgId || restored) return;
    const saved = readProgress(orgId);
    if (saved) {
      setBrandName(saved.brandName);
      setUrl(saved.url);
      setAnswers(saved.answers ?? {});
      setMade(saved.made);
      if (saved.draft) {
        setDraft(saved.draft);
        selectGenome(saved.draft.genomeId);
      }
      // A run saved past the URL step without its draft cannot be resumed
      // there; the name and address are kept, so the URL step is one press.
      setStep(saved.draft || saved.step <= URL_STEP ? saved.step : URL_STEP);
    }
    setRestored(true);
    // `selectGenome` reads `orgId`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, restored]);

  useEffect(() => {
    if (!orgId || !restored) return;
    // Finished, or not begun: nothing worth resuming.
    if (step === DONE || (step === NAME && !brandName && !made)) {
      writeProgress(orgId, null);
      return;
    }
    writeProgress(orgId, { step, brandName, url, answers, ...(draft ? { draft } : {}), ...(made ? { made } : {}) });
  }, [orgId, restored, step, brandName, url, answers, draft, made, DONE]);

  /**
   * Save all four dimensions and advance.
   *
   * Sent as one call rather than one per screen: `genome.dimensions.set` derives
   * `avatarEnabled` from `proof_asset` *and* `talent_availability` together, and
   * resolves the three production modes from the whole set. Saving a partial set
   * would have it deriving an avatar decision from half the answers.
   */
  async function saveDimensions(next: number) {
    if (!draft) return;

    const [proof, capture, objective, talent] = [
      dimensionValues.proof_asset ?? [],
      dimensionValues.capture_capability ?? [],
      dimensionValues.objective?.[0],
      dimensionValues.talent_availability?.[0],
    ];

    // The card cannot submit without these — `continueDisabled` holds the
    // button — but the tool requires them, so the guard is stated rather than
    // implied by a UI invariant two screens away.
    if (!proof.length || !capture.length || !objective || !talent) {
      setError('Pick an answer for each of these before continuing.');
      return;
    }

    setSavingDimensions(true);
    setError(undefined);

    const res = await invoke('genome.dimensions.set', {
      genomeId: draft.genomeId,
      proof_asset: proof,
      capture_capability: capture,
      objective,
      talent_availability: talent,
    });

    setSavingDimensions(false);

    if (res.status !== 'succeeded') {
      setError(humanError(res, 'That needs approval before it can run.'));
      return;
    }

    setStep(next);
  }

  const back = step > NAME ? () => { setError(undefined); setStep(step - 1); } : undefined;

  if (!restored) return <SparkLoader size="page" label="Opening your setup…" />;

  /* ── 1 · Brand identity ─────────────────────────────────────────────── */

  if (step === NAME) {
    return (
      <StepShell
        group={1}
        eyebrow={
          <>
            Lets set up your <strong className="font-semibold text-ink">Brand Identity</strong>
          </>
        }
        title="What is your Brand Name?"
        onContinue={() => setStep(URL_STEP)}
        continueDisabled={brandName.trim().length === 0}
        composer={
          <PromptComposer
            autoFocus
            value={brandName}
            onChange={setBrandName}
            onSubmit={() => setStep(URL_STEP)}
            placeholder="Enter your brand name"
          />
        }
      />
    );
  }

  if (step === URL_STEP) {
    /*
     * One gate for both ways of submitting. Continue was disabled for a
     * malformed address, but Enter called `bootstrap` directly — so "emkacuts"
     * plus Enter created a brand, spent a crawl, and came back with a Zod
     * message.
     */
    const canCrawl = looksLikeUrl(url) && !busy && !manualBusy;
    return (
      <StepShell
        group={2}
        // Not while the crawl runs: it finishes by moving to the next screen,
        // so going Back mid-crawl was undone half a minute later.
        {...(busy || manualBusy ? {} : { onBack: back })}
        eyebrow={
          <>
            <strong className="font-semibold text-ink">Great news!</strong> Your Brand Identity is ready.
            <br />
            Now, let&apos;s dive into your <strong className="font-semibold text-ink">Brand Knowledge!</strong>
          </>
        }
        title="What's your company URL?"
        onContinue={() => void bootstrap()}
        continueDisabled={!canCrawl}
        composer={
          /* The composer's own box is what the capture anchors at y 526.5, so the
             hint, error and opt-out hang BELOW it absolutely rather than sharing
             the anchored block — inside it they pushed the field 25px up. */
          <div className="relative">
            <PromptComposer
              autoFocus
              type="url"
              value={url}
              onChange={setUrl}
              onSubmit={() => canCrawl && void bootstrap()}
              placeholder="Enter your website URL"
              disabled={busy || manualBusy}
              icon={<ComposerGlobeIcon />}
            />

            <div className="absolute inset-x-0 top-full mt-4 flex flex-col gap-3">
            {error ? <p className="text-14 text-destructive">{error}</p> : null}
            {busy ? (
              // Named, because thirty seconds of silence reads as a hang. The
              // steps are the real ones the tool performs.
              <SparkLoader
                size="inline"
                // "About half a minute" was the measurement when this was
                // written; a five-page site now takes closer to sixty seconds,
                // and a wait that overruns its own promise reads as a hang.
                label="Opening your pages, reading them, and drafting your profile. This can take up to a minute and only happens once."
              />
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
                className="self-start text-14 text-ink-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
              >
                {crawlFailed ? 'Set up by answering questions instead' : 'I don’t have a website'}
              </button>
            ) : null}
            {manualBusy ? <SparkLoader size="inline" label="Setting up your brand…" /> : null}
            </div>
          </div>
        }
      />
    );
  }

  if (step === DETAILS && draft) {
    return (
      <StepShell
        group={2}
        onBack={back}
        // The prototype's own words: "Great! Got your brand name, {{ brandNameShown }}".
        eyebrow={<>Great! Got your brand name, <strong className="font-semibold text-brand-purple">{draft.businessName}</strong></>}
        title="Tell us a bit more about your brand?"
        // `Q_FIRST` collapses onto `DOCS` when the crawl resolved all four, so
        // a brand with a readable site never sees a question it answered.
        onContinue={() => setStep(Q_FIRST)}
        inBubble
        bubbleWidth={493}
      >
        <BrandDetailsStep
          genomeId={draft.genomeId}
          brandName={draft.businessName}
          {...(draft.category ? { initialNiche: draft.category } : {})}
        />
      </StepShell>
    );
  }

  /* ── 2 · The routing questions ──────────────────────────────────────── */

  if (draft && step >= Q_FIRST && step < DOCS) {
    const question = asks[step - Q_FIRST] as Question;
    const selected = dimensionValues[question.id] ?? [];
    const last = step === DOCS - 1;

    return (
      <StepShell
        group={2}
        onBack={back}
        title={question.prompt}
        {...(question.help ? { eyebrow: question.help } : {})}
        onContinue={
          // The last question is the one that saves: the four are one call.
          last ? () => void saveDimensions(DOCS) : () => setStep(step + 1)
        }
        continueDisabled={selected.length === 0 || savingDimensions}
        {...(last && savingDimensions ? { continueLabel: <Busy>Saving…</Busy> } : {})}
        inBubble
        bubbleWidth={493}
      >
        <QuestionStep
          question={question}
          selected={selected}
          onChange={(values) => setAnswers((prev) => ({ ...prev, [question.id]: values }))}
        />
        {error ? <p className="mt-4 text-14 text-[var(--ss-danger)]">{error}</p> : null}
      </StepShell>
    );
  }

  /* ── 2 · Brand knowledge ────────────────────────────────────────────── */

  if (draft && step === DOCS) {
    return (
      <StepShell
        group={2}
        onBack={back}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            Upload company Docs (PDF)
            <span
              title="Spark reads these documents to learn your brand voice, offering and facts."
              style={{
                width: 21.6,
                height: 21.6,
                borderRadius: '50%',
                boxShadow: 'inset 0 0 0 1.3px #B0B0B0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                color: '#B0B0B0',
                cursor: 'help',
              }}
            >
              i
            </span>
          </span>
        }
        titleTone="label"
        onContinue={() => setStep(KIT)}
        inBubble
        /* 581 on the 1728 canvas, which is 484 on this shell's 1440 frame. */
        bubbleWidth={484}
      >
        <CompanyDocsStep genomeId={draft.genomeId} />
      </StepShell>
    );
  }

  /* ── 3 · Brand kit ──────────────────────────────────────────────────── */

  if (draft && step === KIT) {
    return (
      <StepShell
        group={3}
        onBack={back}
        eyebrow={<><strong className="font-semibold text-ink">Exciting update!</strong> Your Brand Knowledge is complete. Next up, we'll focus on your <strong className="font-semibold text-ink">Brand's Voice, Guardrails, and Time Zone.</strong></>}
        /*
         * Save before advancing.
         *
         * `BrandKitStep` saved only on `onBlur` of its own container, which
         * covers the ordinary path — touch a control, then press Continue — and
         * nothing else. A value that changes without focus entering that
         * container leaves the step looking complete and persists none of it,
         * and that one call carries colours, fonts, voice, timezone, strict mode
         * and both guardrail lists together.
         *
         * Caught on a run where the brand kit was filled in on screen and the
         * row came back with `brand_colors: null` and the timezone untouched.
         *
         * The step still advances if the save fails: the failure is already
         * reported in the step's own message line, and trapping someone on this
         * screen over a write they can retry from settings is the worse outcome.
         */
        onContinue={() => {
          void kitSave.current?.().finally(() => setStep(AGENT));
        }}
      >
        <BrandKitStep
          registerSave={(fn) => { kitSave.current = fn; }}
          crawledKit={draft?.kit}
        />
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
        eyebrow={<><strong className="font-semibold text-ink">Great news!</strong> Your Brand Guardrails are set. Ready to <strong className="font-semibold text-ink">customize your media and agent?</strong></>}
        onContinue={() => setStep(DONE)}
        // `…193231` labels the last step's action Finish, not Continue.
        continueLabel="Finish"
      >
        <AgentStep genomeId={draft.genomeId} brandName={draft.businessName} />
      </StepShell>
    );
  }

  /* ── Done (`L5`) ────────────────────────────────────────────────────── */

  // No genome or brand name needed any more: the readiness list that read them
  // is gone, so this screen makes no tool calls at all.
  if (draft && step === DONE) {
    return <CompletionScreen onDone={() => router.push('/')} />;
  }

  /*
   * Reachable only if `draft` is missing past the URL step. A refresh no
   * longer lands here (see `Progress`); this is what is left for a saved run
   * that could not be read back. It used to say "Nothing was saved", which was
   * false — the brand and everything entered for it were — and "Start over"
   * made a second brand beside the first.
   */
  return (
    <StepShell
      group={1}
      title="Let’s pick up where you left off"
      subtitle={
        made
          ? 'Your brand was created, but this screen lost its place. Go back to the website step to carry on.'
          : 'This screen lost its place before your brand was created. Start again from its name.'
      }
      footer={<Button onClick={() => setStep(made ? URL_STEP : NAME)}>Carry on</Button>}
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

