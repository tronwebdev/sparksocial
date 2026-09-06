'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { parseCsvPreview } from './csvPreview';
import { AccountPicker } from './AccountPicker';
import { InfluencerPanel } from './InfluencerPanel';
import { RecipeGlyph } from './RecipeGlyph';
import { folderIdFrom, type WizardDraft } from './wizardDraft';

/**
 * The wizard's step bodies. The chrome lives in `RecipeWizard`.
 *
 * Every control here writes to a field the engine actually reads, or says why
 * it does not — the three config schemas are in `packages/recipes/src/runners.ts`
 * and they are the whole vocabulary available.
 */

export const FIELD =
  'h-[62px] w-full rounded-[13px] bg-white px-[22px] text-[17px] font-medium text-ink outline-none placeholder:text-[#B0B0B0]';
export const FIELD_RING = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.28)' } as const;
export const CARD = 'w-full max-w-auto-form rounded-[24px] bg-white px-[40px] pb-[44px] pt-[34px]';
export const CARD_SHADOW = { boxShadow: '0 24px 60px -40px rgba(12,12,12,0.25)' } as const;

type Set = (p: Partial<WizardDraft>) => void;

/** The design's `h-[58px]` select, used everywhere a value is chosen. */
function Dropdown({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[16.5px] font-semibold text-ink">{label}</div>
      <div
        className="mt-[9px] flex h-[58px] items-center rounded-[12px] bg-white pl-[20px] pr-[14px] transition-shadow focus-within:shadow-[inset_0_0_0_1.4px_#838383]"
        style={FIELD_RING}
      >
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="w-full cursor-pointer appearance-none bg-transparent text-[16.5px] font-medium text-ink outline-none"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg width="13" height="8" viewBox="0 0 13 8" fill="none" aria-hidden className="pointer-events-none shrink-0">
          <path d="m1 1 5.5 6L12 1" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {hint ? (
        <p className="mt-[6px] text-[13px]" style={{ color: '#838383' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
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

/** The design's sliding two-up pill — `atKwPillLeft`, `atFreqPillLeft`. */
function PillToggle({
  width,
  options,
  value,
  onChange,
}: {
  width: number;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="relative inline-flex h-[52px] rounded-[12px] p-[4px]" style={{ background: 'rgba(131,131,131,0.08)' }}>
      <span
        aria-hidden
        className="absolute top-[4px] h-[44px] rounded-[9px] transition-[left] duration-[250ms] ease-out motion-reduce:transition-none"
        style={{ width, left: 4 + index * (width + 2), background: 'var(--ss-cyan-200)' }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className="relative z-[1] flex h-[44px] items-center justify-center text-[15.5px] font-semibold text-ink"
          style={{ width }}
        >
          {o.label}
        </button>
      ))}
    </div>
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
      {label ? <p className="mt-[30px] text-[16.5px] font-semibold text-ink">{label}</p> : null}
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
        aria-label={label ?? 'Keywords'}
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
              <button
                type="button"
                onClick={() => onRemove(c)}
                aria-label={`Remove ${c}`}
                className="text-[15px] leading-none transition-opacity hover:opacity-60"
                style={{ color: tone === 'keyword' ? '#5B5B5B' : 'var(--ss-auto-ex-ink)' }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

/* ── step 1: name, recipe type, accounts ───────────────────────────────── */

const RECIPE_TYPES = [
  {
    value: 'repurpose' as const,
    name: 'Re-purpose Post',
    desc: 'Transform this post for a new audience.',
  },
  {
    value: 'reshare' as const,
    name: 'Re-share Post',
    desc: 'Share this post with your network!',
  },
];

export function NameStep({ genomeId, draft, set }: { genomeId: string; draft: WizardDraft; set: Set }) {
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
      <AccountPicker genomeId={genomeId} selected={draft.targetPlatforms} onSelected={(targetPlatforms) => set({ targetPlatforms })} />

      {/* `atShowRecipeType` — AutoTrend only, two 120px cards at a 18px gap
          with the tick at right 16 / top 16. */}
      {draft.kind === 'auto_trend' ? (
        <>
          <p className="mt-[30px] text-[19px] font-bold text-ink">Choose Recipe Type</p>
          <div className="mt-[14px] flex gap-[18px] max-md:flex-col">
            {RECIPE_TYPES.map((t) => {
              const on = draft.recipeType === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set({ recipeType: t.value })}
                  aria-pressed={on}
                  className="relative h-[120px] flex-1 rounded-[16px] bg-white text-left transition-shadow hover:shadow-[inset_0_0_0_1.6px_#838383]"
                  style={{ boxShadow: on ? 'inset 0 0 0 1.8px #0C0C0C' : 'inset 0 0 0 1px rgba(131,131,131,0.28)' }}
                >
                  <span className="absolute left-[24px] top-[24px] whitespace-nowrap text-18 font-bold text-ink">{t.name}</span>
                  <span className="absolute left-[24px] top-[58px] text-15 font-normal" style={{ color: '#838383' }}>
                    {t.desc}
                  </span>
                  {on ? (
                    <span aria-hidden className="absolute right-[16px] top-[16px] flex h-[21px] w-[21px] items-center justify-center rounded-full bg-ink">
                      <svg width="10" height="9" viewBox="0 0 9 8" fill="none">
                        <path d="m1 4 2.2 2.2L8 1" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {/* The runner turns a trend into a draft through `trend.repurpose`,
              which is what Re-purpose is. There is no re-share path in the
              recipe engine — `trend.reshare` reframes an existing post and a
              recipe has none — so the second card is honest about what picking
              it changes today. */}
          {draft.recipeType === 'reshare' ? (
            <p className="mt-[12px] text-15" style={{ color: 'var(--ss-amber-500)' }}>
              Recorded, but the recipe engine only re-purposes today: each run turns a trend into a new
              post. Re-sharing reframes a post you already have, which a recipe does not pick.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/* ── step 2 (AutoTrend): the query ─────────────────────────────────────── */

const REGIONS = [
  { value: '', label: 'Global' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'IN', label: 'India' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'BR', label: 'Brazil' },
];

const LANGUAGES = [
  { value: '', label: 'Every language' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
];

const SIGNALS = [
  { value: '0.2', label: 'Anything trending' },
  { value: '0.4', label: 'Balanced' },
  { value: '0.6', label: 'Strong signal only' },
  { value: '0.8', label: 'Only the strongest' },
];

const OUTPUTS = [1, 2, 3, 5, 8, 10].map((n) => ({ value: String(n), label: `${n} post${n === 1 ? '' : 's'} per run` }));

export function QueryStep({ genomeId, draft, set }: { genomeId: string; draft: WizardDraft; set: Set }) {
  return (
    <section className={CARD} style={CARD_SHADOW}>
      <h2 className="text-[24px] font-bold text-ink">Set your starting query</h2>

      <div className="mt-[22px]">
        <PillToggle
          width={120}
          value={draft.queryTab}
          onChange={(v) => set({ queryTab: v as WizardDraft['queryTab'] })}
          options={[
            { value: 'keywords', label: 'Keywords' },
            { value: 'influencers', label: 'Influencers' },
          ]}
        />
      </div>

      {draft.queryTab === 'influencers' ? (
        <InfluencerPanel genomeId={genomeId} />
      ) : (
        <>
          <ChipInput
            placeholder="#Hashtags, Ai, marketing, automation…"
            chips={draft.keywords}
            onAdd={(v) => set({ keywords: [...new Set([...draft.keywords, v])].slice(0, 10) })}
            onRemove={(v) => set({ keywords: draft.keywords.filter((k) => k !== v) })}
            tone="keyword"
          />
          {draft.keywords.length >= 10 ? (
            <p className="mt-[8px] text-[13px]" style={{ color: '#838383' }}>
              Ten is the cap — keywords are OR&rsquo;d, so a recipe watching twenty topics is watching
              everything.
            </p>
          ) : null}
        </>
      )}

      <h3 className="mt-[34px] text-[22px] font-bold text-ink">Refine your query</h3>
      {/* Four dropdowns, not the design's six. Region and Language are passed
          to `TrendSource.fetch`; Signal is `minScore` and Posts per run is
          `maxOutputs`. The design's other two — Max post age and Saved
          watchlist — have no field on `AutoTrendConfig` to write to, and a
          select that sets nothing is worse than one fewer select. */}
      <div className="mt-[18px] grid grid-cols-2 gap-x-[30px] gap-y-[22px] max-md:grid-cols-1">
        <Dropdown label="Region" value={draft.region} onChange={(region) => set({ region })} options={REGIONS} />
        <Dropdown label="Language" value={draft.language} onChange={(language) => set({ language })} options={LANGUAGES} />
        <Dropdown
          label="Signal"
          value={String(draft.signal)}
          onChange={(v) => set({ signal: Number(v) })}
          options={SIGNALS}
          hint="How strong a trend has to score before this recipe acts on it."
        />
        <Dropdown
          label="Posts per run"
          value={String(draft.maxOutputs)}
          onChange={(v) => set({ maxOutputs: Number(v) })}
          options={OUTPUTS}
        />
      </div>

      <ChipInput
        label="Exclude keywords"
        placeholder="Crypto, nsfw"
        chips={draft.excludeKeywords}
        onAdd={(v) => set({ excludeKeywords: [...new Set([...draft.excludeKeywords, v])].slice(0, 20) })}
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
      {draft.brandSafety ? (
        <p className="mt-[8px] text-[13px]" style={{ color: '#838383' }}>
          Guardrails already route anything they flag to Needs Review; this keeps the review gate on for
          everything this recipe produces.
        </p>
      ) : null}
    </section>
  );
}

/* ── step 2 (Bulk): where the posts come from ──────────────────────────── */

const SOURCES = [
  { value: 'folder' as const, name: 'Spark folder', hint: 'A folder from your Assets Library' },
  { value: 'canva' as const, name: 'Canva', hint: 'Designs from a Canva folder' },
  { value: 'drive' as const, name: 'Google Drive', hint: 'Files from a shared Drive folder' },
  { value: 'csv' as const, name: 'CSV upload', hint: 'A spreadsheet of posts' },
];

export function SourceStep({
  draft,
  set,
  canvaConnected,
  connecting,
  onConnectCanva,
  connectNote,
}: {
  draft: WizardDraft;
  set: Set;
  canvaConnected: boolean | null;
  connecting: boolean;
  onConnectCanva: () => void;
  connectNote: string | null;
}) {
  return (
    <>
      <section className={CARD} style={CARD_SHADOW}>
        <h2 className="text-[24px] font-bold text-ink">Choose a Source type</h2>

        <div className="mt-[24px] grid grid-cols-2 gap-[20px] max-md:grid-cols-1">
          {SOURCES.map((s) => {
            const on = draft.bulkSource === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => set({ bulkSource: s.value })}
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

        {/* ── what each source needs, if anything ────────────────────────── */}
        {draft.bulkSource === 'csv' ? (
          <div className="mt-[26px]">
            <p className="text-[16.5px] font-semibold text-ink">Upload your sheet</p>
            <label
              className="mt-[10px] flex h-[96px] cursor-pointer items-center justify-center gap-[12px] rounded-[18px]"
              style={{ background: 'rgba(255,255,255,0.85)', border: '1.6px dashed rgba(131,131,131,0.45)' }}
            >
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  /* Read here and send the text: `BulkConnectorConfig` takes
                     `csvText` as well as `csvUrl`, so a picked file needs no
                     upload and no public URL to be fetched from. */
                  set({ csvName: file.name, csvText: await file.text() });
                }}
              />
              <svg width="21" height="18" viewBox="0 0 21 18" fill="none" aria-hidden>
                <path d="M5.4 14.5H4.8A3.8 3.8 0 0 1 4 7a5.4 5.4 0 0 1 10.6-1.2A4.3 4.3 0 0 1 16 14.4h-.9" stroke="#0C0C0C" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M10.5 16.6V9.2m0 0-2.7 2.7m2.7-2.7 2.7 2.7" stroke="#0C0C0C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-16 font-semibold text-ink">
                {draft.csvName ? `${draft.csvName} — pick another` : 'Choose a CSV file'}
              </span>
            </label>
            <p className="mt-[9px] text-[13.5px]" style={{ color: '#838383' }}>
              Read in your browser and stored on the recipe, so nothing has to be publicly downloadable.
              Its rows are listed on the next step.
            </p>
          </div>
        ) : null}

        {draft.bulkSource === 'canva' ? (
          <div className="mt-[26px]">
            <p className="text-[16.5px] font-semibold text-ink">Which Canva folder</p>
            <input
              value={draft.canvaUrl}
              onChange={(e) => set({ canvaUrl: e.target.value })}
              placeholder="Paste the folder link from Canva"
              className={cn(FIELD, 'mt-[10px]')}
              style={FIELD_RING}
              aria-label="Canva folder link"
            />
            <p className="mt-[9px] text-[13.5px]" style={{ color: '#838383' }}>
              {draft.canvaUrl
                ? `Folder ${folderIdFrom(draft.canvaUrl)} — read through your connected Canva account each run.`
                : 'Open the folder in Canva and copy its link. Nothing in the API lists your folders, so this is how the recipe knows which one.'}
            </p>
          </div>
        ) : null}

        {draft.bulkSource === 'drive' ? (
          <div className="mt-[26px]">
            <p className="text-[16.5px] font-semibold text-ink">Which Drive folder</p>
            <input
              value={draft.driveUrl}
              onChange={(e) => set({ driveUrl: e.target.value })}
              placeholder="Paste the folder link from Google Drive"
              className={cn(FIELD, 'mt-[10px]')}
              style={FIELD_RING}
              aria-label="Google Drive folder link"
            />
            {/* Drive is not an OAuth connection here: the engine reads it through
                one shared API key, so it can only ever see a link-shared folder.
                Drawing a "Connect Google Drive" button would promise an account
                link that does not exist. */}
            <p className="mt-[9px] text-[13.5px]" style={{ color: '#838383' }}>
              Set the folder to <b className="font-semibold">Anyone with the link can view</b>. Drive is read
              through a shared key rather than your Google account, so it only ever sees what is
              link-shared.
            </p>
          </div>
        ) : null}

        {draft.bulkSource === 'folder' ? (
          <p className="mt-[26px] rounded-[14px] px-[20px] py-[16px] text-15 leading-[1.5]" style={{ background: 'var(--ss-auto-review-bg)', color: '#5B5B5B' }}>
            <b className="font-semibold text-ink">Not wired to the Assets Library yet.</b> The engine&rsquo;s
            `folder` source was written for a machine folder, which a hosted app has none of, and it
            refuses the run rather than pretending. Your Assets Library folders are real — connecting them
            to a recipe needs the runner to read them, which it does not do today. Use CSV, Canva or Drive
            in the meantime.
          </p>
        ) : null}
      </section>

      {/* The design's dashed "Canva — not connected" strip with its + Connect. */}
      {draft.bulkSource === 'canva' && canvaConnected === false ? (
        <div
          className="mt-[26px] flex w-full max-w-auto-form flex-wrap items-center gap-[16px] rounded-[18px] px-[40px] py-[24px]"
          style={{ background: 'rgba(255,255,255,0.85)', border: '1.6px dashed rgba(131,131,131,0.45)' }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[19px] font-bold text-ink">Canva — not connected</p>
            {connectNote ? (
              <p className="mt-[4px] text-[13.5px]" style={{ color: '#5B5B5B' }}>
                {connectNote}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onConnectCanva}
            disabled={connecting}
            className="h-[46px] shrink-0 rounded-[11px] px-[22px] text-16 font-semibold text-white transition-opacity hover:opacity-92 disabled:opacity-60"
            style={{ background: 'var(--ss-grad-auto-connect)' }}
          >
            {connecting ? 'Opening…' : '+ Connect'}
          </button>
        </div>
      ) : null}
    </>
  );
}

/* ── step 3 (Bulk): preview & validate ─────────────────────────────────── */

export function ValidateStep({
  draft,
  validation,
}: {
  draft: WizardDraft;
  validation: { valid: boolean; error?: string; notApplied: Array<{ field: string; because: string }> } | null;
}) {
  const rows = draft.bulkSource === 'csv' ? parseCsvPreview(draft.csvText) : null;

  return (
    <section className="w-full max-w-[1256px] rounded-[24px] bg-white px-[30px] pb-[30px] pt-[36px] lg:ml-[55px]" style={CARD_SHADOW}>
      <h2 className="pl-[4px] text-[24px] font-bold text-ink">
        Preview &amp; validate your files on:&nbsp; {draft.csvName || draft.name}
      </h2>

      <div className="mt-[28px] flex items-center gap-[14px] rounded-[16px] px-[20px] py-[16px]" style={{ background: validation?.valid === false ? 'var(--ss-auto-failed-bg)' : 'var(--ss-auto-note)' }}>
        {validation === null ? (
          <p className="text-[16.5px] font-medium text-ink">Checking this recipe…</p>
        ) : !validation.valid ? (
          <p className="text-[16.5px] font-medium" style={{ color: 'var(--ss-auto-failed)' }}>
            {validation.error ?? 'This recipe is not valid yet.'}
          </p>
        ) : rows ? (
          <p className="text-[16.5px] font-medium text-ink">
            🎉 <b className="font-bold">Your file was read:</b>&nbsp; {rows.rows.length} row
            {rows.rows.length === 1 ? '' : 's'} detected&nbsp;&nbsp;·&nbsp;&nbsp;{rows.valid} valid
            &nbsp;&nbsp;·&nbsp;&nbsp;{rows.rows.length - rows.valid} warning
            {rows.rows.length - rows.valid === 1 ? '' : 's'}
          </p>
        ) : (
          <p className="text-[16.5px] font-medium text-ink">
            🎉 <b className="font-bold">This recipe is valid.</b>&nbsp; Its items are read on the first run.
          </p>
        )}
      </div>

      {validation?.notApplied.length ? (
        <div className="mt-[20px] rounded-[16px] px-[20px] py-[16px]" style={{ background: 'rgba(131,131,131,0.07)' }}>
          <p className="text-[16.5px] font-bold text-ink">Saved, but not applied yet</p>
          <ul className="mt-[8px] flex flex-col gap-[8px]">
            {validation.notApplied.map((n) => (
              <li key={n.field} className="text-15 leading-[1.45]" style={{ color: '#5B5B5B' }}>
                <b className="font-semibold text-ink">{n.field}</b> — {n.because}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The design's row table, filled from the file that was actually picked —
          the same `title || topic || first column` rule the runner applies. */}
      {rows ? (
        rows.rows.length === 0 ? (
          <p className="mt-[24px] text-16 text-ink-muted">That file has no data rows under its header.</p>
        ) : (
          <div className="mt-[28px] overflow-x-auto">
            <div className="min-w-[820px]">
              <div className="flex h-[44px] items-center text-[16.5px] font-medium" style={{ color: '#5B5B5B', boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.2)' }}>
                <span className="w-[60px] shrink-0" />
                <span className="flex-1">Caption</span>
                <span className="w-[220px]">Media</span>
                <span className="w-[280px]">Link</span>
              </div>
              {rows.rows.slice(0, 12).map((r, i) => (
                <div key={`${r.title}-${i}`} className="flex h-[72px] items-center" style={{ boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.12)' }}>
                  <span className="flex w-[60px] shrink-0 items-center pl-[4px]">
                    {r.ok ? (
                      <span aria-hidden className="flex h-[22px] w-[22px] items-center justify-center rounded-full" style={{ background: '#22B14C' }}>
                        <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                          <path d="m1 4.5 3 3L10 1" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    ) : (
                      <svg width="22" height="20" viewBox="0 0 22 20" fill="none" aria-hidden>
                        <path d="M9.3 1.9a2 2 0 0 1 3.4 0l7.8 13.4a2 2 0 0 1-1.7 3H3.2a2 2 0 0 1-1.7-3L9.3 1.9Z" stroke="#E23B3B" strokeWidth="1.7" strokeLinejoin="round" />
                        <path d="M11 7v4.4M11 14.6v.5" stroke="#E23B3B" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate pr-[16px] text-18 font-semibold text-ink" title={r.title}>
                    {r.title || '(no title column)'}
                  </span>
                  <span className="w-[220px] truncate pr-[12px] text-16 font-medium" style={{ color: '#5B5B5B' }}>
                    {r.media || '—'}
                  </span>
                  <span className="w-[280px] truncate text-16 font-medium" style={{ color: '#5B5B5B' }}>
                    {r.link || '—'}
                  </span>
                </div>
              ))}
              {rows.rows.length > 12 ? (
                <p className="pt-[14px] text-15" style={{ color: '#838383' }}>
                  and {rows.rows.length - 12} more — all of them are read when the recipe runs.
                </p>
              ) : null}
            </div>
          </div>
        )
      ) : (
        <dl className="mt-[24px] grid grid-cols-2 gap-x-[30px] gap-y-[14px] max-md:grid-cols-1">
          {[
            ['Source', draft.bulkSource === 'canva' ? 'Canva' : draft.bulkSource === 'drive' ? 'Google Drive' : 'Spark folder'],
            ['Folder', folderIdFrom(draft.bulkSource === 'canva' ? draft.canvaUrl : draft.driveUrl) || 'Not set'],
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
          <p className="col-span-2 text-15" style={{ color: '#838383' }}>
            The folder&rsquo;s files are listed by the first run — nothing here can read it before the
            recipe holds the credential it uses.
          </p>
        </dl>
      )}
    </section>
  );
}

/* ── step 2 (RSS): the feed ────────────────────────────────────────────── */

export function FeedStep({ draft, set }: { draft: WizardDraft; set: Set }) {
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

      <div className="mt-[26px] flex items-center gap-[14px] rounded-[14px] px-[22px] py-[18px]" style={{ background: 'var(--ss-auto-note)' }}>
        <span aria-hidden className="shrink-0 text-ink">
          <RecipeGlyph kind="rss" size={22} />
        </span>
        <p className="text-15 font-medium leading-[1.4] text-ink">
          Streamline your content delivery with RSS feed automation, allowing you to effortlessly distribute
          updates, podcast and news to your audience in real-time.
        </p>
      </div>
    </section>
  );
}

/* ── last step: frequency, CTA & schedule ──────────────────────────────── */

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
];

export function FreqStep({ draft, set }: { draft: WizardDraft; set: Set }) {
  return (
    <section className={CARD} style={CARD_SHADOW}>
      <h2 className="text-[24px] font-bold text-ink">Set Frequency, CTA &amp; schedule</h2>

      <label htmlFor="auto-goal" className="mt-[24px] block text-[16.5px] font-semibold text-ink">
        Goal
      </label>
      <input
        id="auto-goal"
        value={draft.goal}
        onChange={(e) => set({ goal: e.target.value })}
        placeholder="Book more demos"
        className={cn(FIELD, 'mt-[10px] text-[16.5px]')}
        style={FIELD_RING}
      />
      <p className="mt-[9px] text-[14.5px] font-medium" style={{ color: '#2AA02A' }}>
        Folded into every post this recipe writes.
      </p>

      {/* Two fields where the design has one. `goal` is applied — it reaches the
          copy through the output's intent — and `ctaUrl` is stored and not,
          because a URL in prose becomes spoken copy. Sharing one box would hide
          that difference. */}
      <label htmlFor="auto-cta" className="mt-[20px] block text-[16.5px] font-semibold text-ink">
        CTA URL
      </label>
      <input
        id="auto-cta"
        value={draft.ctaUrl}
        onChange={(e) => set({ ctaUrl: e.target.value })}
        placeholder="https://brand.com/offer"
        className={cn(FIELD, 'mt-[10px] text-[16.5px]')}
        style={FIELD_RING}
      />
      <p className="mt-[9px] text-[14.5px]" style={{ color: '#838383' }}>
        Saved on the recipe. A recipe output has no link field yet, so SPARK does not paste it into the
        copy — putting a URL in prose is how posts end up reciting one out loud.
      </p>

      <div className="mt-[24px] flex flex-wrap items-center justify-between gap-[16px]">
        <PillToggle
          width={190}
          value={draft.cadence}
          onChange={(v) => set({ cadence: v as WizardDraft['cadence'] })}
          options={[
            { value: 'custom', label: 'Custom Time' },
            { value: 'regular', label: 'Regular Intervals' },
          ]}
        />

        <label className="flex cursor-pointer items-center gap-[12px]">
          <input type="checkbox" checked={draft.startToday} onChange={() => set({ startToday: !draft.startToday })} className="sr-only" />
          <span className="whitespace-nowrap text-16 font-medium text-ink">Run this campaign starting from today</span>
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
        </label>
      </div>

      {draft.cadence === 'custom' ? (
        <div className="mt-[26px] grid grid-cols-2 gap-x-[30px] gap-y-[22px] max-md:grid-cols-1">
          <Dropdown
            label="Frequency"
            value={draft.frequency}
            onChange={(v) => set({ frequency: v as WizardDraft['frequency'] })}
            options={FREQUENCIES}
            {...(draft.frequency === 'weekdays'
              ? { hint: 'Runs daily — the engine polls on an interval and has no weekday filter yet.' }
              : {})}
          />
          <div>
            <div className="text-[16.5px] font-semibold text-ink">Posting window</div>
            <div
              className="mt-[9px] flex h-[58px] cursor-not-allowed items-center rounded-[12px] bg-white px-[20px] opacity-70"
              style={FIELD_RING}
              title="A recipe has no posting-window field. When a run produces posts, the scheduler staggers them by 11 minutes and the brand's own posting windows apply."
            >
              <span className="truncate text-[16.5px] font-medium" style={{ color: '#5B5B5B' }}>
                Your brand&rsquo;s posting windows
              </span>
            </div>
          </div>
          <div>
            <label htmlFor="auto-start" className="block text-[16.5px] font-semibold text-ink">
              Start date
            </label>
            <input
              id="auto-start"
              type="date"
              value={draft.startDate}
              disabled={draft.startToday}
              onChange={(e) => set({ startDate: e.target.value })}
              className="mt-[9px] h-[58px] w-full rounded-[12px] bg-white px-[20px] text-[16.5px] font-medium text-ink outline-none disabled:opacity-60"
              style={FIELD_RING}
            />
          </div>
          <div>
            <label htmlFor="auto-end" className="block text-[16.5px] font-semibold text-ink">
              End date
            </label>
            <input
              id="auto-end"
              type="date"
              value={draft.endDate}
              onChange={(e) => set({ endDate: e.target.value })}
              className="mt-[9px] h-[58px] w-full rounded-[12px] bg-white px-[20px] text-[16.5px] font-medium text-ink outline-none"
              style={FIELD_RING}
            />
          </div>
        </div>
      ) : (
        <>
          <p className="mt-[26px] text-[16.5px] font-semibold text-ink">Post Every</p>
          <div className="mt-[9px] flex flex-wrap gap-[16px]">
            <input
              type="number"
              min={1}
              max={30}
              value={draft.everyN}
              onChange={(e) => set({ everyN: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
              aria-label="How many"
              className="h-[58px] w-[150px] rounded-[12px] bg-white px-[18px] text-[16.5px] font-semibold text-ink outline-none"
              style={FIELD_RING}
            />
            <div className="flex h-[58px] w-[190px] items-center rounded-[12px] bg-white pl-[18px] pr-[14px]" style={FIELD_RING}>
              <select
                value={draft.everyUnit}
                onChange={(e) => set({ everyUnit: e.target.value as WizardDraft['everyUnit'] })}
                aria-label="Unit"
                className="w-full cursor-pointer appearance-none bg-transparent text-[16.5px] font-semibold text-ink outline-none"
              >
                <option value="hours">Hour(s)</option>
                <option value="days">Day(s)</option>
              </select>
              <svg width="12" height="18" viewBox="0 0 12 18" fill="none" aria-hidden className="pointer-events-none shrink-0">
                <path d="m2 7 4-4 4 4M2 11l4 4 4-4" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          <p className="mt-[9px] text-[13.5px]" style={{ color: '#838383' }}>
            Minimum 15 minutes, maximum a week — the scheduler polls the recipe on this cycle.
          </p>
        </>
      )}

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
