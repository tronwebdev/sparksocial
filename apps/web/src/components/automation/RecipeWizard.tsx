'use client';

import { cn } from '@/lib/utils';
import { platformLabel } from '@/lib/platforms';
import { TrendResultsRail } from './TrendResultsRail';
import { FeedStep, FreqStep, NameStep, QueryStep, SourceStep, ValidateStep } from './WizardSteps';
import { KIND_META, STEP_BUBBLE, type StepKind } from './recipeMeta';
import type { WizardDraft } from './wizardDraft';

/**
 * The full-page recipe wizard — `SparkSocial Automation.dc.html`, `atWizard`.
 *
 * Chrome, on every step (measured from the shell card's left edge at 348):
 *
 *   back      378,74 · 112x52 r12 on `rgba(255,255,255,.7)` in a 1px hairline
 *   step      771,80 — "**Step N** of T" in 20/1.3
 *   creating  974,82 — a refresh glyph and "Creating Automation for **kind**"
 *   progress  771,118 · 511x10 r8, the fill on `--ss-grad-auto-progress`
 *             transitioning `width 0.4s cubic-bezier(.22,1,.36,1)`
 *   continue  1552,80 — 19/600, "Launch Automation" on the last step
 *   rule      378,150 · 1310x1
 *   bubble    435,206 — two 11px dots and a white 18r card, `max-width:470`
 *
 * The form column is 812 wide at 375; the rail is 470 at 1216, and it starts
 * *above* the form because the bubble lives inside the left column.
 *
 * ── Which steps exist ─────────────────────────────────────────────────────
 *
 * From `wzKindsAll`: AutoTrend runs name → query → freq, Bulk runs
 * name → source → validate → freq, RSS runs name → feed → freq. The progress
 * bar and "of T" read off that array, so adding a step to a kind moves both.
 *
 * The step bodies live in `WizardSteps`; the draft and its mapping onto a
 * recipe config live in `wizardDraft`.
 */

/**
 * `recipe.validate`'s shape. `notApplied` is a list of `{ field, because }` —
 * the engine naming a field it stores and does not read, in its own words.
 */
export interface Validation {
  valid: boolean;
  error?: string;
  notApplied: Array<{ field: string; because: string }>;
}

