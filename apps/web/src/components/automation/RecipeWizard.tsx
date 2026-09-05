'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { RecipeGlyph } from './RecipeGlyph';
import { KIND_META, STEP_BUBBLE, type RecipeKind, type StepKind } from './recipeMeta';

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
 * The form column is 812 wide at 375 with a 24 radius and `34px 40px` padding;
 * the summary rail is 470 at 1216. Both are laid out relative rather than
 * absolutely, so the screen survives a narrower window — the prototype's stage
 * is a fixed 1728 and simply scales.
 *
 * ── Which steps exist ─────────────────────────────────────────────────────
 *
 * From `wzKindsAll`: AutoTrend runs name → query → freq, Bulk runs
 * name → source → validate → freq, RSS runs name → feed → freq. The progress
 * bar and "of T" read off that array, so adding a step to a kind moves both.
 */

export interface WizardDraft {
  kind: RecipeKind;
  name: string;
  keywords: string[];
  excludeKeywords: string[];
  brandSafety: boolean;
  bulkSource: 'csv' | 'canva' | 'drive';
  sourceRef: string;
  feedUrl: string;
  feedType: 'News/Blogs' | 'Podcast Stations';
  ctaUrl: string;
  everyHours: number;
  reviewFirst: boolean;
  startToday: boolean;
}

export function emptyDraft(kind: RecipeKind): WizardDraft {
  return {
    kind,
    name: KIND_META[kind].name,
    keywords: [],
    excludeKeywords: [],
    brandSafety: false,
    bulkSource: 'csv',
    sourceRef: '',
    feedUrl: '',
    feedType: 'News/Blogs',
    ctaUrl: '',
    /* 24h — `recipe.create` takes minutes and refuses anything under 15. */
    everyHours: 24,
    reviewFirst: true,
    startToday: true,
  };
}

const FIELD =
  'h-[62px] w-full rounded-[13px] bg-white px-[22px] text-[17px] font-medium text-ink outline-none placeholder:text-[#B0B0B0]';
const FIELD_RING = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.28)' } as const;
const CARD = 'w-full max-w-auto-form rounded-[24px] bg-white px-[40px] pb-[44px] pt-[34px]';
const CARD_SHADOW = { boxShadow: '0 24px 60px -40px rgba(12,12,12,0.25)' } as const;

export function RecipeWizard({
  draft,
  onDraft,
  step,
  onStep,
  onBack,
  onLaunch,
  busy,
  error,
  validation,
}: {
  draft: WizardDraft;
  onDraft: (next: WizardDraft) => void;
  step: number;
  onStep: (next: number) => void;
  onBack: () => void;
  onLaunch: () => void;
  busy: boolean;
  error: string | null;
  /** `recipe.validate`'s answer for the config being built — see the validate step. */
  validation: { valid: boolean; error?: string; notApplied: string[] } | null;
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
      {/* ── SPARK's line above the step ──────────────────────────────────── */}
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
          {kind === 'name' ? <NameStep draft={draft} set={set} /> : null}
          {kind === 'query' ? <QueryStep draft={draft} set={set} /> : null}
          {kind === 'source' ? <SourceStep draft={draft} set={set} /> : null}
          {kind === 'validate' ? <ValidateStep draft={draft} validation={validation} /> : null}
          {kind === 'feed' ? <FeedStep draft={draft} set={set} /> : null}
          {kind === 'freq' ? <FreqStep draft={draft} set={set} /> : null}

          {error ? <p className="mt-[16px] max-w-auto-form text-15 text-destructive">{error}</p> : null}
          </div>
        </div>

        {kind === 'validate' ? null : <SummaryRail draft={draft} step={kind} />}
      </div>
    </div>
  );
}

/* ── steps ────────────────────────────────────────────────────────────── */

