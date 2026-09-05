'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ModalShell } from '@/components/common/ModalShell';
import { invoke } from '@/lib/tools';
import { compactVolume, saturationWord, sourceLabel, type RankedTrendItem } from './TrendCard';

/**
 * Re-purpose — `SparkSocial Discovery.dc.html`, the modal the card's Re-purpose
 * button opens. `346,60 · 1035x900`, radius 24, on the
 * `160deg #FDFBFF → #F4F7FD` gradient (`ModalShell`).
 *
 *   title          38,34    28px/700 "Re-purpose"
 *   assistant      38,88    a 30px outlined orb + 18px/500 line
 *   hairline       top 140  full width, `rgba(131,131,131,.18)`
 *   topic          40,166   20px/700; velocity chip right 56 / top 158, h36 r9
 *   "Media Preview" 40,206  15px/500 `#838383`
 *   media          40,236   236x300 r14, cover, 40px play badge centred
 *   stat pills     308,236  h38 r9, gap 11, 14.5px/600
 *   hook cards     308,296 and 308,426 — 660x110 r14 white, a 15px/700
 *                  `#A341FF` label over 17px/600 copy
 *   related chips  40,614   h40 r9 in a `rgba(131,131,131,.28)` ring
 *   recommendation 40,726   930x76 r14 on `#FBE6FA` in a
 *                  `rgba(245,107,255,.4)` ring — kind · expected · detail
 *   Generate Draft right 56 / top 824, h52 r12, the
 *                  `90deg #C46BF5 → #8F7BFF → #6CD5FF` gradient
 *
 * ── The four things the prototype asserts, against the tools ─────────────
 *
 * **The suggestion is real.** `trend.repurpose` returns a playbook, its pillar
 * and an intent sentence, or null with a `why` when nothing fits. That is the
 * Recommendation strip: playbook name, pillar, intent. What it cannot say is
 * "Expected +59% ER" — no tool predicts engagement for an unwritten post, and
 * the strip shows the pillar and whether the playbook is unlocked instead of a
 * number no model produced.
 *
 * **The hooks are real, and they bill.** `trend.hooks` writes them with a
 * language model and declares `estimateCents`, so they are behind a button
 * rather than fetched on open — a modal that silently spends money because it
 * was opened is the wrong default. `idempotent: false` there is deliberate:
 * pressing it again asks for different angles.
 *
 * **Related Topics & Entities is `trend.tags`** — the descriptors the source
 * returned, which are also what `relevanceFor` matched the genome against. The
 * chips were prototype text; these are the actual inputs to the score.
 *
 * **Generate Draft is `content.draft`**, with `fromTrendId` set — the field
 * that exists so PRD §5's trend-to-post conversion rate is a count rather than
 * a guess. It hands off to the Draft Panel exactly as the prototype's button
 * navigates to `SparkSocial Draft Panel.dc.html`.
 */

interface RepurposeSuggestion {
  playbookId: string;
  playbookName: string;
  pillar: string;
  intent: string;
  unlockable: boolean;
  missingRoles: string[];
}

