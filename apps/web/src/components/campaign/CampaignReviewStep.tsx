'use client';

import type { CampaignWeight } from '@sparksocial/shared';
import { PANEL_CLIP, Spinner, StepPanel, TickPath } from './campaignChrome';
import { DURATIONS, WEIGHT_STOPS } from './campaignDraft';

/**
 * `Step 6 — Review & Activate`. The one step with no agent orb over it, which
 * is why its panel has no notch.
 *
 *   panel     226,156 · 596×633 on `--ss-grad-cmp-review` — cyan → pink →
 *             cream → white, the only coloured panel in the flow
 *   summary   31,98 · 523×177 r20 white; a black 146×163.557 r18.481 avatar
 *             tile at 37,104.721 and five label/value rows on a 28px pitch
 *   status    399,290 · "Agent Status" chip + a 11.894 green dot + "Active"
 *   rows      31,339 · 524×41 r10 on a 55.5 pitch, hairline ring, 14px spinner
 *   approve   31,546.5 · 20² r4.878, filling with `--ss-grad-cmp-tick`
 *   activate  381,805 · 273.302×52 r10.228 on #0C0C0C
 *
 * The four "here's what I'll do" rows are the design's, and each is true of
 * what activation actually starts: `calendar.generate` places the posts,
 * the mix engine blends them with baseline, posting windows are optimised, and
 * the CTA cadence follows the campaign's weight.
 */

const ROW_Y = [339, 394.5, 450, 505.5];