function NameStep({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  return (
    <section className={CARD} style={CARD_SHADOW}>
      <h2 className="text-[24px] font-bold text-ink">Name &amp; accounts</h2>

      <label htmlFor="auto-name" className="mt-[26px] block text-[16.5px] font-medium" style={{ color: '#5B5B5B' }}>
        Recipe name
      </label>
      <input id="auto-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} className={cn(FIELD, 'mt-[10px]')} style={FIELD_RING} />

      <p className="mt-[24px] text-[16.5px] font-medium" style={{ color: '#5B5B5B' }}>
        Target account(s)
      </p>
      {/* The design shows a chosen account chip and an "Add New". A recipe has
          no account field — `recipe.create` takes a genome, a kind and a config,
          and where a post lands is decided by its playbook when it is drafted —
          so this states that instead of drawing a picker onto nothing. */}
      <div
        className="mt-[10px] flex h-[58px] items-center gap-[11px] rounded-[13px] bg-white px-[18px]"
        style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}
        title="A recipe posts to whichever accounts its playbook is meant for. Connect or change accounts in Settings → Connections."
      >
        <span aria-hidden className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-[13px] font-semibold" style={{ background: '#E7EEF6', color: '#5B5B5B' }}>
          ?
        </span>
        <span className="text-16 font-medium text-ink-muted">Every connected account this recipe&rsquo;s playbook publishes to</span>
      </div>
      <p className="mt-[14px] text-15 font-normal" style={{ color: '#838383' }}>
        Posts publish to the accounts connected in Settings.
      </p>
    </section>
  );
}

