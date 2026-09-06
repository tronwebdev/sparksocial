'use client';

import type { CampaignType } from '@sparksocial/shared';
import { PANEL_CLIP, SelectBadge, StepPanel } from './campaignChrome';
import { EXTRA_OBJECTIVES, GOAL_CARDS, TYPE_CARDS, type GoalCard } from './campaignDraft';

/**
 * Steps 1 and 2 — `Step 1 — Campaign Goal` and `Step 2 — Campaign Type`.
 *
 * One component each, but one card: both steps are a 2×2 grid of 252-wide cards
 * on the same notched 596×551 panel, differing only in the card height (177 vs
 * 191), the row offsets and the copy. The card is written once here.
 *
 *   panel   220,235 (s1) · 220,236 (s2) · 596×551
 *   cards   x 37 / 308 · y 145 / 346 (s1) · y 131 / 345 (s2)
 *   chosen  background #FFF, no ring, gradient tick badge at 212,14
 *   unset   transparent, `inset 0 0 0 1.276px rgba(12,12,12,0.1)`
 *   hover   `inset 0 0 0 1.276px rgba(12,12,12,0.35)`
 */

const CARD_X = [37, 308, 37, 308];

function ChoiceCard({
  i,
  rowY,
  h,
  title,
  desc,
  icon,
  on,
  onPick,
}: {
  i: number;
  rowY: [number, number];
  h: number;
  title: string;
  desc: string;
  icon: React.ReactNode;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      className="absolute w-cmp-card cursor-pointer rounded-xl text-left transition-shadow"
      style={{
        left: CARD_X[i],
        top: i < 2 ? rowY[0] : rowY[1],
        height: h,
        background: on ? 'rgb(255,255,255)' : 'transparent',
        boxShadow: on ? 'none' : 'inset 0 0 0 1.276px rgba(12,12,12,0.1)',
      }}
      onMouseEnter={(e) => {
        if (!on) e.currentTarget.style.boxShadow = 'inset 0 0 0 1.276px rgba(12,12,12,0.35)';
      }}
      onMouseLeave={(e) => {
        if (!on) e.currentTarget.style.boxShadow = 'inset 0 0 0 1.276px rgba(12,12,12,0.1)';
      }}
    >
      <span className="absolute left-1/2 top-[30px] block -translate-x-1/2">{icon}</span>
      <span className="absolute inset-x-0 top-[87px] block whitespace-nowrap text-center text-[18px] font-semibold leading-none text-ink">
        {title}
      </span>
      <span
        className="absolute left-[35.5px] top-[118px] block w-[181px] text-center text-[16px] font-medium leading-[0.9986]"
        style={{ color: 'rgb(131,131,131)' }}
      >
        {desc}
      </span>
      <SelectBadge on={on} />
    </button>
  );
}

/* ── The eight glyphs, drawn rather than imported ──────────────────────────
   The prototype pulls these from `cc-icons.jsx`, which is not part of the app.
   Each is redrawn at the size the design places it at. */