export function ReviewStep({
  agentName,
  brandLogo,
  goalLabel,
  typeLabel,
  windowDays,
  weight,
  ctaUrl,
  requireApproval,
  onRequireApproval,
  onActivate,
  busy,
}: {
  agentName: string;
  brandLogo?: string;
  goalLabel: string;
  typeLabel: string;
  windowDays: number;
  weight: CampaignWeight;
  ctaUrl: string;
  requireApproval: boolean;
  onRequireApproval: () => void;
  onActivate: () => void;
  busy: boolean;
}) {
  const duration = DURATIONS.find((d) => d.days === windowDays)?.label ?? `${windowDays} Days`;
  const weightLabel = WEIGHT_STOPS.find((w) => w.value === weight)?.label ?? weight;

  const rows: Array<[string, React.ReactNode]> = [
    ['Goal -', goalLabel],
    ['Type -', typeLabel],
    ['Duration -', duration],
    ['Weight -', weightLabel],
    [
      'Primary CTA -',
      ctaUrl ? (
        <a href={ctaUrl} target="_blank" rel="noreferrer" className="text-link-blue underline">
          Visit Opt-in page
        </a>
      ) : (
        <span style={{ color: 'rgb(131,131,131)' }}>None set</span>
      ),
    ],
  ];

  const WILL_DO = [
    'Create campaign-focused posts across selected channels',
    'Blend campaign content with baseline growth posts',
    'Optimize posting times based on performance',
    'Adjust CTA frequency to maximize leads',
  ];

  return (
    <>
      <StepPanel x={226} y={156} w={596} h={633} clip={PANEL_CLIP.s6} wash="bg-cmp-review">
        <h2 className="absolute left-[31px] top-[19px] whitespace-nowrap text-[25px] font-semibold leading-[1.43] text-black">
          Review &amp; Activate
        </h2>
        <p className="absolute left-[31px] top-[57px] whitespace-nowrap text-[18px] font-normal leading-[0.9987]" style={{ color: 'rgb(131,131,131)' }}>
          Here&rsquo;s what <span className="font-bold text-purple">{agentName}</span> will do with this focus
        </p>

        {/* ── summary card ────────────────────────────────────────────── */}
        <div className="absolute left-[31px] top-[98px] h-[177px] w-[523px] rounded-xl bg-white" />
        <div className="absolute left-[37px] top-[104.721px] h-[163.557px] w-[489px]">
          <div className="absolute left-0 top-0 h-[163.557px] w-[146px] rounded-[18.481px] bg-black" />
          <div
            className="absolute left-[20px] top-[14.279px] h-[103px] w-[103px] rounded-full bg-surface-200 bg-cover bg-center"
            style={{ backgroundImage: brandLogo ? `url('${brandLogo}')` : undefined }}
          />
          <span className="absolute left-0 top-[129.279px] block w-[146px] text-center text-[16px] font-semibold leading-[0.9986]" style={{ color: 'rgb(131,131,131)' }}>
            {agentName}
          </span>

          {rows.map(([label, value], i) => (
            <div key={label}>
              <span className="absolute left-[180px] whitespace-nowrap text-[16px] font-normal leading-[0.9986]" style={{ top: 18.279 + i * 28, color: 'rgb(131,131,131)' }}>
                {label}
              </span>
              <span className="absolute right-0 whitespace-nowrap text-right text-[14px] font-semibold leading-[1.273] text-ink" style={{ top: 18.279 + i * 28 }}>
                {value}
              </span>
            </div>
          ))}
        </div>

        <span className="absolute left-[32px] top-[292px] whitespace-nowrap text-[18px] font-semibold leading-none text-ink">
          Here&rsquo;s what I&rsquo;ll do
        </span>

        <div className="absolute left-[399px] top-[290px] h-[27.532px] w-[155px]">
          <span className="absolute left-0 top-0 block h-[27.532px] w-[89px] rounded-[5.809px]" style={{ background: 'rgba(0,0,0,0.07)', backdropFilter: 'blur(18.731px)' }} />
          <span className="absolute left-[8.258px] top-[6.045px] whitespace-nowrap text-[11.525px] font-normal leading-none" style={{ color: 'rgba(0,0,0,0.6)' }}>
            Agent Status
          </span>
          <span className="absolute left-[98px] top-[7.771px] inline-block h-[11.894px] w-[11.894px] rounded-full" style={{ background: 'rgb(19,215,17)' }} />
          <span className="absolute left-[114px] top-[4.287px] whitespace-nowrap text-[14px] font-normal leading-none" style={{ color: 'rgba(0,0,0,0.6)' }}>
            Active
          </span>
        </div>

        {WILL_DO.map((t, i) => (
          <div
            key={t}
            className="absolute left-[31px] h-[41px] w-[524px] rounded"
            style={{ top: ROW_Y[i], boxShadow: 'inset 0 0 0 1.276px rgba(12,12,12,0.1)' }}
          >
            <Spinner className="absolute left-[12px] top-[13px]" spin={false} />
            <span className="absolute left-[34px] top-[11px] whitespace-nowrap text-[16px] font-normal leading-none" style={{ color: 'rgb(131,131,131)' }}>
              {t}
            </span>
          </div>
        ))}

        <button
          type="button"
          role="checkbox"
          aria-checked={requireApproval}
          onClick={onRequireApproval}
          className="absolute left-[31px] top-[546.5px] h-[20px] w-[20px] cursor-pointer rounded-[4.878px]"
          style={{
            boxShadow: 'inset 0 0 0 1.5px rgba(12,12,12,0.2)',
            background: requireApproval ? 'var(--ss-grad-cmp-tick)' : 'transparent',
          }}
          aria-label="Require approval for campaign posts"
        >
          {requireApproval ? <TickPath className="absolute left-[5px] top-[5px] block" /> : null}
        </button>
        <span className="absolute left-[57px] top-[547px] block w-[390px] text-[16px] font-normal leading-none" style={{ color: 'rgb(131,131,131)' }}>
          Require approval for campaign posts. Baseline posts will continue automatically.
        </span>
      </StepPanel>

      <button
        type="button"
        onClick={onActivate}
        disabled={busy}
        className="absolute left-[381px] top-[805px] h-[52px] w-[273.302px] cursor-pointer rounded-[10.228px] bg-ink text-left transition-colors hover:bg-ink-800 active:scale-[0.99] disabled:opacity-60"
        style={{ backdropFilter: 'blur(32.586px)' }}
      >
        <span className="absolute left-[21.558px] top-[13.021px] whitespace-nowrap text-[19.349px] font-medium leading-[1.269] text-white">
          {busy ? 'Activating…' : 'Activate Campaign'}
        </span>
        <svg width="7.256" height="14.512" viewBox="0 0 9 17" fill="none" className="absolute left-[245.488px] top-[19.348px]" aria-hidden>
          <path d="M1 1l7 7.5L1 16" stroke="rgb(255,255,255)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </>
  );
}
