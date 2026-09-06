'use client';

import type { ReactNode } from 'react';
import type { RosterBrand } from './useAgencyRoster';

/**
 * Portal Home's two states — `Portal Home` in the prototype, keyed off whether
 * the agency has been launched.
 *
 * ── Pre-launch ────────────────────────────────────────────────────────────
 *
 *   hero    42,118 · 1644x376 r22 on `--ss-grad-ag-hero`, shadow
 *           `0 20px 50px -42px rgba(12,12,12,0.4)`
 *   title   104,96 · 42/700 · "Launch Your AI Social Media Agency"
 *   sub     104,164 · 880 wide · 20.5/400 `#5B5B5B`, its list in 700 `#3B3B3B`
 *   cta     104,296 · h56 r12 `#0C0C0C` · 17/600
 *
 * ── Launched ──────────────────────────────────────────────────────────────
 *
 *   card    42,118 · 1644x372 r22 `#FCFCFC`
 *   welcome 66,150 · 29/700 over a 16/400 `#838383` line at 66,196
 *   setup   66,240 · 246x112 r14 white, hairline ring, with a 68px 100% ring
 *   stats   330,240 and 572,240 · 224x112 r14 on mint and peach, value 30/700
 *   url     66,374 · 16/500 with the address in 600 `#3B3B3B`
 *   chips   66,406 · seven h36 r9 white chips, each a connected account
 *   assets  826,142 · 836x326 r16 on `#DCF1F8`, three 300x294 r12 cards
 *
 * ── What is real here, and the one number that is not ─────────────────────
 *
 * `agency.roster` is the read behind all of it: one row per brand in the
 * organisation with its published count, impressions, engagements and a `quiet`
 * flag, plus org totals. So Total Workspaces is `totals.brands` and the client
 * table is the roster.
 *
 * **Total Clients** has nothing behind it. A brand is not a client — an agency
 * can run four brands for one client or one brand for four — and no table
 * records the relationship. The design's 530 is a fixture. It shows the count it
 * can defend (brands whose accounts are not quiet) under a label that says what
 * that is, rather than a bigger number that means nothing.
 */
