'use client';

import { useEffect, useState } from 'react';
import { RecipeGlyph } from './RecipeGlyph';
import { KIND_META, type RecipeKind } from './recipeMeta';
import type { WizardDraft } from './RecipeWizard';

/**
 * "Congratulations On Successfully Launching Your Campaign" — the design's
 * `atReview` modal, drawn at 430,28 · 870x902 r24 over a `rgba(40,40,40,.45)`
 * scrim, entering on `ss-modal-in 0.25s cubic-bezier(.22,1,.36,1)`.
 *
 *   stickers   four rotated cards at the corners (-26,36 / right -24,34 /
 *              -22,742 / a 🎉 at right -14,748)
 *   title      44, centred, 27/700
 *   summary    76,156 · 718x228 r16 on `--ss-grad-auto-launch`, its kind badge
 *              hanging at top -17
 *   rows       "Here's what I'll do" at 410, five 718x54 r14 rows from 450 on a
 *              66 pitch
 *   approval   96,786 — a 22px box and a 500-wide line
 *   activate   277,846 · 316x56 r14 on `#0C0C0C`
 *
 * ── It reports, it does not decide ────────────────────────────────────────
 *
 * In the prototype this modal is where the recipe is created: `atActivate`
 * bumps a counter. Here the recipe is already created by the time the modal
 * opens — the wizard's "Launch Automation" is the write, because a modal that
 * says "Congratulations" before anything has been saved is a lie whenever the
 * call fails. So this confirms what was just written and offers the one
 * remaining choice: whether its output waits for approval.
 */

const LAUNCH_ROWS: Record<RecipeKind, readonly string[]> = {
  auto_trend: [
    'Scan the trend sources on the cycle you set',
    'Score what it finds against this brand and its keywords',
    'Draft on-brand posts from the strongest topics',
    'Route each one to the output queue',
  ],
  bulk_connector: [
    'Read the source on the cycle you set',
    'Turn each row into a draft post',
    'Skip anything it cannot read, and say so in the queue',
    'Route each one to the output queue',
  ],
  rss: [
    'Poll the feed on the cycle you set',
    'Turn new items into drafts with your CTA',
    'Skip items it has already posted',
    'Route each one to the output queue',
  ],
};

