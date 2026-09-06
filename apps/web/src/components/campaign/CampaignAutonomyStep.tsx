'use client';

import type { CampaignWeight, EngagementRung } from '@sparksocial/shared';
import { Chevron, InfoIcon, PANEL_CLIP, StepPanel, Switch, TickPath } from './campaignChrome';
import { DURATIONS, RUNG_CARDS, WEIGHT_STOPS, ladderFromMode, modeFromLadder } from './campaignDraft';

/**
 * `Step 5 — Autonomy & Responsibility`. The widest step: a 920×870 panel, which
 * is why the modal grows to 1114 and the stage to 1184.
 *
 *   panel        59,222 · 920×870, clip `s5`
 *   content card 23,161 · 440×289 · rows at y 87 / 152 / 217, each 54 tall
 *   learning     480,161 · 420×289 · rows at y 89 / 154
 *   duration     23,471 · 440×155 · the cycling row at 20,83 · 399×54
 *   frequency    482,471 · 418×155 · track 20,84 · 382×20 r10, fill #6CE8FF,
 *                stops 39 / 191 / 382 with `transition: width 0.3s`
 *   engagement   23,660 · 877×181 · four 211×109 r20 cards on a 222 pitch
 *
 * ── The one place this departs from the drawing ───────────────────────────
 *
 * The design renders the whole Engagement Responsibilities block at
 * `opacity: 0.3` — greyed out, nothing to click. In this build that block is
 * live, because `engagementRung` is not decoration: `policy.ts` rule 6 reads it
 * on every reply the agent makes, and Sales Assist's handoff rules apply only
 * on the top rung. Shipping the greyed version would hide a control that
 * governs what the agent says to customers, and default it silently.
 */