export function RepurposeModal({
  trend,
  genomeId,
  onClose,
  onOpenDraft,
}: {
  trend: RankedTrendItem;
  genomeId: string;
  onClose: () => void;
  /** Hands the new draft to the Draft Panel, the way the design's button does. */
  onOpenDraft: (contentItemId: string) => void;
}) {
  const [suggestion, setSuggestion] = useState<RepurposeSuggestion | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hooks, setHooks] = useState<string[] | null>(null);
  const [hooksBusy, setHooksBusy] = useState(false);
  const [hooksError, setHooksError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await invoke<{ suggestion: RepurposeSuggestion | null; why: { summary: string } }>(
      'trend.repurpose',
      { genomeId, trendId: trend.trendId },
    );
    setLoading(false);
    if (res.status !== 'succeeded') {
      setWhy(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setSuggestion(res.output.suggestion);
    setWhy(res.output.why.summary);
  }, [genomeId, trend.trendId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    The design draws two hook ideas already sitting under Recommendations, so
    they are fetched on open rather than behind a button.

    `trend.hooks` bills — one cent per hook (`estimateCents` in
    `packages/trends/src/hooks.ts`) — so that is two cents to open a modal
    somebody opened deliberately, once per open. The ref is what stops React's
    double-invoked effect in development from making it four. "New angles"
    spends two more, which is the whole point of a tool that is deliberately
    not idempotent.
  */
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void writeHooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function writeHooks() {
    if (hooksBusy) return;
    setHooksBusy(true);
    setHooksError(null);
    /* A fresh key per press: `trend.hooks` is `idempotent: false` *because*
       pressing it again should return different angles, and `invoke` refuses
       such a call without one — see `lib/tools.ts`. */
    const res = await invoke<{ hooks: string[] }>(
      'trend.hooks',
      { genomeId, trendId: trend.trendId, count: 2 },
      crypto.randomUUID(),
    );
    setHooksBusy(false);
    if (res.status !== 'succeeded') {
      setHooksError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setHooks(res.output.hooks);
  }

  async function generateDraft() {
    if (!suggestion || drafting) return;
    setDrafting(true);
    setDraftError(null);
    const res = await invoke<{ contentItemId: string }>(
      'content.draft',
      {
        genomeId,
        playbookId: suggestion.playbookId,
        intent: hooks?.[0] ? `${suggestion.intent} Hook: ${hooks[0]}` : suggestion.intent,
        fromTrendId: trend.trendId,
      },
      /* One press, one draft — the same fresh key every other Generate
         button in this app mints. */
      crypto.randomUUID(),
    );
    setDrafting(false);
    if (res.status !== 'succeeded') {
      setDraftError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    onOpenDraft(res.output.contentItemId);
  }

  const velocityPct = Math.round(trend.metrics.velocity * 100);
  const growthPct = Math.round(trend.metrics.growth * 100);
  const measuredGrowth = trend.metrics.growth !== 0;

  return (
    <ModalShell
      top={90}
      height={700}
      width={880}
      radius={20}
      label="Re-purpose this trend"
      gradientTo="#F4F7FD"
      onClose={onClose}
    >
      {/* The header is a chip, not a heading — the design labels the modal the
          way the trend card labels its actions. */}
      <div className="flex items-center gap-[11px] px-[24px] pt-[22px]">
        <span
          className="flex h-[36px] items-center gap-[8px] rounded-[10px] px-[13px] text-[15px] font-semibold text-ink"
          style={{ background: 'rgba(131,131,131,0.10)' }}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 1.4 9.5 6 14 7.5 9.5 9 8 13.6 6.5 9 2 7.5 6.5 6 8 1.4Z" fill="#A46CF0" />
          </svg>
          Re-purpose
        </span>
        <span
          aria-hidden
          title={why ?? undefined}
          className="flex h-[17px] w-[17px] items-center justify-center rounded-full text-[11px] font-bold"
          style={{ color: '#9A9A9A', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.5)' }}
        >
          i
        </span>
      </div>

      <div className="mt-[16px] flex min-h-0 flex-1 overflow-hidden max-lg:flex-col">
        {/* ── left: what the trend is ─────────────────────────────────── */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-white px-[24px] py-[18px]">
          <div className="flex items-center justify-between">
            <p className="text-15 font-medium text-ink-muted">Media Preview</p>
            <span className="text-[13px] font-semibold" style={{ color: '#838383' }}>
              {sourceLabel(trend.source)}
            </span>
          </div>

          {/* A 16:10 frame with the design's play badge. A trend with no media
              says so rather than drawing an empty grey box that reads as broken. */}
          <div
            className="relative mt-[14px] aspect-[16/10] w-full overflow-hidden rounded-[12px]"
            style={{ background: '#EFEFEF' }}
          >
            {trend.media ? (
              <>
                <img src={trend.media.url} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                {trend.media.kind === 'video' ? (
                  <span className="absolute left-1/2 top-1/2 flex h-[46px] w-[46px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/85">
                    <svg width="14" height="16" viewBox="0 0 9 10" fill="none" aria-hidden>
                      <path d="M8.2 3.5c1 .5 1 2 0 2.5L2.2 9.3C1.2 9.8 0 9.1 0 8V1.4C0 .3 1.2-.3 2.2.2l6 3.3Z" fill="#0C0C0C" />
                    </svg>
                  </span>
                ) : null}
              </>
            ) : (
              <span className="flex h-full w-full items-center justify-center text-14 text-ink-muted">
                No media on this trend
              </span>
            )}
          </div>

          <p className="mt-[12px] text-[17px] font-semibold text-ink">{trend.topic}</p>

          <div className="mt-[16px] flex flex-wrap items-center gap-[12px] text-[13.5px] font-medium">
            <Metric label="Velocity" value={`+${velocityPct}%`} tone="#1E8C42" />
            <Metric label="Vol" value={compactVolume(trend.metrics.volume)} tone="#2F8291" />
            {measuredGrowth ? <Metric label="7d" value={`+${growthPct}%`} tone="#1E8C42" /> : null}
            {/* The design's "Accel ↑". There is no acceleration field on a
                ranked trend — `metrics` carries volume, velocity, saturation
                and 7-day growth — so the arrow is drawn from the growth figure
                that exists rather than from one invented for the glyph. */}
            {measuredGrowth ? (
              <Metric label="Accel" value={trend.metrics.growth >= 0 ? '↑' : '↓'} tone="#0C0C0C" />
            ) : null}
            <Metric label="Saturation" value={saturationWord(trend.metrics.saturation)} tone="#B4762A" />
          </div>

          <p className="mt-[20px] text-15 font-medium text-ink-muted">Recommendations</p>
          <div className="mt-[10px] flex flex-col gap-[10px]">
            {hooksBusy && !hooks ? (
              <p className="text-14 text-ink-muted">Writing hook ideas…</p>
            ) : hooksError ? (
              <p className="text-14 text-destructive">{hooksError}</p>
            ) : (
              (hooks ?? []).map((h, i) => (
                <div
                  key={h}
                  className="rounded-[10px] bg-white px-[14px] py-[10px]"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.22)' }}
                >
                  <p className="text-[11.5px]" style={{ color: '#9A9A9A' }}>
                    Hook Idea {i + 1}
                  </p>
                  <p className="mt-[2px] text-[15px] font-medium text-ink">&ldquo;{h}&rdquo;</p>
                </div>
              ))
            )}
            {hooks && hooks.length > 0 ? (
              <button
                type="button"
                onClick={() => void writeHooks()}
                disabled={hooksBusy}
                className="self-start text-[12.5px] font-semibold transition-opacity hover:opacity-70 disabled:opacity-50"
                style={{ color: '#2F8291' }}
              >
                {hooksBusy ? 'Writing…' : 'New angles (2 credits)'}
              </button>
            ) : null}
          </div>

          {trend.tags.length > 0 ? (
            <>
              <p className="mt-[20px] text-15 font-medium text-ink-muted">Related Topics &amp; Entities</p>
              <div className="mt-[10px] flex flex-wrap gap-[8px]">
                {trend.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-[7px] px-[10px] py-[5px] text-[13px] font-medium text-ink"
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' }}
                  >
                    {t.startsWith('#') ? t : `#${t}`}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* ── right: what SPARK will do about it ──────────────────────── */}
        <div
          className="flex w-[320px] shrink-0 flex-col items-center justify-center px-[24px] py-[26px] max-lg:w-full"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(226,238,255,0.55) 100%)' }}
        >
          <span
            aria-hidden
            className="mb-[22px] block h-[64px] w-[64px] shrink-0 rounded-full"
            style={{
              background: 'radial-gradient(circle at 50% 40%, #E6D9FF 0%, #BFD7FF 55%, #A9CBFF 100%)',
              boxShadow: '0 10px 30px -12px rgba(120,120,255,0.55)',
            }}
          />

          <div
            className="relative w-full rounded-[14px] bg-white px-[18px] py-[14px] text-center"
            style={{ boxShadow: '0 14px 34px -22px rgba(12,12,12,0.4)' }}
          >
            <p className="text-[15px] leading-[1.45] text-ink">
              <span style={{ color: '#A46CF0' }}>Hey,</span> I&rsquo;m going to create a new post based on
              this trend.
            </p>
          </div>

          {/* What the tool actually found. The design has no room for it and it
              is the difference between a button that works and one that fails
              on press: `trend.repurpose` returns null when no playbook fits. */}
          <p className="mt-[14px] text-center text-[12.5px] leading-[1.45] text-ink-muted">
            {loading
              ? 'Checking which playbook fits…'
              : suggestion
                ? `${suggestion.playbookName} · ${suggestion.pillar.replace(/_/g, ' ')}`
                : (why ?? 'Nothing in this brand fits this trend.')}
          </p>

          <button
            type="button"
            onClick={() => void generateDraft()}
            disabled={!suggestion || drafting}
            className="mt-[18px] flex h-[48px] items-center gap-[10px] rounded-[12px] bg-white px-[22px] text-[15.5px] font-semibold text-ink transition-transform hover:scale-[1.02] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ boxShadow: '0 0 0 1.6px rgba(164,108,240,0.55), 0 16px 36px -20px rgba(12,12,12,0.5)' }}
          >
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 1v12M1 7h12" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {drafting ? 'Generating…' : 'Generate Draft'}
          </button>

          {draftError ? <p className="mt-[12px] text-center text-14 text-destructive">{draftError}</p> : null}
          {!loading && !suggestion ? (
            <p className="mt-[10px] text-center text-[12px] text-ink-muted">
              Add the assets it is missing, or pick a different trend.
            </p>
          ) : null}
        </div>
      </div>
    </ModalShell>
  );
}

/** One figure from the trend's metric strip. */
function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className="whitespace-nowrap">
      <span style={{ color: '#5B5B5B' }}>{label}: </span>
      <span style={{ color: tone }} className="font-semibold">
        {value}
      </span>
    </span>
  );
}