export function RecipeWizard({
  genomeId,
  draft,
  onDraft,
  step,
  onStep,
  onBack,
  onLaunch,
  busy,
  error,
  validation,
  canvaConnected,
  connecting,
  onConnectCanva,
  connectNote,
}: {
  genomeId: string;
  draft: WizardDraft;
  onDraft: (next: WizardDraft) => void;
  step: number;
  onStep: (next: number) => void;
  onBack: () => void;
  onLaunch: () => void;
  busy: boolean;
  error: string | null;
  /** `recipe.validate`'s answer for the config being built. */
  validation: Validation | null;
  /** `brand.oauth.status` for Canva, for the source step's connect strip. */
  canvaConnected: boolean | null;
  connecting: boolean;
  onConnectCanva: () => void;
  connectNote: string | null;
}) {
  const meta = KIND_META[draft.kind];
  const steps = meta.steps;
  const kind: StepKind = steps[Math.min(step, steps.length - 1)]!;
  const last = step === steps.length - 1;
  const set = (patch: Partial<WizardDraft>) => onDraft({ ...draft, ...patch });

  return (
    <div className="pb-[60px] pl-[27px] pr-[30px] pt-[56px]">
      {/* ── chrome ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-y-[16px] pl-[3px]">
        <button
          type="button"
          onClick={onBack}
          className="flex h-[52px] w-[112px] items-center justify-center gap-[13px] rounded-[12px] transition-colors hover:bg-white"
          style={{ background: 'rgba(255,255,255,0.7)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
        >
          <svg width="8" height="15" viewBox="0 0 8 16" fill="none" aria-hidden>
            <path d="M7 1 1 8l6 7" stroke="#5B5B5B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[17px] font-medium" style={{ color: '#5B5B5B' }}>
            Back
          </span>
        </button>

        <div className="ml-[281px] min-w-0 max-xl:ml-[30px]">
          <div className="flex flex-wrap items-center gap-x-[30px] gap-y-[6px]">
            <p className="whitespace-nowrap text-[20px] leading-[1.3] text-ink">
              <b className="font-bold">Step {step + 1}</b> of {steps.length}
            </p>
            <span className="flex items-center gap-[9px]">
              <svg width="17" height="17" viewBox="0 0 19 19" fill="none" aria-hidden>
                <path d="M16.6 9.5a7.1 7.1 0 1 1-2.05-5M16.9 1.6v3.3h-3.3" stroke="#838383" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="whitespace-nowrap text-16" style={{ color: '#838383' }}>
                Creating Automation for <b className="font-bold" style={{ color: '#5B5B5B' }}>{meta.name}</b>
              </span>
            </span>
          </div>

          <div className="mt-[14px] h-[10px] w-[511px] max-w-full overflow-hidden rounded-[8px]" style={{ background: 'rgba(131,131,131,0.18)' }}>
            <div
              className="h-[10px] rounded-[8px] transition-[width] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{ width: `${Math.round(((step + 1) / steps.length) * 100)}%`, background: 'var(--ss-grad-auto-progress)' }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => (last ? onLaunch() : onStep(step + 1))}
          disabled={busy}
          className="ml-auto flex h-[44px] items-center gap-[16px] rounded-[10px] px-[8px] transition-colors hover:bg-white/70 disabled:opacity-60"
        >
          <span className="whitespace-nowrap text-[19px] font-semibold text-ink">
            {busy ? 'Launching…' : last ? 'Launch Automation' : 'Continue'}
          </span>
          <svg width="9" height="16" viewBox="0 0 8 16" fill="none" aria-hidden>
            <path d="m1 1 6 7-6 7" stroke="#0C0C0C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="mt-[22px] h-px w-full max-w-[1310px]" style={{ background: 'rgba(131,131,131,0.2)' }} />

      {/* Validate is the one step with no rail: the design gives it a single
          1256-wide card at 430 and drops the summary column entirely, because
          the table it draws needs the width. */}
      <div className="mt-[36px] flex flex-wrap items-start gap-[29px]">
        <div className={cn('min-w-0', kind === 'validate' ? 'w-full' : 'w-auto-form shrink-0 max-lg:w-full')}>
          {/* ── SPARK's line above the step ────────────────────────────── */}
          {STEP_BUBBLE[kind] ? (
            <div className="mt-[20px] flex gap-[9px] pl-[60px] max-lg:mt-0 max-lg:pl-0">
              <span aria-hidden className="mt-[16px] block h-[11px] w-[11px] shrink-0 rounded-full bg-white" style={{ boxShadow: '0 2px 8px rgba(12,12,12,0.15)' }} />
              <span aria-hidden className="mt-[16px] block h-[11px] w-[11px] shrink-0 rounded-full bg-white" style={{ boxShadow: '0 2px 8px rgba(12,12,12,0.15)' }} />
              <div className="ml-[14px] max-w-[470px] rounded-[18px] bg-white px-[24px] py-[16px]" style={{ boxShadow: '0 12px 30px -18px rgba(12,12,12,0.3)' }}>
                <p className="text-[16.5px] font-medium leading-[1.4]" style={{ color: '#3B3B3B' }}>
                  {STEP_BUBBLE[kind]}
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-[16px]">
            {kind === 'name' ? <NameStep genomeId={genomeId} draft={draft} set={set} /> : null}
            {kind === 'query' ? <QueryStep genomeId={genomeId} draft={draft} set={set} /> : null}
            {kind === 'source' ? (
              <SourceStep
                draft={draft}
                set={set}
                canvaConnected={canvaConnected}
                connecting={connecting}
                onConnectCanva={onConnectCanva}
                connectNote={connectNote}
              />
            ) : null}
            {kind === 'validate' ? <ValidateStep draft={draft} validation={validation} /> : null}
            {kind === 'feed' ? <FeedStep draft={draft} set={set} /> : null}
            {kind === 'freq' ? <FreqStep draft={draft} set={set} /> : null}

            {error ? <p className="mt-[16px] max-w-auto-form text-15 text-destructive">{error}</p> : null}
          </div>
        </div>

        {/*
          Which rail this step gets.

          The design's query step has **Posts Results** — a live preview of the
          query as it is typed (`atResults`), not a summary of the form — and
          every other step has Posts Summary. Validate has neither: it takes the
          full width for its row table.
        */}
        {kind === 'validate' ? null : kind === 'query' ? (
          <TrendResultsRail
            genomeId={genomeId}
            keywords={draft.keywords}
            excludeKeywords={draft.excludeKeywords}
            region={draft.region}
            language={draft.language}
            onAddKeyword={(topic) => set({ keywords: [...new Set([...draft.keywords, topic])].slice(0, 10) })}
          />
        ) : (
          <SummaryRail draft={draft} step={kind} />
        )}
      </div>
    </div>
  );
}

/**
 * The rail on every step except the query — "Posts Summary" in the design, a
 * 470-wide card at 1216 with a timeline rule and one panel per thing chosen.
 *
 * The design fills it with eight account avatars and a file count. Both are
 * fixtures; what a recipe actually knows about itself at this point is what is
 * in the draft, so that is what it shows.
 */
function SummaryRail({ draft, step }: { draft: WizardDraft; step: StepKind }) {
  const meta = KIND_META[draft.kind];
  const rows: Array<[string, string]> = [
    ['Recipe', meta.name],
    ['Name', draft.name || 'Unnamed'],
    ['Accounts', draft.targetPlatforms.length ? draft.targetPlatforms.map(platformLabel).join(', ') : 'None picked'],
  ];

  if (draft.kind === 'auto_trend') {
    rows.push(['Type', draft.recipeType === 'repurpose' ? 'Re-purpose Post' : 'Re-share Post']);
    rows.push(['Keywords', draft.keywords.length ? draft.keywords.join(', ') : 'None yet']);
    if (draft.excludeKeywords.length) rows.push(['Excluding', draft.excludeKeywords.join(', ')]);
    if (draft.region) rows.push(['Region', draft.region]);
  }

  if (draft.kind === 'bulk_connector') {
    rows.push([
      'Source',
      draft.bulkSource === 'csv'
        ? draft.csvName || 'CSV upload'
        : draft.bulkSource === 'canva'
          ? 'Canva'
          : draft.bulkSource === 'drive'
            ? 'Google Drive'
            : 'Spark folder',
    ]);
  }

  if (draft.kind === 'rss') {
    rows.push(['Feed', draft.feedUrl || 'Not set']);
    rows.push(['Type', draft.feedType]);
  }

  if (step === 'freq') {
    rows.push([
      'Runs',
      draft.cadence === 'regular'
        ? `every ${draft.everyN} ${draft.everyUnit === 'days' ? 'day' : 'hour'}${draft.everyN === 1 ? '' : 's'}`
        : draft.frequency,
    ]);
    rows.push(['Review first', draft.reviewFirst ? 'Yes' : 'No']);
    if (draft.goal.trim()) rows.push(['Goal', draft.goal.trim()]);
  }

  return (
    <aside className="w-auto-rail shrink-0 rounded-[20px] bg-white pb-[24px] max-lg:w-full" style={{ boxShadow: '0 24px 60px -40px rgba(12,12,12,0.25)' }}>
      <p className="px-[26px] pt-[24px] text-[19px] font-bold text-ink">Posts Summary</p>
      <div className="mt-[20px] h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />

      <div className="relative mt-[22px] px-[26px]">
        <span aria-hidden className="absolute bottom-[16px] left-[36px] top-[16px] w-[2px]" style={{ background: 'rgba(131,131,131,0.2)' }} />
        <ul className="flex flex-col gap-[14px]">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-start gap-[16px]">
              <span aria-hidden className="mt-[4px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-white" style={{ boxShadow: 'inset 0 0 0 1.4px #838383' }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.6" stroke="#838383" strokeWidth="1.4" />
                  <path d="M8 4.8V8l2.2 1.5" stroke="#838383" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </span>
              <span className="min-w-0 flex-1 rounded-[16px] px-[18px] py-[12px]" style={{ background: 'rgba(131,131,131,0.07)' }}>
                <span className="block text-[14px] font-medium" style={{ color: '#838383' }}>
                  {k}
                </span>
                <span className="mt-[3px] block break-words text-[16px] font-bold text-ink">{v}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