function SwitchRow({
  x,
  y,
  w,
  labelX,
  knobX,
  label,
  on,
  onChange,
  locked,
  lockedWhy,
}: {
  x: number;
  y: number;
  w: number;
  labelX: number;
  knobX: number;
  label: string;
  on: boolean;
  onChange: () => void;
  locked?: boolean;
  lockedWhy?: string;
}) {
  return (
    <div
      className="absolute h-cmp-row rounded bg-white"
      style={{ left: x, top: y, width: w, boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}
      title={locked ? lockedWhy : undefined}
    >
      <span className="absolute top-[17px] whitespace-nowrap text-[16px] font-medium leading-none" style={{ left: labelX, color: 'rgb(131,131,131)' }}>
        {label}
      </span>
      <span className="absolute top-[14px]" style={{ left: knobX }}>
        <Switch on={on} onChange={onChange} label={label} disabled={locked} />
      </span>
    </div>
  );
}

export function AutonomyStep({
  approvalMode,
  onApprovalMode,
  learn,
  onLearn,
  mix,
  onMix,
  windowDays,
  onWindowDays,
  weight,
  onWeight,
  rung,
  onRung,
  timezone,
}: {
  approvalMode: string;
  onApprovalMode: (m: string) => void;
  learn: boolean;
  onLearn: () => void;
  mix: boolean;
  onMix: () => void;
  windowDays: number;
  onWindowDays: (d: number) => void;
  weight: CampaignWeight;
  onWeight: (w: CampaignWeight) => void;
  rung: EngagementRung;
  onRung: (r: EngagementRung) => void;
  timezone: string;
}) {
  const ladder = ladderFromMode(approvalMode);
  const durationIdx = Math.max(0, DURATIONS.findIndex((d) => d.days === windowDays));
  const fill = WEIGHT_STOPS.find((s) => s.value === weight)?.fill ?? 191;

  return (
    <StepPanel x={59} y={222} w={920} h={870} clip={PANEL_CLIP.s5}>
      <span className="absolute left-[25px] top-[39px] whitespace-nowrap text-[16px] font-normal leading-[1.43]" style={{ color: 'rgb(131,131,131)' }}>
        Autonomy &amp; Responsibility
      </span>
      <InfoIcon className="absolute left-[238px] top-[39px]" title="What this campaign may do without you. Every one of these is enforced, not advisory." />

      <h2 className="absolute left-[25px] top-[85px] whitespace-nowrap text-[18px] font-semibold leading-[1.273] text-black">
        How much responsibility does your agent have?
      </h2>
      <p className="absolute left-[25px] top-[111px] whitespace-nowrap text-[16px] font-normal leading-[1.43]" style={{ color: 'rgb(131,131,131)' }}>
        Control what your agent does independently, you can change anytime
      </p>
      <span className="absolute left-[668px] top-[111px] whitespace-nowrap text-[20px] font-medium leading-none" style={{ color: 'rgb(131,131,131)' }}>
        Timezone: {timezone}
      </span>
      <a
        href="/settings/brand-kit"
        className="absolute left-[822px] top-[111px] whitespace-nowrap text-[20px] font-medium leading-none text-purple transition-opacity hover:opacity-70"
      >
        Change
      </a>

      {/* ── content responsibility ──────────────────────────────────────── */}
      <div className="absolute left-[23px] top-[161px] h-[289px] w-[440px] rounded bg-white" style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}>
        <span className="absolute left-[20px] top-[15px] whitespace-nowrap text-[16px] font-semibold leading-none text-black">Content responsibility</span>
        <span className="absolute left-[20px] top-[38px] block w-[297px] text-[14px] font-normal leading-none" style={{ color: 'rgb(131,131,131)' }}>
          Decide how your agent handles content creation and publishing
        </span>

        {/* Drafting is the floor of the ladder — a campaign that drafts nothing
            is not a campaign — so it is shown on and cannot be switched off. */}
        <SwitchRow
          x={20}
          y={87}
          w={398}
          labelX={14}
          knobX={337}
          label="Generate content draft"
          on={ladder.draft}
          onChange={() => {}}
          locked
          lockedWhy="A campaign is the posts it writes. Turning this off would mean not running one."
        />
        <SwitchRow
          x={20}
          y={152}
          w={396}
          labelX={17}
          knobX={335}
          label="Schedule post"
          on={ladder.schedule}
          onChange={() => onApprovalMode(modeFromLadder(!ladder.schedule, false))}
        />
        <SwitchRow
          x={20}
          y={217}
          w={399}
          labelX={14}
          knobX={335}
          label="Full Auto Mode"
          on={ladder.auto}
          onChange={() => onApprovalMode(modeFromLadder(true, !ladder.auto))}
        />
      </div>

      {/* ── optimization & learning ─────────────────────────────────────── */}
      <div className="absolute left-[480px] top-[161px] h-[289px] w-[420px] rounded bg-white" style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}>
        <span className="absolute left-[22px] top-[17px] whitespace-nowrap text-[16px] font-semibold leading-none text-black">Optimization &amp; Learning</span>
        <span className="absolute left-[22px] top-[40px] block w-[297px] text-[14px] font-normal leading-none" style={{ color: 'rgb(131,131,131)' }}>
          Allow your agent to adapt based on performance
        </span>
        <SwitchRow x={23} y={89} w={377} labelX={14} knobX={322} label="Learn from performance automatically" on={learn} onChange={onLearn} />
        <SwitchRow x={24} y={154} w={376} labelX={13} knobX={321} label="Adjust content mix automatically" on={mix} onChange={onMix} />
      </div>

      {/* ── campaign duration ───────────────────────────────────────────── */}
      <div className="absolute left-[23px] top-[471px] h-[155px] w-[440px] rounded bg-white" style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}>
        <span className="absolute left-[23px] top-[17px] whitespace-nowrap text-[16px] font-semibold leading-none text-black">Campaign Duration</span>
        <InfoIcon className="absolute left-[177px] top-[16px]" title="How long the campaign plans for. The calendar is generated across this window." />
        <span className="absolute left-[23px] top-[44px] whitespace-nowrap text-[14px] font-normal leading-none" style={{ color: 'rgb(131,131,131)' }}>
          How long should the campaign run for?
        </span>
        <button
          type="button"
          onClick={() => onWindowDays(DURATIONS[(durationIdx + 1) % DURATIONS.length]!.days)}
          aria-label={`Campaign duration: ${DURATIONS[durationIdx]?.label}. Click to change.`}
          className="absolute left-[20px] top-[83px] h-cmp-row w-[399px] cursor-pointer rounded bg-white text-left transition-shadow"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = 'inset 0 0 0 1.4px rgba(12,12,12,0.25)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(12,12,12,0.1)';
          }}
        >
          <span className="absolute left-[17px] top-[17px] whitespace-nowrap text-[16px] font-medium leading-none" style={{ color: 'rgb(131,131,131)' }}>
            {DURATIONS[durationIdx]?.label}
          </span>
          <Chevron className="absolute left-[361px] top-[19px]" style={{ transform: 'rotate(90deg) scale(0.85)' }} />
        </button>
      </div>

      {/* ── campaign frequency ──────────────────────────────────────────── */}
      <div className="absolute left-[482px] top-[471px] h-[155px] w-[418px] rounded bg-white" style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}>
        <span className="absolute left-[23px] top-[17px] whitespace-nowrap text-[16px] font-semibold leading-none text-black">Campaign frequency</span>
        <InfoIcon className="absolute left-[186px] top-[16px]" title="How much of the month this campaign takes. The rest stays your baseline posting." />
        <span className="absolute left-[23px] top-[44px] whitespace-nowrap text-[14px] font-normal leading-none" style={{ color: 'rgb(131,131,131)' }}>
          How much attention should this get?
        </span>

        <div className="absolute left-[20px] top-[84px] h-[51px] w-[382px]">
          <div aria-hidden className="absolute left-0 top-0 h-[20px] w-[382px] rounded bg-white" style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }} />
          <div
            aria-hidden
            className="absolute left-0 top-0 h-[20px] rounded transition-[width] duration-300"
            style={{ width: fill, background: 'var(--ss-cyan)', boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}
          />
          {WEIGHT_STOPS.map((s, i) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onWeight(s.value)}
              aria-pressed={weight === s.value}
              aria-label={`${s.label} frequency`}
              className="absolute top-0 h-[20px] cursor-pointer"
              style={{ left: [0, 127, 255][i], width: [127, 128, 127][i] }}
            />
          ))}
          {WEIGHT_STOPS.map((s) => (
            <button
              key={`${s.value}-label`}
              type="button"
              onClick={() => onWeight(s.value)}
              tabIndex={-1}
              className="absolute top-[33px] cursor-pointer whitespace-nowrap text-[14px] font-medium leading-none"
              style={{ left: s.labelX, color: weight === s.value ? 'var(--ss-ink-900)' : 'rgb(131,131,131)' }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── engagement responsibilities (live — see the header) ─────────── */}
      <div className="absolute left-[23px] top-[660px] h-[181px] w-[877px]">
        <span className="absolute left-[2px] top-0 whitespace-nowrap text-[18px] font-semibold leading-[1.273] text-black">
          Engagement Responsibilities
        </span>
        <InfoIcon className="absolute left-[255px] top-0" title="How far the agent may go in replies. Enforced on every comment and DM." />
        <span className="absolute left-[2px] top-[26px] whitespace-nowrap text-[16px] font-normal leading-[1.43]" style={{ color: 'rgb(131,131,131)' }}>
          Control how the agent handles comments and DMs
        </span>

        {RUNG_CARDS.map((r, i) => {
          const on = rung === r.value;
          return (
            <button
              key={r.value}
              type="button"
              onClick={() => onRung(r.value)}
              aria-pressed={on}
              className="absolute top-[72px] h-[109px] w-[211px] cursor-pointer rounded-xl bg-white text-left transition-shadow"
              style={{ left: i * 222, boxShadow: on ? 'inset 0 0 0 1.4px rgba(12,12,12,0.45)' : 'none' }}
            >
              <span className="absolute left-[16px] top-[24px] whitespace-nowrap text-[18px] font-semibold leading-none text-ink">{r.title}</span>
              <span className="absolute left-[16px] top-[53px] block w-[171px] text-[16px] font-medium leading-[0.9976]" style={{ color: 'rgb(131,131,131)' }}>
                {r.desc}
              </span>
              {on ? (
                <span className="absolute left-[173px] top-[12px] block h-[26px] w-[26px] rounded-full bg-cmp-tick">
                  <TickPath className="absolute left-[8.096px] top-[7.748px] block" />
                </span>
              ) : (
                <span className="absolute left-[173px] top-[12px] block h-[26px] w-[26px] rounded-full" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }} />
              )}
            </button>
          );
        })}
      </div>
    </StepPanel>
  );
}