export function AgencyHomeHero({ onLaunch }: { onLaunch: () => void }) {
  return (
    <section
      className="absolute left-ag-gutter top-[118px] h-[376px] w-ag-wide overflow-hidden rounded-[22px] bg-ag-hero"
      style={{ boxShadow: '0 20px 50px -42px rgba(12,12,12,0.4)' }}
    >
      {/*
        The illustration cluster the design floats over the card's right half —
        two bleeding orbs, a chat bubble, and four product tiles. All of it is
        decorative, so it is `aria-hidden` and never in the tab order.
      */}
      <span
        aria-hidden
        className="absolute right-[-40px] top-[-190px] block h-[760px] w-[760px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(244,214,246,0.75) 0%, rgba(226,222,250,0.45) 52%, rgba(233,242,250,0) 74%)' }}
      />
      <span
        aria-hidden
        className="absolute right-[200px] top-[-60px] block h-[480px] w-[480px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(250,236,252,0.9) 0%, rgba(236,230,252,0.4) 58%, rgba(236,230,252,0) 78%)' }}
      />

      {/* the rounded blue capsule with two glowing eyes */}
      <span
        aria-hidden
        className="absolute right-[490px] top-[158px] block h-[96px] w-[170px] rounded-[34px]"
        style={{
          background: 'linear-gradient(180deg, rgba(140,210,244,0.55) 0%, rgba(108,184,236,0.4) 100%)',
          boxShadow: '0 24px 54px -22px rgba(76,150,220,0.55), inset 0 2px 10px rgba(255,255,255,0.7)',
        }}
      >
        <span className="absolute left-[36px] top-[36px] block h-[22px] w-[22px] rounded-full bg-white" style={{ boxShadow: '0 0 18px rgba(255,255,255,0.9)' }} />
        <span className="absolute right-[36px] top-[36px] block h-[22px] w-[22px] rounded-full bg-white" style={{ boxShadow: '0 0 18px rgba(255,255,255,0.9)' }} />
      </span>

      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size decorative sprite off the prototype, not content */}
      <img src="/agency/portal-usermsg.png" alt="" aria-hidden className="absolute right-[650px] top-[44px] w-[118px]" />

      {/* the Instagram tile */}
      <span
        aria-hidden
        className="absolute right-[118px] top-[40px] flex h-[64px] w-[64px] items-center justify-center rounded-[16px]"
        style={{
          background: 'radial-gradient(circle at 28% 108%, #FFD600 0%, #FF6930 36%, #E1306C 64%, #7638FA 100%)',
          boxShadow: '0 18px 40px -16px rgba(225,48,108,0.6)',
        }}
      >
        <svg width="34" height="34" viewBox="0 0 34 34" fill="none" className="block">
          <rect x="4" y="4" width="26" height="26" rx="8" stroke="#FFFFFF" strokeWidth="2.4" />
          <circle cx="17" cy="17" r="6.2" stroke="#FFFFFF" strokeWidth="2.4" />
          <circle cx="25" cy="9" r="1.9" fill="#FFFFFF" />
        </svg>
      </span>

      {/* the tilted photo tile */}
      <span
        aria-hidden
        className="absolute right-[690px] top-[196px] flex h-[64px] w-[74px] items-center justify-center rounded-[14px]"
        style={{
          background: 'linear-gradient(160deg, #FFE9B8 0%, #F7B95C 100%)',
          boxShadow: '0 18px 40px -18px rgba(240,160,60,0.65)',
          transform: 'rotate(-8deg)',
        }}
      >
        <svg width="40" height="34" viewBox="0 0 40 34" fill="none" className="block">
          <rect x="2" y="2" width="36" height="30" rx="5" fill="#FDF4E0" />
          <circle cx="13" cy="12" r="4" fill="#F2A93C" />
          <path d="m6 28 10-10 7 7 5-5 6 6v4a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2Z" fill="#E88F30" />
        </svg>
      </span>

      {/* the browser mock-up */}
      <span
        aria-hidden
        className="absolute right-[96px] top-[196px] block h-[78px] w-[96px] rounded-[12px]"
        style={{ background: 'linear-gradient(170deg, #4E7BF0 0%, #3157D6 100%)', boxShadow: '0 20px 44px -18px rgba(64,102,224,0.65)' }}
      >
        <span className="absolute left-[8px] right-[8px] top-[8px] flex h-[14px] items-center gap-[3px] rounded-[5px] bg-white px-[4px]">
          <span className="block h-[4px] w-[4px] rounded-full" style={{ background: '#57D9F2' }} />
          <span className="block h-[4px] w-[4px] rounded-full" style={{ background: '#F8B84A' }} />
          <span className="block h-[4px] w-[4px] rounded-full" style={{ background: '#F06BF5' }} />
        </span>
        <span className="absolute left-[8px] top-[28px] block h-[22px] w-[34px] rounded-[4px]" style={{ background: '#F2B23E' }} />
        <span className="absolute left-[48px] right-[8px] top-[28px] block h-[9px] rounded-[3px]" style={{ background: '#8FE39A' }} />
        <span className="absolute left-[48px] right-[8px] top-[41px] block h-[9px] rounded-[3px]" style={{ background: '#79D6F2' }} />
      </span>

      <h2
        className="absolute left-[104px] top-[96px] whitespace-nowrap text-[42px] font-bold leading-none text-ink"
        style={{ letterSpacing: '-0.01em' }}
      >
        Launch Your AI Social Media Agency
      </h2>

      <p className="absolute left-[104px] top-[164px] w-[880px] text-[20.5px] font-normal leading-[1.55]" style={{ color: 'rgb(91,91,91)' }}>
        Create a fully branded AI-powered social media agency complete with:
        <br />
        <b className="font-bold" style={{ color: 'rgb(59,59,59)' }}>
          Website, Service pages, Lead capture, Client onboarding,
          <br />
          Social media assets, Proposals
        </b>
      </p>

      {/* The design hovers to #242424; `ink-800` (#1E1E1E) is the app's own
          primary-hover token and is used here so every black button in the
          product hovers alike. */}
      <button
        type="button"
        onClick={onLaunch}
        className="absolute left-[104px] top-[296px] flex h-[56px] items-center gap-[12px] rounded-[12px] bg-ink px-[26px] text-[17px] font-semibold text-white transition-[background-color,transform] hover:bg-ink-800 active:scale-[0.985]"
      >
        <span className="whitespace-nowrap">Launch Your Ai Agency</span>
        <svg width="13" height="13" viewBox="0 0 10 10" fill="none" aria-hidden className="block">
          <path d="M1 9 9 1M9 1H3M9 1v6" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </section>
  );
}

