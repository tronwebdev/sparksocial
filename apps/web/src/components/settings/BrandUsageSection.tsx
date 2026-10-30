'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';
import { SparkLoader } from '@/components/brand/SparkLoader';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { toolLabel } from '@sparksocial/shared/toolLabel';

/**
 * Credit & Usage for one brand — `Settings WS Credit Usage.dc.html`.
 *
 * The design is a workspace screen, and a workspace is a brand. It was built
 * first against `org.usage.get`, which put the organisation's balance under
 * whichever brand was selected, and then moved to the organisation for that
 * reason. This is the screen the design actually draws: what *this* brand
 * spent, on what, and against what limit — `brand.usage.get`, which groups
 * `credit_ledger` by `brand_id`.
 *
 * Same geometry as `CreditUsageSection` (the 386x214 balance card, the 680-wide
 * breakdown, the 360 rail), so the two read as the same screen at two scopes.
 *
 * Two things differ, because the data does:
 *
 *  - **The limit is optional.** Most brands have none and are bounded only by
 *    the organisation. Then the card says so and the bar shows this brand's
 *    share of what the organisation spent, rather than inventing a cap.
 *  - **The balance is not the brand's.** The rail names what the organisation
 *    has left — the pool this brand draws on — and links to where it is
 *    topped up, rather than offering a purchase from a brand screen.
 */

interface BrandUsage {
  brandId: string;
  periodStart: string;
  spentCredits: number;
  capCredits: number | null;
  remainingCredits: number | null;
  usedFraction: number | null;
  orgRemainingCredits: number;
  shareOfOrg: number;
  byCategory: Array<{ category: string; label: string; credits: number; calls: number; share: number; unavailable: boolean }>;
  byTool: Array<{ tool: string; credits: number; calls: number; share: number }>;
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);

const MUTED = 'rgb(131,131,131)';
const CARD = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.15)' };