export function LaunchModal({
  draft,
  requireApproval,
  onRequireApproval,
  onDone,
  onClose,
  busy,
}: {
  draft: WizardDraft;
  requireApproval: boolean;
  onRequireApproval: (next: boolean) => void;
  onDone: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const meta = KIND_META[draft.kind];
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto px-4 py-[28px]" role="dialog" aria-modal="true" aria-label="Campaign launched">
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 cursor-default animate-fade-in bg-[rgba(40,40,40,0.45)] motion-reduce:animate-none" />

      <div
        className={`relative w-[870px] max-w-full rounded-[24px] bg-white pb-[36px] ${mounted ? 'animate-modal-in motion-reduce:animate-none' : ''}`}
        style={{ boxShadow: '0 60px 140px -40px rgba(0,0,0,0.5)' }}
      >
        {/* The four corner stickers. Decoration, so they go under `lg` where
            they would sit on top of the content rather than beside it. */}
        <span aria-hidden className="absolute -left-[26px] top-[36px] hidden h-[60px] w-[62px] rotate-[-8deg] items-center justify-center rounded-[10px] bg-white lg:flex" style={{ boxShadow: '0 10px 24px -12px rgba(12,12,12,0.3)' }}>
          <svg width="38" height="34" viewBox="0 0 38 34" fill="none" className="rotate-[-18deg]">
            <path d="M31 4 8 15l9 3 2 10 5-8 9-2L31 4Z" fill="#F98BD9" />
            <path d="M31 4 17 18" stroke="#E560BE" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span aria-hidden className="absolute -right-[24px] top-[34px] hidden h-[58px] w-[60px] rotate-[9deg] items-center justify-center rounded-[10px] bg-white lg:flex" style={{ boxShadow: '0 10px 24px -12px rgba(12,12,12,0.3)' }}>
          <span className="flex h-[36px] w-[38px] items-center justify-center rounded-[10px]" style={{ background: 'linear-gradient(135deg,#8F7BFF 0%,#C46BF5 100%)' }}>
            <svg width="18" height="18" viewBox="0 0 20 19" fill="none">
              <path d="M10 0.8 11.9 6.4 17.6 8.3 11.9 10.2 10 15.8 8.1 10.2 2.4 8.3 8.1 6.4Z" fill="#FFFFFF" />
            </svg>
          </span>
        </span>

        <p className="px-[40px] pt-[44px] text-center text-[27px] font-bold leading-[1.35] text-ink">
          🎉 Congratulations On Successfully
          <br />
          Launching Your Campaign!
        </p>

        {/* ── summary ────────────────────────────────────────────────────── */}
        <div className="relative mx-[76px] mt-[46px] rounded-[16px] px-[28px] pb-[24px] pt-[42px] max-md:mx-[24px]" style={{ background: 'var(--ss-grad-auto-launch)' }}>
          <span
            className="absolute left-[28px] top-[-17px] inline-flex h-[34px] items-center gap-[8px] rounded-[8px] px-[12px]"
            style={{ background: '#C9F1FD', boxShadow: '0 4px 12px -6px rgba(11,170,199,0.5)' }}
          >
            <span aria-hidden className="text-ink">
              <RecipeGlyph kind={draft.kind} size={15} />
            </span>
            <span className="whitespace-nowrap text-14 font-semibold text-ink">{meta.name}</span>
          </span>

          <p className="truncate text-[22px] font-bold text-ink" title={draft.name}>
            {draft.name}
          </p>
          <p className="mt-[16px] text-[15.5px] font-medium text-ink">
            <b className="font-bold">Runs:</b> every {draft.everyHours} hour{draft.everyHours === 1 ? '' : 's'}
            {draft.startToday ? ' · starting now' : ''}
          </p>
          <div className="mt-[14px] flex flex-wrap items-center gap-[10px]">
            <span className="inline-flex h-[30px] items-center rounded-[8px] bg-white px-[11px] text-[13.5px] font-semibold" style={{ boxShadow: 'inset 0 0 0 1.2px #8F8FF0', color: 'var(--ss-auto-scheduled)' }}>
              {draft.reviewFirst ? 'Waits for review' : 'Publishes on its own'}
            </span>
            {draft.kind === 'bulk_connector' ? (
              <span className="inline-flex h-[30px] items-center rounded-[8px] bg-white px-[11px] text-[13.5px] font-semibold text-ink" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}>
                {draft.bulkSource === 'csv' ? 'CSV Upload' : draft.bulkSource === 'canva' ? 'Canva' : 'Google Drive'}
              </span>
            ) : null}
          </div>
        </div>

        {/* ── what it will do ────────────────────────────────────────────── */}
        <div className="mt-[34px] flex items-center justify-between px-[76px] max-md:px-[24px]">
          <p className="text-[19px] font-bold text-ink">Here&rsquo;s what I&rsquo;ll do</p>
          <span className="flex items-center gap-[10px]">
            <span className="inline-flex h-[30px] items-center rounded-[7px] px-[11px] text-14 font-semibold" style={{ background: '#EFEFEF', color: '#5B5B5B' }}>
              Status
            </span>
            <span aria-hidden className="block h-[12px] w-[12px] rounded-full" style={{ background: 'var(--ss-green-500)' }} />
            <span className="text-16 font-medium text-ink">Active</span>
          </span>
        </div>

        <ul className="mt-[16px] flex flex-col gap-[12px] px-[76px] max-md:px-[24px]">
          {LAUNCH_ROWS[draft.kind].map((row) => (
            <li key={row} className="flex h-[54px] items-center gap-[14px] rounded-[14px] px-[22px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}>
              <svg width="17" height="17" viewBox="0 0 19 19" fill="none" aria-hidden className="shrink-0">
                <path d="M16.6 9.5a7.1 7.1 0 1 1-2.05-5M16.9 1.6v3.3h-3.3" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="truncate text-[16.5px] font-medium" style={{ color: '#3B3B3B' }}>
                {row}
              </span>
            </li>
          ))}
        </ul>

        <label className="mt-[30px] flex cursor-pointer items-start gap-[13px] px-[96px] max-md:px-[24px]">
          <input type="checkbox" checked={requireApproval} onChange={() => onRequireApproval(!requireApproval)} className="sr-only" />
          <span
            aria-hidden
            className="mt-[2px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] transition-colors"
            style={{ background: requireApproval ? '#0C0C0C' : '#FFFFFF', boxShadow: requireApproval ? 'none' : 'inset 0 0 0 1.4px rgba(12,12,12,0.35)' }}
          >
            {requireApproval ? (
              <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                <path d="m1 4.5 3 3L10 1" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </span>
          <span className="max-w-[500px] text-[16.5px] font-normal leading-[1.4]" style={{ color: '#5B5B5B' }}>
            Require approval for this recipe&rsquo;s posts. Your baseline posts carry on automatically.
          </span>
        </label>

        <div className="mt-[26px] flex justify-center">
          <button
            type="button"
            onClick={onDone}
            disabled={busy}
            className="flex h-[56px] w-[316px] max-w-full items-center justify-center gap-[16px] rounded-[14px] bg-ink transition-colors hover:bg-[#242424] active:scale-[0.985] disabled:opacity-60"
          >
            <span className="whitespace-nowrap text-18 font-semibold text-white">{busy ? 'Saving…' : 'Activate Campaign'}</span>
            <svg width="8" height="14" viewBox="0 0 8 16" fill="none" aria-hidden>
              <path d="m1 1 6 7-6 7" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Add New Recipe" — the design's `wizChooser`, a 1035x780 r24 panel on
 * `linear-gradient(160deg,#FDFBFF,#F4F7FD)` with three 923x170 r18 rows on a
 * 190 pitch from 158.
 *
 * The prototype's modal also carries its own copy of the wizard steps, but
 * nothing can reach it: picking a choice sets `wiz: null` and switches to the
 * full-page flow. So this is the chooser and only the chooser.
 */
export function RecipeChooserModal({ onPick, onClose }: { onPick: (kind: RecipeKind) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto px-4 py-[60px]" role="dialog" aria-modal="true" aria-label="Add a new recipe">
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 cursor-default animate-fade-in bg-[rgba(40,40,40,0.45)] motion-reduce:animate-none" />

      <div
        className="relative w-[1035px] max-w-full animate-modal-in rounded-[24px] pb-[40px] motion-reduce:animate-none"
        style={{ background: 'linear-gradient(160deg,#FDFBFF 0%,#F4F7FD 100%)', boxShadow: '0 60px 140px -40px rgba(0,0,0,0.45)' }}
      >
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-[26px] top-[26px] flex h-[34px] w-[34px] items-center justify-center transition-opacity hover:opacity-60">
          <svg width="18" height="18" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="m1.5 1.5 12 12m0-12-12 12" stroke="#9B9B9B" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        <p className="px-[38px] pt-[36px] text-[28px] font-bold text-ink">Add New Recipe</p>
        <p className="mt-[10px] px-[38px] text-18 font-normal" style={{ color: '#838383' }}>
          Pick a content engine to configure
        </p>
        <div className="mt-[22px] h-px w-full" style={{ background: 'rgba(131,131,131,0.18)' }} />

        <div className="mt-[34px] flex flex-col gap-[20px] px-[56px] max-md:px-[24px]">
          {(['auto_trend', 'bulk_connector', 'rss'] as const).map((kind) => {
            const meta = KIND_META[kind];
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onPick(kind)}
                className="relative h-[170px] w-full rounded-[18px] text-left transition-shadow hover:shadow-[inset_0_0_0_1.6px_rgba(131,131,131,0.45)]"
                style={{
                  background:
                    kind === 'auto_trend'
                      ? 'linear-gradient(120deg,#DFF7FD 0%,#FFFFFF 65%)'
                      : kind === 'bulk_connector'
                        ? 'linear-gradient(120deg,#FCEFDA 0%,#FFFFFF 65%)'
                        : 'linear-gradient(120deg,#EFDFFB 0%,#FFFFFF 65%)',
                  boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.15)',
                }}
              >
                <span aria-hidden className="absolute left-[30px] top-[42px] flex h-[58px] w-[58px] items-center justify-center rounded-[14px] text-white" style={{ background: meta.iconBg }}>
                  <RecipeGlyph kind={kind} size={30} />
                </span>
                <span className="absolute left-[114px] top-[38px] whitespace-nowrap text-[22px] font-bold text-ink">{meta.name}</span>
                <span className="absolute left-[114px] top-[78px] w-[740px] max-w-[calc(100%-160px)] text-16 font-normal leading-[1.4]" style={{ color: '#5B5B5B' }}>
                  {meta.desc}
                </span>
                <svg width="9" height="16" viewBox="0 0 8 16" fill="none" aria-hidden className="absolute right-[30px] top-[77px]">
                  <path d="m1 1 6 7-6 7" stroke="#838383" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