export function AgencyHomeSummary({
  totals,
  accounts,
  onEditWizard,
}: {
  totals: { brands: number; quiet: number };
  /** Connected publishing accounts, for the design's chip row. */
  accounts: Array<{ platform: string; label: string }>;
  onEditWizard: () => void;
}) {
  const active = Math.max(0, totals.brands - totals.quiet);

  return (
    <section
      className="absolute left-ag-gutter top-[118px] h-[372px] w-ag-wide overflow-hidden rounded-[22px] bg-ag-card"
      style={{ boxShadow: '0 20px 50px -42px rgba(12,12,12,0.4)' }}
    >
      <h2 className="absolute left-[66px] top-[150px] whitespace-nowrap text-[29px] font-bold leading-none text-ink">
        Welcome to your Agency Portal
      </h2>
      <p className="absolute left-[66px] top-[196px] text-[16px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
        Your central hub for managing agency tasks and resources.
      </p>

      {/* ── setup card ─────────────────────────────────────────────────── */}
      <div
        className="absolute left-[66px] top-[240px] h-[112px] w-[246px] rounded-[14px] bg-white"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
      >
        <span className="absolute left-[17px] top-[14px] text-[14.5px] font-medium" style={{ color: 'rgb(91,91,91)' }}>
          Agency setup
        </span>
        <span className="absolute left-[17px] top-[40px] flex items-center gap-[7px]">
          <span aria-hidden className="block h-[17px] w-[17px] rounded-full" style={{ background: '#22B14C' }} />
          <span className="text-[15.5px] font-semibold text-ink">Completed</span>
        </span>
        <button
          type="button"
          onClick={onEditWizard}
          className="absolute left-[17px] top-[70px] h-[30px] rounded-[8px] bg-white px-[11px] text-[13.5px] font-medium transition-colors hover:bg-surface-200"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)', color: 'rgb(91,91,91)' }}
        >
          Edit Wizard
        </button>
        <span
          aria-hidden
          className="absolute right-[18px] top-[22px] flex h-[68px] w-[68px] items-center justify-center rounded-full text-[17px] font-bold text-white"
          style={{ background: 'radial-gradient(circle at 32% 32%, #F56BFF 0%, #A341FF 65%, #7B2BE0 100%)' }}
        >
          100%
        </span>
      </div>

      {/* ── the two stats ──────────────────────────────────────────────── */}
      <Stat x={330} tint="bg-ag-mint" label="Total Workspaces" value={totals.brands} />
      <Stat
        x={572}
        tint="bg-ag-peach"
        label="Active client accounts"
        value={active}
        note={totals.quiet > 0 ? `${totals.quiet} quiet` : undefined}
      />

      <p className="absolute left-[66px] top-[374px] text-[16px] font-medium" style={{ color: 'rgb(91,91,91)' }}>
        Website URL:{' '}
        <b className="font-semibold" style={{ color: 'rgb(59,59,59)' }}>
          Not connected yet
        </b>
      </p>

      {/* ── the account chips ──────────────────────────────────────────── */}
      <div className="absolute left-[66px] top-[406px] flex w-[740px] flex-wrap gap-[10px]">
        {accounts.length === 0 ? (
          <span className="text-[13.5px]" style={{ color: 'rgb(131,131,131)' }}>
            No publishing accounts connected yet.
          </span>
        ) : (
          accounts.slice(0, 7).map((a) => (
            <span
              key={a.platform}
              className="flex h-[36px] items-center gap-[8px] rounded-[9px] bg-white px-[12px] text-[13.5px] font-semibold text-ink"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
            >
              <PlatformDot platform={a.platform} />
              <span className="max-w-[110px] truncate">{a.label}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden className="block">
                <path d="M1 9 9 1M9 1H3M9 1v6" stroke="rgb(91,91,91)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ))
        )}
      </div>

      {/* ── generated assets ───────────────────────────────────────────── */}
      <div className="absolute left-[826px] top-[142px] h-[326px] w-[836px] overflow-hidden rounded-[16px] bg-ag-assets">
        {/* Agency Website — the design's own tinted card with a phone mock. */}
        <div
          className="absolute left-[16px] top-[16px] h-[294px] w-[300px] overflow-hidden rounded-[12px]"
          style={{ background: 'linear-gradient(160deg, #CBECF6 0%, #EAF7FB 100%)', boxShadow: '0 12px 30px -24px rgba(12,12,12,0.35)' }}
        >
          <span className="absolute left-[16px] top-[14px] text-[15px] font-bold text-ink">Agency Website</span>
          <AssetEye filled />
          <span
            aria-hidden
            className="absolute left-[70px] top-[76px] block h-[250px] w-[160px] rounded-t-[10px] bg-white"
            style={{ boxShadow: '0 -6px 24px -12px rgba(12,12,12,0.2)' }}
          />
          <span className="absolute bottom-[14px] left-0 right-0 text-center text-[12.5px]" style={{ color: 'rgb(91,91,91)' }}>
            Generated in the launch wizard.
          </span>
        </div>

        {/* Facebook cover */}
        <div
          className="absolute left-[332px] top-[16px] h-[294px] w-[300px] overflow-hidden rounded-[12px] bg-white"
          style={{ boxShadow: '0 12px 30px -24px rgba(12,12,12,0.35)' }}
        >
          <span className="absolute left-[16px] top-[14px] text-[15px] font-bold text-ink">Facebook cover</span>
          <AssetEye />
          <span className="absolute left-[16px] right-[16px] top-[150px] text-center text-[12.5px] leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
            Generated in the launch wizard.
          </span>
        </div>

        {/* LinkedIn banners — the design's empty 200x96 frame at 16,150. */}
        <div
          className="absolute left-[648px] top-[16px] h-[294px] w-[300px] overflow-hidden rounded-[12px] bg-white"
          style={{ boxShadow: '0 12px 30px -24px rgba(12,12,12,0.35)' }}
        >
          <span className="absolute left-[16px] top-[14px] text-[15px] font-bold text-ink">LinkedIn banners</span>
          <span
            aria-hidden
            className="absolute left-[16px] top-[150px] block h-[96px] w-[200px] rounded-[8px]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
          />
          <span className="absolute left-[16px] right-[16px] top-[258px] text-[12.5px]" style={{ color: 'rgb(131,131,131)' }}>
            Generated in the launch wizard.
          </span>
        </div>

        {/*
          The carousel pagers. There are exactly three cards and nothing to
          page to, so they are present and disabled rather than wired to a
          scroll that would not move.
        */}
        {[
          { side: 'left' as const, flip: true },
          { side: 'right' as const, flip: false },
        ].map((p) => (
          <span
            key={p.side}
            aria-hidden
            className="absolute top-[148px] z-[3] flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white"
            style={{ [p.side]: 10, boxShadow: '0 6px 16px -8px rgba(12,12,12,0.4)', opacity: 0.55 }}
          >
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" className="block" style={{ transform: p.flip ? 'scaleX(-1)' : undefined }}>
              <path d="m1 1 5 5-5 5" stroke="#3B3B3B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ))}
      </div>
    </section>
  );
}

/**
 * The 32px preview affordance each asset card carries. Nothing generates the
 * collateral yet, so it is inert and says why on hover rather than opening an
 * empty preview.
 */
function AssetEye({ filled = false }: { filled?: boolean }) {
  return (
    <span
      className="absolute right-[12px] top-[10px] flex h-[32px] w-[32px] items-center justify-center rounded-full"
      style={filled ? { background: '#FFFFFF', opacity: 0.55 } : { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)', opacity: 0.55 }}
      title="Nothing generated to preview yet"
    >
      <svg width="15" height="12" viewBox="0 0 19 15" fill="none" aria-hidden className="block">
        <path d="M1.5 7.5S4.4 1.8 9.5 1.8s8 5.7 8 5.7-2.9 5.7-8 5.7-8-5.7-8-5.7Z" stroke="#5B5B5B" strokeWidth="1.3" strokeLinejoin="round" />
        <circle cx="9.5" cy="7.5" r="2.2" stroke="#5B5B5B" strokeWidth="1.3" />
      </svg>
    </span>
  );
}

function Stat({
  x,
  tint,
  label,
  value,
  note,
}: {
  x: number;
  tint: string;
  label: string;
  value: number;
  note?: string;
}) {
  return (
    <div className={`absolute top-[240px] h-[112px] w-[224px] rounded-[14px] ${tint}`} style={{ left: x }}>
      <span className="absolute left-[18px] top-[16px] text-[15.5px] font-medium" style={{ color: 'rgb(59,59,59)' }}>
        {label}
      </span>
      <span className="absolute left-[18px] top-[52px] text-[30px] font-bold leading-none text-ink">{value}</span>
      {note ? (
        <span className="absolute bottom-[12px] left-[18px] text-[13px] font-medium" style={{ color: 'rgb(91,91,91)' }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

const TINT: Record<string, string> = {
  instagram: '#E1306C',
  instagram_story: '#E1306C',
  facebook: '#1877F2',
  facebook_group: '#1877F2',
  linkedin: '#0A66C2',
  x: '#0C0C0C',
  tiktok: '#010101',
  youtube_shorts: '#FF0000',
  youtube_long: '#FF0000',
  threads: '#0C0C0C',
  pinterest: '#E60023',
  google_business: '#4285F4',
  reddit: '#FF4500',
  bluesky: '#0085FF',
};

function PlatformDot({ platform }: { platform: string }) {
  return (
    <span
      aria-hidden
      className="block h-[17px] w-[17px] shrink-0 rounded-[5px]"
      style={{ background: TINT[platform] ?? '#838383' }}
    />
  );
}

/**
 * The Growth Tools band — 42,514 · 1644x136 r20 on `#FAE3C2`, with two
 * 438x96 r14 white cards at x=640 and x=1104 (relative to the band).
 */
export function AgencyGrowthTools({
  onClientFinder,
  onJobFinder,
}: {
  onClientFinder: () => void;
  onJobFinder: () => void;
}) {
  return (
    <section className="absolute left-ag-gutter top-[514px] h-[136px] w-ag-wide rounded-[20px] bg-ag-growth">
      <h3 className="absolute left-[32px] top-[28px] flex items-center gap-[11px] whitespace-nowrap text-[22px] font-bold leading-none text-ink">
        <svg width="18" height="24" viewBox="0 0 16 20" fill="none" aria-hidden className="block">
          <path d="M9.5 1 2 11.5h5L6.5 19 14 8.5H9L9.5 1Z" fill="#0C0C0C" />
        </svg>
        Growth Tools:
      </h3>
      <p className="absolute left-[32px] top-[66px] w-[430px] text-[15.5px] font-medium leading-[1.35]" style={{ color: 'rgb(91,91,91)' }}>
        Discover new clients and job opportunities with our powerful Growth Tools.
      </p>

      <ToolCard
        x={640}
        tint="#E2C4FA"
        icon={
          <svg width="28" height="28" viewBox="0 0 26 26" fill="none" aria-hidden className="block">
            <circle cx="10" cy="8" r="3.4" stroke="#0C0C0C" strokeWidth="1.8" />
            <path d="M3 20c1.2-3.2 3.9-5 7-5 .9 0 1.8.15 2.6.45" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="17.4" cy="16.4" r="3.4" stroke="#0C0C0C" strokeWidth="1.8" />
            <path d="m20 19 3 3" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        }
        title="Client Finder"
        body="A tool designed to help businesses easily locate and connect with potential clients."
        onClick={onClientFinder}
      />
      <ToolCard
        x={1104}
        tint="#BFC4F6"
        icon={
          <svg width="27" height="27" viewBox="0 0 26 26" fill="none" aria-hidden className="block">
            <circle cx="10.5" cy="7.5" r="3.2" stroke="#0C0C0C" strokeWidth="1.8" />
            <path d="M3 19.4c1.1-3 3.6-4.7 6.6-4.7" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
            <rect x="12.6" y="14" width="10.4" height="8" rx="2" stroke="#0C0C0C" strokeWidth="1.7" />
            <path d="M15.8 14v-1.2a2 2 0 0 1 2-2h.2a2 2 0 0 1 2 2V14" stroke="#0C0C0C" strokeWidth="1.6" />
          </svg>
        }
        title="Job Finder"
        body="Discover your dream job effortlessly with our intuitive Job Finder tool."
        onClick={onJobFinder}
      />
    </section>
  );
}

function ToolCard({
  x,
  tint,
  icon,
  title,
  body,
  onClick,
}: {
  x: number;
  tint: string;
  icon: ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute top-[20px] h-[96px] w-[438px] rounded-[14px] bg-white text-left transition-shadow hover:shadow-[0_14px_30px_-16px_rgba(12,12,12,0.5)]"
      style={{ left: x, boxShadow: '0 10px 26px -20px rgba(12,12,12,0.4)' }}
    >
      <span
        aria-hidden
        className="absolute left-[16px] top-[18px] flex h-[60px] w-[60px] items-center justify-center rounded-[14px]"
        style={{ background: tint }}
      >
        {icon}
      </span>
      <span className="absolute left-[92px] top-[18px] text-[18.5px] font-bold text-ink">{title}</span>
      <span className="absolute left-[92px] top-[48px] block w-[330px] text-[13.5px] font-normal leading-[1.3]" style={{ color: 'rgb(91,91,91)' }}>
        {body}
      </span>
    </button>
  );
}

export type { RosterBrand };