export function BrandUsageSection() {
  const { genome, error: genomeError } = useSelectedGenome();
  const [usage, setUsage] = useState<BrandUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!genome) return;
    let cancelled = false;
    void (async () => {
      const res = await invoke<BrandUsage>('brand.usage.get', { brandId: genome.brandId });
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setError(
          res.status === 'failed'
            ? userMessage(res.error)
            : 'Credit usage is visible to the organisation’s owners and admins.',
        );
        return;
      }
      setUsage(res.output);
    })();
    return () => {
      cancelled = true;
    };
  }, [genome]);

  if (genomeError) return <p className="text-16 text-destructive">{genomeError}</p>;
  if (error) {
    return (
      <p className="max-w-[62ch] text-16" style={{ color: MUTED }}>
        {error}
      </p>
    );
  }
  if (!usage) return <SparkLoader size="panel" label="Reading this month’s usage…" />;

  const resetsIn = (() => {
    const start = new Date(usage.periodStart);
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return Math.max(0, Math.ceil((next.getTime() - Date.now()) / 86_400_000));
  })();

  const cap = usage.capCredits;
  const barFraction = cap !== null ? (usage.usedFraction ?? 0) : usage.shareOfOrg;
  const used = usage.byCategory.filter((c) => c.credits > 0);
  const brandName = genome?.name ?? 'This brand';

  return (
    // The rail sits beside the column whenever both fit (380 + 26 + 360) and
    // wraps under it when they do not — not below a fixed card width, which at
    // 1440 stacked it and left half the card empty.
    <div className="flex flex-wrap gap-[26px]">
      <div className="min-w-[380px] flex-1 space-y-[26px] max-sm:min-w-0 max-sm:basis-full">
        {/* ── balance ────────────────────────────────────────────────── */}
        <div
          className="min-h-[214px] w-[386px] max-w-full rounded-[13.364px] p-[28px]"
          style={{ background: 'var(--ss-ink-900)' }}
        >
          <p className="truncate text-16 font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {brandName} · this month
          </p>

          <p className="mt-[8px] flex flex-wrap items-baseline gap-[9px]">
            <span className="text-48 font-bold leading-[1.28] text-white">{usage.spentCredits.toLocaleString()}</span>
            <span className="text-16 font-normal" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {cap !== null ? `/ ${cap.toLocaleString()} credits` : 'credits spent'}
            </span>
          </p>

          <p className="mt-[10px] text-16 font-normal" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {cap !== null
              ? `${(usage.remainingCredits ?? 0).toLocaleString()} left under this brand’s limit`
              : `${Math.round(usage.shareOfOrg * 100)}% of the organisation’s spend`}{' '}
            · resets in {resetsIn} {resetsIn === 1 ? 'day' : 'days'}
          </p>

          <div
            className="mt-[15px] h-[23px] w-full overflow-hidden rounded-[16.843px]"
            style={{ background: 'rgba(255,255,255,0.2)' }}
            role="progressbar"
            aria-valuenow={Math.round(barFraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={cap !== null ? 'Share of this brand’s limit used' : 'Share of the organisation’s spend'}
          >
            <span
              className="block h-[21px] rounded-[24.137px] transition-[width] duration-500"
              style={{
                marginTop: 1,
                marginLeft: 1,
                width: `calc(${Math.min(100, barFraction * 100)}% - 2px)`,
                background: 'linear-gradient(90deg, #6CE8FF 0%, #F56BFF 100%)',
              }}
            />
          </div>
        </div>

        {/* ── allocation breakdown ───────────────────────────────────── */}
        <div className="w-[680px] max-w-full rounded-[13.364px] bg-white p-[24px]" style={CARD}>
          <p className="text-20 font-semibold text-ink">Allocation breakdown</p>
          {used.length === 0 ? (
            <p className="mt-[14px] text-16" style={{ color: MUTED }}>
              {brandName} has not spent any credits this month.
            </p>
          ) : (
            <ul className="mt-[21px] grid grid-cols-1 gap-[21px]">
              {used.map((c) => (
                <li key={c.category}>
                  <div className="flex flex-wrap items-baseline justify-between gap-[12px]">
                    <span className="text-16 font-medium text-ink">{c.label}</span>
                    <span className="text-16 font-medium" style={{ color: MUTED }}>
                      {compact(c.credits)} · {c.calls.toLocaleString()} {c.calls === 1 ? 'call' : 'calls'}
                    </span>
                  </div>
                  <div
                    className="mt-[15px] h-[18px] w-full overflow-hidden rounded-[16.843px]"
                    style={{ background: 'rgba(12,12,12,0.1)' }}
                  >
                    <span
                      className="block h-[17px] rounded-[24.137px] transition-[width] duration-500"
                      style={{
                        marginTop: 0.5,
                        marginLeft: 1,
                        width: `calc(${Math.min(100, c.share * 100)}% - 2px)`,
                        background: 'rgb(72,223,251)',
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {usage.byTool.length > 0 ? (
          <div className="w-[680px] max-w-full rounded-[13.364px] bg-white p-[24px]" style={CARD}>
            <p className="text-20 font-semibold text-ink">Where it went</p>
            <ul className="mt-[16px] grid grid-cols-1 gap-[10px]">
              {usage.byTool.slice(0, 8).map((t) => (
                <li key={t.tool} className="flex flex-wrap items-baseline justify-between gap-[12px] text-16">
                  <span className="font-medium text-ink">{toolLabel(t.tool)}</span>
                  <span style={{ color: MUTED }}>
                    {t.credits.toLocaleString()} credits · {Math.round(t.share * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* ── the rail: the limit, and the pool it draws on ─────────────── */}
      <aside className="w-[360px] max-w-full shrink-0 space-y-[18px] max-sm:w-full">
        <div className="rounded-[13.364px] bg-white p-[22px]" style={CARD}>
          <p className="text-18 font-medium text-ink">Brand limit</p>
          <p className="mt-[10px] text-16 leading-[1.45]" style={{ color: MUTED }}>
            {cap !== null ? (
              <>
                This brand stops spending at <span className="font-semibold text-ink">{cap.toLocaleString()}</span>{' '}
                credits a month — drafting, rendering and publishing pause until the month turns or the limit is
                raised.
              </>
            ) : (
              'No limit of its own. This brand can spend anything the organisation has left.'
            )}
          </p>
          <Link
            href="/organization/brands"
            className="mt-[12px] inline-block text-15 font-medium text-ink underline underline-offset-2"
          >
            {cap !== null ? 'Change the limit' : 'Set a limit'}
          </Link>
        </div>

        <div className="rounded-[13.364px] bg-white p-[22px]" style={CARD}>
          <p className="text-18 font-medium text-ink">The organisation&rsquo;s balance</p>
          <p className="mt-[10px] text-16 leading-[1.45]" style={{ color: MUTED }}>
            <span className="font-semibold text-ink">{usage.orgRemainingCredits.toLocaleString()}</span> credits left
            this month, shared by every brand in the account.
          </p>
          <Link
            href="/organization/billing"
            className="mt-[12px] inline-block text-15 font-medium text-ink underline underline-offset-2"
          >
            Billing &amp; Credits
          </Link>
        </div>
      </aside>
    </div>
  );
}
