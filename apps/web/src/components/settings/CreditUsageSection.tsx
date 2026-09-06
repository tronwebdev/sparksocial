'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';

/**
 * `Settings WS Credit Usage` — the 2662-tall screen, measured off the
 * prototype relative to its 1350 content card:
 *
 *   balance      30,120 · 386x214 r13.364 on `#0C0C0C`
 *                  "Allocated this month"  +29,+22  16/500 60% white
 *                  the number             +29,+56  49.231/700 white
 *                  "/ 25,000 credits"     +190,+82 16/400 60% white
 *                  the remaining line     +30,+129 16/400 60% white
 *                  bar                    +28,+172 330x23 r16.843 on 20% white,
 *                                         its fill r24.137 on the cyan ramp
 *   breakdown    30,364 · 680x321 r13.364 white
 *                  title +24,+17 20/600; each row 628x55 on a 76 pitch with a
 *                  627x18 r16.843 track on `rgba(12,12,12,0.1)` and a
 *                  `rgb(72,223,251)` fill, the "21.2K / 30K" right-aligned in
 *                  16/500 grey
 *
 * ── Every number here is real ─────────────────────────────────────────────
 *
 * `org.usage.get` returns the cap, what has been spent, what remains, the split
 * by category — which is the design's allocation breakdown — the per-tool
 * split, a straight-line forecast, and an `alert` band. It also returns a `why`,
 * which is rendered rather than dropped: CLAUDE.md invariant 4 makes an
 * explanation a schema obligation, and a spend screen is exactly where somebody
 * asks "why is it that much".
 *
 * The design's fixture categories (Render, Transcription, …) are not a fixed
 * list — the tool derives them from what was actually spent, so the rows are
 * whatever this organisation used.
 */

interface Category {
  category: string;
  label: string;
  costCents: number;
  credits: number;
  calls: number;
  share: number;
}

interface Usage {
  monthlyCapCredits: number;
  spentCredits: number;
  remainingCredits: number;
  byCategory: Category[];
  byTool: Array<{ tool: string; costCents: number; calls: number; share: number }>;
  forecastCredits?: number;
  forecastOverCap: boolean;
  usedFraction: number;
  alert: 'ok' | 'warning' | 'critical' | 'exhausted';
  periodStart: string;
  why: Explanation;
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);

const ALERT_TONE: Record<Usage['alert'], { label: string; colour: string }> = {
  ok: { label: 'Healthy', colour: 'var(--ss-green-700)' },
  warning: { label: 'Over half used', colour: 'var(--ss-amber-500)' },
  critical: { label: 'Nearly spent', colour: 'var(--ss-orange-500)' },
  exhausted: { label: 'Cap reached', colour: 'var(--ss-red-500)' },
};