function ChipInput({
  label,
  placeholder,
  chips,
  onAdd,
  onRemove,
  tone,
}: {
  label?: string;
  placeholder: string;
  chips: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  tone: 'keyword' | 'exclude';
}) {
  const [text, setText] = useState('');
  const commit = () => {
    const v = text.trim().replace(/,$/, '');
    if (!v) return;
    onAdd(v);
    setText('');
  };
  return (
    <>
      {label ? (
        <p className="mt-[30px] text-[16.5px] font-semibold text-ink">{label}</p>
      ) : null}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className={cn(FIELD, label ? 'mt-[10px]' : 'mt-[16px]', 'text-[16.5px]')}
        style={FIELD_RING}
      />
      {chips.length > 0 ? (
        <div className="mt-[13px] flex flex-wrap gap-[11px]">
          {chips.map((c) => (
            <span
              key={c}
              className="inline-flex h-[44px] items-center gap-[12px] rounded-[10px] px-[15px] text-[15.5px] font-semibold"
              style={
                tone === 'keyword'
                  ? { background: 'var(--ss-auto-kw-chip)', color: '#0C0C0C' }
                  : { background: 'var(--ss-auto-ex-chip)', color: 'var(--ss-auto-ex-ink)' }
              }
            >
              {c}
              <button type="button" onClick={() => onRemove(c)} aria-label={`Remove ${c}`} className="text-[15px] leading-none transition-opacity hover:opacity-60" style={{ color: tone === 'keyword' ? '#5B5B5B' : 'var(--ss-auto-ex-ink)' }}>
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function QueryStep({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  return (
    <section className={CARD} style={CARD_SHADOW}>
      <h2 className="text-[24px] font-bold text-ink">Set your starting query</h2>

      {/* The design's Keywords / Influencers toggle. `auto_trend`'s config takes
          `keywords` and `excludeKeywords`; there is no influencer field on a
          recipe (`trend.influencer.watch` is a separate, per-brand watchlist),
          so the second half would set nothing. */}
      <div className="mt-[22px] inline-flex h-[52px] items-center rounded-[12px] p-[4px]" style={{ background: 'rgba(131,131,131,0.08)' }}>
        <span className="flex h-[44px] w-[120px] items-center justify-center rounded-[9px] text-[15.5px] font-semibold text-ink" style={{ background: 'var(--ss-cyan-200)' }}>
          Keywords
        </span>
        <span
          className="flex h-[44px] w-[120px] cursor-not-allowed items-center justify-center text-[15.5px] font-semibold opacity-45"
          title="Influencer watching is a brand-level watchlist (trend.influencer.watch), not something a recipe stores."
        >
          Influencers
        </span>
      </div>

      <ChipInput
        placeholder="#Hashtags, Ai, marketing, automation…"
        chips={draft.keywords}
        onAdd={(v) => set({ keywords: [...new Set([...draft.keywords, v])] })}
        onRemove={(v) => set({ keywords: draft.keywords.filter((k) => k !== v) })}
        tone="keyword"
      />

      <h3 className="mt-[34px] text-[22px] font-bold text-ink">Refine your query</h3>
      {/* Region / Language / Max post age / Signal / Sources / Saved watchlist.
          None of the six is a field on an `auto_trend` config — the recipe
          stores keywords, exclusions and a minimum score — so they are shown as
          what the engine will actually apply rather than as six dead selects. */}
      <div className="mt-[18px] grid grid-cols-2 gap-x-[30px] gap-y-[22px] max-md:grid-cols-1">
        {[
          ['Region', 'Global'],
          ['Language', 'Every language the sources return'],
          ['Max post age', 'Whatever the source reports as current'],
          ['Signal', 'Velocity, growth and saturation together'],
          ['Sources', 'Every connected trend source'],
          ['Saved watchlist', 'Not applied to recipes'],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[16.5px] font-semibold text-ink">{label}</p>
            <div
              className="mt-[9px] flex h-[58px] items-center rounded-[12px] bg-white px-[20px]"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.28)' }}
              title="Set by the trend engine, not stored on the recipe."
            >
              <span className="truncate text-[16.5px] font-medium" style={{ color: '#5B5B5B' }}>
                {value}
              </span>
            </div>
          </div>
        ))}
      </div>

      <ChipInput
        label="Exclude keywords"
        placeholder="Crypto, nsfw"
        chips={draft.excludeKeywords}
        onAdd={(v) => set({ excludeKeywords: [...new Set([...draft.excludeKeywords, v])] })}
        onRemove={(v) => set({ excludeKeywords: draft.excludeKeywords.filter((k) => k !== v) })}
        tone="exclude"
      />

      <div className="mt-[26px] flex h-[70px] items-center gap-[14px] rounded-[14px] px-[22px]" style={{ background: 'var(--ss-auto-note)' }}>
        <svg width="22" height="24" viewBox="0 0 20 22" fill="none" aria-hidden className="shrink-0">
          <path d="M10 1.6 18 4.7v5.5c0 4.8-3.1 9-8 10.5-4.9-1.5-8-5.7-8-10.5V4.7l8-3.1Z" stroke="#0C0C0C" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M10 6.8v4.4M10 14v.6" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <div className="flex-1">
          <p className="text-[16.5px] font-bold text-ink">Enable Brand safety filter</p>
          <p className="mt-[3px] text-[14.5px] font-normal" style={{ color: '#5B5B5B' }}>
            Flagged posts route to Needs Review
          </p>
        </div>
        <Toggle on={draft.brandSafety} onToggle={() => set({ brandSafety: !draft.brandSafety })} label="Brand safety filter" />
      </div>
    </section>
  );
}

const BULK_SOURCES: ReadonlyArray<{ value: WizardDraft['bulkSource']; name: string; hint: string }> = [
  { value: 'csv', name: 'CSV upload', hint: 'A public link to the CSV.' },
  { value: 'canva', name: 'Canva', hint: 'The Canva folder id.' },
  { value: 'drive', name: 'Google Drive', hint: 'The Drive folder id.' },
];

function SourceStep({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  return (
    <section className={CARD} style={CARD_SHADOW}>
      <h2 className="text-[24px] font-bold text-ink">Choose a Source type</h2>

      {/* The design draws four tiles — Spark folder, Canva, Drive, CSV. A
          `bulk_connector` config takes exactly three sources (`csv`, `drive`,
          `canva`), so "Spark folder" is not offered: nothing would store it. */}
      <div className="mt-[24px] grid grid-cols-2 gap-[20px] max-md:grid-cols-1">
        {BULK_SOURCES.map((s) => {
          const on = draft.bulkSource === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => set({ bulkSource: s.value, sourceRef: '' })}
              aria-pressed={on}
              className="relative h-[150px] rounded-[16px] bg-white text-left transition-shadow hover:shadow-[inset_0_0_0_1.8px_#0C0C0C]"
              style={{ boxShadow: on ? 'inset 0 0 0 1.8px #0C0C0C, 0 14px 30px -22px rgba(12,12,12,0.4)' : 'inset 0 0 0 1px rgba(131,131,131,0.22)' }}
            >
              <span aria-hidden className="absolute left-[28px] top-[36px] flex h-[76px] w-[76px] items-center justify-center rounded-[16px]" style={{ background: on ? '#0C0C0C' : 'rgba(131,131,131,0.1)' }}>
                <span className={on ? 'text-white' : 'text-ink'}>
                  <RecipeGlyph kind="bulk_connector" size={34} />
                </span>
              </span>
              <span className="absolute left-[124px] top-[52px] whitespace-nowrap text-[19px] font-bold text-ink">{s.name}</span>
              <span className="absolute left-[124px] top-[82px] text-[14.5px]" style={{ color: '#838383' }}>
                {s.hint}
              </span>
              <span
                aria-hidden
                className="absolute right-[16px] top-[16px] flex h-[24px] w-[24px] items-center justify-center rounded-[7px] transition-colors"
                style={{ background: on ? '#0C0C0C' : '#FFFFFF', boxShadow: on ? 'none' : 'inset 0 0 0 1.4px rgba(12,12,12,0.3)' }}
              >
                {on ? (
                  <svg width="12" height="10" viewBox="0 0 11 9" fill="none">
                    <path d="m1 4.5 3 3L10 1" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <label htmlFor="auto-source-ref" className="mt-[26px] block text-[16.5px] font-semibold text-ink">
        {draft.bulkSource === 'csv' ? 'CSV URL' : draft.bulkSource === 'canva' ? 'Canva folder id' : 'Drive folder id'}
      </label>
      <input
        id="auto-source-ref"
        value={draft.sourceRef}
        onChange={(e) => set({ sourceRef: e.target.value })}
        placeholder={draft.bulkSource === 'csv' ? 'https://…/posts.csv' : 'folder id'}
        className={cn(FIELD, 'mt-[10px]')}
        style={FIELD_RING}
      />
    </section>
  );
}

function ValidateStep({ draft, validation }: { draft: WizardDraft; validation: { valid: boolean; error?: string; notApplied: string[] } | null }) {
  return (
    /* 430 on the design's stage — 55 further in than the 375 the other steps
       use, which lines this card up under the bubble rather than the form. */
    <section className="w-full max-w-[1256px] rounded-[24px] bg-white px-[30px] pb-[30px] pt-[36px] lg:ml-[55px]" style={CARD_SHADOW}>
      <h2 className="pl-[4px] text-[24px] font-bold text-ink">Preview &amp; validate:&nbsp; {draft.name}</h2>

      {/*
        The design lists the CSV's rows with a tick or a warning each.

        Nothing parses the file before the recipe runs — `recipe.validate`
        checks the *config*, and the rows are read by the engine on the first
        run — so this shows what can actually be checked now, and says plainly
        when the per-row pass happens. A table of invented rows would be the
        one thing worse than no table.
      */}
      <div className="mt-[28px] flex items-center gap-[14px] rounded-[16px] px-[20px] py-[16px]" style={{ background: validation?.valid === false ? 'var(--ss-auto-failed-bg)' : 'var(--ss-auto-note)' }}>
        {validation === null ? (
          <p className="text-[16.5px] font-medium text-ink">Checking this recipe…</p>
        ) : validation.valid ? (
          <p className="text-[16.5px] font-medium text-ink">
            🎉 <b className="font-bold">This recipe is valid.</b>&nbsp; Its rows are read on the first run, and anything
            unusable is reported in the output queue rather than published.
          </p>
        ) : (
          <p className="text-[16.5px] font-medium" style={{ color: 'var(--ss-auto-failed)' }}>
            {validation.error ?? 'This recipe is not valid yet.'}
          </p>
        )}
      </div>

      {validation?.notApplied.length ? (
        <div className="mt-[20px] rounded-[16px] px-[20px] py-[16px]" style={{ background: 'rgba(131,131,131,0.07)' }}>
          <p className="text-[16.5px] font-bold text-ink">Set, but not applied</p>
          <p className="mt-[6px] text-15" style={{ color: '#5B5B5B' }}>
            The engine ignores these for this kind of recipe: {validation.notApplied.join(', ')}.
          </p>
        </div>
      ) : null}

      <dl className="mt-[24px] grid grid-cols-2 gap-x-[30px] gap-y-[14px] max-md:grid-cols-1">
        {[
          ['Source', draft.bulkSource === 'csv' ? 'CSV upload' : draft.bulkSource === 'canva' ? 'Canva' : 'Google Drive'],
          ['Reference', draft.sourceRef || 'Not set'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-[12px] border-b pb-[10px]" style={{ borderColor: 'rgba(131,131,131,0.15)' }}>
            <dt className="text-[16.5px]" style={{ color: '#5B5B5B' }}>
              {k}
            </dt>
            <dd className="truncate text-[16.5px] font-semibold text-ink" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FeedStep({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  return (
    <section className={CARD} style={CARD_SHADOW}>
      <h2 className="text-[24px] font-bold text-ink">RSS feed URL</h2>

      <label htmlFor="auto-feed" className="mt-[26px] block text-[16.5px] font-semibold text-ink">
        Connect your RSS Feed URL:
      </label>
      <input
        id="auto-feed"
        value={draft.feedUrl}
        onChange={(e) => set({ feedUrl: e.target.value })}
        placeholder="https://blog.brand.com/feed"
        className={cn(FIELD, 'mt-[10px]')}
        style={FIELD_RING}
      />

      <p className="mt-[24px] text-[16.5px] font-semibold text-ink">Feed type</p>
      <div className="mt-[10px] flex gap-[12px]">
        {(['News/Blogs', 'Podcast Stations'] as const).map((t) => {
          const on = draft.feedType === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => set({ feedType: t })}
              aria-pressed={on}
              className="inline-flex h-[48px] items-center gap-[9px] rounded-[11px] px-[18px] text-16 font-semibold text-ink"
              style={{
                background: on ? '#FFFFFF' : 'rgba(131,131,131,0.06)',
                boxShadow: on ? 'inset 0 0 0 1.4px #0C0C0C' : 'inset 0 0 0 1px rgba(12,12,12,0.12)',
              }}
            >
              {t}
              {on ? (
                <span aria-hidden className="flex h-[16px] w-[16px] items-center justify-center rounded-full bg-ink">
                  <svg width="8" height="7" viewBox="0 0 9 8" fill="none">
                    <path d="m1 4 2.2 2.2L8 1" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {/* Feed type is a label on this screen: an `rss` config stores `feedUrl`
          and nothing else, and the parser treats a podcast feed as the RSS it
          is. Kept because it is how somebody describes their own feed. */}

      <div className="mt-[26px] flex items-center gap-[14px] rounded-[14px] px-[22px] py-[18px]" style={{ background: 'var(--ss-auto-note)' }}>
        <span aria-hidden className="shrink-0 text-ink">
          <RecipeGlyph kind="rss" size={22} />
        </span>
        <p className="text-15 font-medium leading-[1.4] text-ink">
          Streamline your content delivery with RSS feed automation, allowing you to effortlessly distribute updates,
          podcast and news to your audience in real-time.
        </p>
      </div>
    </section>
  );
}

function FreqStep({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  return (
    <section className={CARD} style={CARD_SHADOW}>
      <h2 className="text-[24px] font-bold text-ink">Set Frequency, CTA &amp; schedule</h2>

      <label htmlFor="auto-cta" className="mt-[24px] block text-[16.5px] font-semibold text-ink">
        Goal &amp; CTA URL
      </label>
      <input
        id="auto-cta"
        value={draft.ctaUrl}
        onChange={(e) => set({ ctaUrl: e.target.value })}
        placeholder="https://brand.com/offer"
        className={cn(FIELD, 'mt-[10px] text-[16.5px]')}
        style={FIELD_RING}
      />
      <p className="mt-[9px] text-[14.5px] font-medium" style={{ color: '#2AA02A' }}>
        Appended to each post when relevant.
      </p>

      {/* Custom Time / Regular Intervals. A recipe's cadence is one number —
          `intervalMinutes`, which the scheduler polls on — so the interval is
          what this sets, and the calendar-window half of the design has nothing
          to write to. */}
      <p className="mt-[26px] text-[16.5px] font-semibold text-ink">Post every</p>
      <div className="mt-[9px] flex flex-wrap items-center gap-[16px]">
        <div className="flex h-[58px] w-[150px] items-center justify-between rounded-[12px] bg-white px-[18px]" style={FIELD_RING}>
          <input
            type="number"
            min={1}
            max={168}
            value={draft.everyHours}
            onChange={(e) => set({ everyHours: Math.max(1, Math.min(168, Number(e.target.value) || 1)) })}
            aria-label="How many hours between runs"
            className="w-full bg-transparent text-[16.5px] font-semibold text-ink outline-none"
          />
        </div>
        <span className="flex h-[58px] w-[190px] items-center rounded-[12px] bg-white px-[18px] text-[16.5px] font-semibold text-ink" style={FIELD_RING}>
          Hour(s)
        </span>
        <span className="text-15" style={{ color: '#838383' }}>
          Minimum 15 minutes; the scheduler runs it on this cycle.
        </span>
      </div>

      <label className="mt-[22px] flex w-fit cursor-pointer items-center gap-[12px]">
        <input type="checkbox" checked={draft.startToday} onChange={() => set({ startToday: !draft.startToday })} className="sr-only" />
        <span
          aria-hidden
          className="flex h-[23px] w-[23px] items-center justify-center rounded-[6px] transition-colors"
          style={{ background: draft.startToday ? '#0C0C0C' : '#FFFFFF', boxShadow: draft.startToday ? 'none' : 'inset 0 0 0 1.3px rgba(12,12,12,0.35)' }}
        >
          {draft.startToday ? (
            <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
              <path d="m1 4.5 3 3L10 1" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>
        <span className="whitespace-nowrap text-16 font-medium text-ink">Run this campaign starting from today</span>
      </label>

      <div className="mt-[28px] flex items-center gap-[14px] rounded-[14px] px-[22px] py-[18px]" style={{ background: 'rgba(131,131,131,0.07)' }}>
        <div className="flex-1">
          <div className="flex items-center gap-[12px]">
            <p className="text-[17px] font-bold text-ink">Review before publish</p>
            <span className="inline-flex h-[24px] items-center rounded-[6px] px-[9px] text-[12.5px] font-semibold" style={{ background: 'rgba(131,131,131,0.14)', color: '#5B5B5B' }}>
              Optional
            </span>
          </div>
          <p className="mt-[5px] text-15 font-normal" style={{ color: '#5B5B5B' }}>
            Route every output to <b className="font-bold">Needs Review</b> instead of auto-publishing.
          </p>
        </div>
        <Toggle on={draft.reviewFirst} onToggle={() => set({ reviewFirst: !draft.reviewFirst })} label="Review before publish" />
      </div>

      <div className="mt-[16px] flex h-[56px] items-center gap-[12px] rounded-[12px] px-[20px]" style={{ background: 'var(--ss-auto-note)' }}>
        <svg width="18" height="19" viewBox="0 0 24 25" fill="none" aria-hidden className="shrink-0">
          <rect x="2.7" y="4.1" width="18.6" height="18.4" rx="4" stroke="#0C0C0C" strokeWidth="1.7" />
          <path d="M2.9 9.9h18.2" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M8.1 1.9v3.8M18.5 1.9v3.8" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <p className="text-15 font-medium text-ink">
          Governance is on. Flagged posts always route to Needs Review regardless of this setting.
        </p>
      </div>
    </section>
  );
}

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className="relative h-[29px] w-[52px] shrink-0 rounded-[29px] transition-colors duration-200"
      style={{ background: on ? 'var(--ss-green-600)' : 'rgba(12,12,12,0.18)' }}
    >
      <span
        aria-hidden
        className="absolute top-[3px] block h-[23px] w-[23px] rounded-full bg-white transition-[left] duration-200 motion-reduce:transition-none"
        style={{ left: on ? 26 : 3 }}
      />
    </button>
  );
}

/**
 * The right-hand rail — "Posts Summary" in the design, a 470-wide card at 1216
 * with a timeline rule and one panel per thing that has been chosen.
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
  ];
  if (draft.kind === 'auto_trend') {
    rows.push(['Keywords', draft.keywords.length ? draft.keywords.join(', ') : 'None yet']);
    if (draft.excludeKeywords.length) rows.push(['Excluding', draft.excludeKeywords.join(', ')]);
    rows.push(['Brand safety', draft.brandSafety ? 'On' : 'Off']);
  }
  if (draft.kind === 'bulk_connector') {
    rows.push(['Source', draft.bulkSource === 'csv' ? 'CSV upload' : draft.bulkSource === 'canva' ? 'Canva' : 'Google Drive']);
    rows.push(['Reference', draft.sourceRef || 'Not set']);
  }
  if (draft.kind === 'rss') {
    rows.push(['Feed', draft.feedUrl || 'Not set']);
    rows.push(['Type', draft.feedType]);
  }
  if (step === 'freq') {
    rows.push(['Every', `${draft.everyHours} hour${draft.everyHours === 1 ? '' : 's'}`]);
    rows.push(['Review first', draft.reviewFirst ? 'Yes' : 'No']);
    if (draft.ctaUrl) rows.push(['CTA', draft.ctaUrl]);
  }

  return (
    <aside className="w-auto-rail shrink-0 rounded-[20px] bg-white pb-[24px] max-lg:w-full" style={CARD_SHADOW}>
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