const stroke = { stroke: 'rgb(12,12,12)', strokeWidth: 1.7, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GOAL_ICONS: Record<string, React.ReactNode> = {
  leads: (
    <svg width="34.466" height="34.5" viewBox="0 0 35 35" aria-hidden>
      <path d="M13 15.5a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" {...stroke} />
      <path d="M2.5 30c0-5.2 4.7-9 10.5-9 3 0 5.7 1 7.6 2.7" {...stroke} />
      <path d="M22 27.5h10M27 22.5v10" {...stroke} />
    </svg>
  ),
  sales: (
    <svg width="36.383" height="34.708" viewBox="0 0 37 35" aria-hidden>
      <path d="M3 6h5l3.6 17.2a2.5 2.5 0 0 0 2.5 2h13.4a2.5 2.5 0 0 0 2.4-1.9L33 11H10" {...stroke} />
      <path d="M15 30.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM27 30.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z" {...stroke} />
    </svg>
  ),
  traffic: (
    <svg width="39" height="36.25" viewBox="0 0 39 37" aria-hidden>
      <path d="M19.5 33c8.6 0 15.5-6.9 15.5-15.5S28.1 2 19.5 2 4 8.9 4 17.5 10.9 33 19.5 33Z" {...stroke} />
      <path d="M4 17.5h31M19.5 2c3.9 4.2 6 9.7 6 15.5s-2.1 11.3-6 15.5c-3.9-4.2-6-9.7-6-15.5s2.1-11.3 6-15.5Z" {...stroke} />
    </svg>
  ),
  authority: (
    <svg width="34.08" height="35.5" viewBox="0 0 35 36" aria-hidden>
      <path d="M17.5 2.5 4 8v9.5c0 8 5.8 13.9 13.5 16 7.7-2.1 13.5-8 13.5-16V8L17.5 2.5Z" {...stroke} />
      <path d="m12 17.5 4 4 7.5-7.5" {...stroke} />
    </svg>
  ),
};

const TYPE_ICONS: Record<CampaignType, React.ReactNode> = {
  promotion: (
    <svg width="33.24" height="32.999" viewBox="0 0 34 33" aria-hidden>
      <path d="M17 2.5 20.9 11l9.1 1-6.8 6.4 1.8 9.1L17 23.2 8.9 27.5l1.8-9.1L4 12l9.1-1L17 2.5Z" {...stroke} />
    </svg>
  ),
  lead_magnet: (
    <svg width="33.001" height="33.001" viewBox="0 0 34 34" aria-hidden>
      <path d="M6 5h16l6 6v18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" {...stroke} />
      <path d="M22 5v6h6M10 18h12M10 24h8" {...stroke} />
    </svg>
  ),
  authority: (
    <svg width="37.918" height="38" viewBox="0 0 38 38" aria-hidden>
      <path d="M19 4 3 12l16 8 16-8-16-8Z" {...stroke} />
      <path d="M9 15v9c0 2.8 4.5 5 10 5s10-2.2 10-5v-9M35 12v11" {...stroke} />
    </svg>
  ),
  launch: (
    <svg width="35.538" height="30.999" viewBox="0 0 36 31" aria-hidden>
      <path d="M13 20 6 18l3-5 5 .6M16 24l2 7 5-3-.6-5" {...stroke} />
      <path d="M22.5 22.5c6-3.5 10-9.5 10.5-19-9.5.5-15.5 4.5-19 10.5l-2.5 4.5 6.5 6.5 4.5-2.5Z" {...stroke} />
      <path d="M9 25.5 5.5 29" {...stroke} />
    </svg>
  ),
};

/** `Step 1 — Campaign Goal`. */
export function GoalStep({
  goalKey,
  objective,
  onPickCard,
  onPickExtra,
}: {
  goalKey: string | null;
  objective: string;
  onPickCard: (card: GoalCard) => void;
  onPickExtra: (value: string) => void;
}) {
  return (
    <>
      <StepPanel x={220} y={235} w={596} h={551} clip={PANEL_CLIP.s12}>
        <h2 className="absolute left-[37px] top-[42px] whitespace-nowrap text-[25px] font-semibold leading-[1.43] text-black">
          What&rsquo;s your campaign goal?
        </h2>
        <p className="absolute left-[37px] top-[85px] whitespace-nowrap text-[18px] font-normal leading-[0.9987]" style={{ color: 'rgb(131,131,131)' }}>
          Could you share what matters most to you right now?
        </p>

        {GOAL_CARDS.map((c, i) => (
          <ChoiceCard
            key={c.key}
            i={i}
            rowY={[145, 346]}
            h={177}
            title={c.title}
            desc={c.desc}
            icon={GOAL_ICONS[c.key]}
            on={goalKey === c.key}
            onPick={() => onPickCard(c)}
          />
        ))}
      </StepPanel>

      {/*
        The three objectives the design's four cards leave unreachable.

        Below the panel rather than in it: the grid is 2×2 by design and a fifth
        card would break the composition, but `bookings`, `trials` and `hiring`
        are objectives the planner supports and dropping them to fit a layout
        would cost the product three kinds of campaign.
      */}
      <div className="absolute left-[220px] top-[800px] flex w-[596px] items-center gap-[12px]">
        <span className="whitespace-nowrap text-[15px] font-medium" style={{ color: 'rgb(131,131,131)' }}>
          Something else?
        </span>
        {EXTRA_OBJECTIVES.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onPickExtra(o.value)}
            aria-pressed={goalKey === null && objective === o.value}
            className="h-[34px] cursor-pointer rounded-[9.26px] bg-white px-[14px] text-[14.267px] font-medium transition-shadow"
            style={{
              color: goalKey === null && objective === o.value ? 'var(--ss-ink-900)' : 'rgb(131,131,131)',
              boxShadow:
                goalKey === null && objective === o.value
                  ? 'inset 0 0 0 1.4px rgba(12,12,12,0.55)'
                  : 'inset 0 0 0 0.617px rgba(12,12,12,0.2)',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}

/** `Step 2 — Campaign Type`. */
export function TypeStep({ value, onPick }: { value: CampaignType; onPick: (t: CampaignType) => void }) {
  return (
    <StepPanel x={220} y={236} w={596} h={551} clip={PANEL_CLIP.s12}>
      <h2 className="absolute left-[37px] top-[31px] whitespace-nowrap text-[25px] font-semibold leading-[1.43] text-black">
        Select a campaign type
      </h2>
      <p className="absolute left-[37px] top-[68px] w-[474px] text-[18px] font-normal leading-[0.9987]" style={{ color: 'rgb(131,131,131)' }}>
        I&rsquo;ve chosen a type for you based on your goal, but feel free to pick a different one if you prefer:
      </p>

      {TYPE_CARDS.map((t, i) => (
        <ChoiceCard
          key={t.value}
          i={i}
          rowY={[131, 345]}
          h={191}
          title={t.title}
          desc={t.desc}
          icon={TYPE_ICONS[t.value]}
          on={value === t.value}
          onPick={() => onPick(t.value)}
        />
      ))}
    </StepPanel>
  );
}