export function CreditUsageSection() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await invoke<Usage>('org.usage.get', {});
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'Reading usage needs an approval.');
        return;
      }
      setUsage(res.output);
    })();
  }, []);

  if (error) return <p className="text-16 text-destructive">{error}</p>;
  if (!usage) return <p className="text-16" style={{ color: 'rgb(131,131,131)' }}>Reading this month&rsquo;s usage…</p>;

  const resetsIn = (() => {
    const start = new Date(usage.periodStart);
    const next = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate());
    return Math.max(0, Math.ceil((next.getTime() - Date.now()) / 86_400_000));
  })();

  const tone = ALERT_TONE[usage.alert];

  return (
    <div className="flex flex-wrap gap-[26px]">
      <div className="min-w-[380px] flex-1 space-y-[26px]">
        {/* ── balance ────────────────────────────────────────────────── */}
        <div className="h-[214px] w-[386px] max-w-full rounded-[13.364px] p-[28px]" style={{ background: 'var(--ss-ink-900)' }}>
          <p className="text-16 font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Allocated this month
          </p>

          <p className="mt-[8px] flex flex-wrap items-baseline gap-[9px]">
            <span className="text-[49.231px] font-bold leading-[1.28] text-white">
              {usage.spentCredits.toLocaleString()}
            </span>
            <span className="text-16 font-normal" style={{ color: 'rgba(255,255,255,0.6)' }}>
              / {usage.monthlyCapCredits.toLocaleString()} credits
            </span>
          </p>

          <p className="mt-[10px] text-16 font-normal" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {usage.remainingCredits.toLocaleString()} remaining · resets in {resetsIn}{' '}
            {resetsIn === 1 ? 'day' : 'days'}
          </p>

          <div
            className="mt-[15px] h-[23px] w-full overflow-hidden rounded-[16.843px]"
            style={{ background: 'rgba(255,255,255,0.2)' }}
            role="progressbar"
            aria-valuenow={Math.round(usage.usedFraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Credits used"
          >
            <span
              className="block h-[21px] rounded-[24.137px] transition-[width] duration-500"
              style={{
                marginTop: 1,
                marginLeft: 1,
                width: `calc(${Math.min(100, usage.usedFraction * 100)}% - 2px)`,
                background: 'linear-gradient(90deg, #6CE8FF 0%, #F56BFF 100%)',
              }}
            />
          </div>
        </div>

        {/* ── allocation breakdown ───────────────────────────────────── */}
        <div
          className="w-[680px] max-w-full rounded-[13.364px] bg-white p-[24px]"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.15)' }}
        >
          <p className="text-20 font-semibold text-ink">Allocation breakdown</p>

          {usage.byCategory.length === 0 ? (
            <p className="mt-[14px] text-16" style={{ color: 'rgb(131,131,131)' }}>
              Nothing has been spent this period yet.
            </p>
          ) : (
            <ul className="mt-[21px] grid grid-cols-1 gap-[21px]">
              {usage.byCategory.map((c) => (
                <li key={c.category}>
                  <div className="flex flex-wrap items-baseline justify-between gap-[12px]">
                    <span className="text-16 font-medium text-ink">{c.label}</span>
                    <span className="text-16 font-medium" style={{ color: 'rgb(131,131,131)' }}>
                      {compact(c.credits)} · {c.calls.toLocaleString()} {c.calls === 1 ? 'call' : 'calls'}
                    </span>
                  </div>
                  <div className="mt-[15px] h-[18px] w-full overflow-hidden rounded-[16.843px]" style={{ background: 'rgba(12,12,12,0.1)' }}>
                    <span
                      className="block h-[17px] rounded-[24.137px] transition-[width] duration-500"
                      style={{ marginTop: 0.5, marginLeft: 1, width: `calc(${Math.min(100, c.share * 100)}% - 2px)`, background: 'rgb(72,223,251)' }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── per-tool, which the design does not draw but the tool returns ── */}
        {usage.byTool.length > 0 ? (
          <div
            className="w-[680px] max-w-full rounded-[13.364px] bg-white p-[24px]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.15)' }}
          >
            <p className="text-20 font-semibold text-ink">Where it went</p>
            <ul className="mt-[16px] grid grid-cols-1 gap-[10px]">
              {usage.byTool.slice(0, 8).map((t) => (
                <li key={t.tool} className="flex flex-wrap items-baseline justify-between gap-[12px] text-16">
                  <span className="font-medium text-ink">{t.tool}</span>
                  <span style={{ color: 'rgb(131,131,131)' }}>
                    {(t.costCents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })} ·{' '}
                    {Math.round(t.share * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* ── the rail: forecast, alert band, and the engine's own reasoning ── */}
      <aside className="w-[360px] shrink-0 space-y-[18px] max-lg:w-full">
        <div className="rounded-[13.364px] bg-white p-[22px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.15)' }}>
          <p className="text-18 font-medium text-ink">This month</p>
          <p className="mt-[12px] flex items-center gap-[9px] text-16 font-semibold" style={{ color: tone.colour }}>
            <span aria-hidden className="block h-[10px] w-[10px] rounded-full" style={{ background: tone.colour }} />
            {tone.label}
          </p>
          {usage.forecastCredits !== undefined ? (
            <p className="mt-[12px] text-16 leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
              On this pace you will finish the month around{' '}
              <span className="font-semibold text-ink">{usage.forecastCredits.toLocaleString()}</span> credits
              {usage.forecastOverCap ? ' — above the cap.' : '.'}
            </p>
          ) : (
            <p className="mt-[12px] text-16 leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
              Too early in the period to project a total worth showing.
            </p>
          )}
        </div>

        <div className="rounded-[13.364px] bg-white p-[22px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.15)' }}>
          <div className="flex items-center justify-between gap-[10px]">
            <p className="text-18 font-medium text-ink">Why this number</p>
            <WhyPopover why={usage.why} />
          </div>
          <p className="mt-[10px] text-16 leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
            {usage.why.summary}
          </p>
        </div>
      </aside>
    </div>
  );
}
