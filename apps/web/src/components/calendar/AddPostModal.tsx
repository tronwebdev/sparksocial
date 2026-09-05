'use client';

import { CalendarModal } from './CalendarModal';

/**
 * The Add Post modal — `SparkSocial Calendar.dc.html`, the one an empty day
 * opens.
 *
 *   date         28px/700, the day it was opened on
 *   subtitle     top 140, centred, 18px/400 `#838383`
 *   three cards  151, tops 198 / 330 / 462 — 733x118 at radius 16
 *
 * The first card is the recommended one and the design says so with colour:
 * `linear-gradient(103deg, #B7ECF7 0%, #DDF7EE 100%)` under a
 * `0 14px 34px -20px rgba(11,170,199,0.55)` shadow that deepens on hover. The
 * other two are plain white. Each carries an icon at 34/44, a 22px/700 title at
 * 110,26 and a 17px/400 line at 110,63.
 *
 * ── It hands off rather than doing the work ───────────────────────────────
 *
 * "Ask Agent to plan" is `calendar.recommend_slot`, and `DayActionSheet` already
 * runs it together with accepting a recommendation, accepting a move and
 * handing off to the Draft Panel — all against `CalendarBoard`'s loaded view.
 * So this modal is the *chooser* the design draws in front of it: picking the
 * first option opens that sheet, and the other two go straight to their flows.
 * Reimplementing them here would have meant two versions of "accept a
 * recommendation", which is the sort of thing that drifts.
 */

export function AddPostModal({
  date,
  onClose,
  onAskAgent,
  onCreateSpecific,
  onMoveExisting,
}: {
  /** `YYYY-MM-DD`. */
  date: string;
  onClose: () => void;
  onAskAgent: () => void;
  onCreateSpecific: () => void;
  onMoveExisting: () => void;
}) {
  const pretty = new Date(`${date}T12:00:00`).toLocaleDateString('en', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const options = [
    {
      title: 'Ask Agent to plan',
      body: 'Let your Agent suggest the best content',
      onClick: onAskAgent,
      recommended: true,
    },
    {
      title: 'Create Something Specific',
      body: 'Create with AI or from scratch',
      onClick: onCreateSpecific,
      recommended: false,
    },
    {
      title: 'Move existing post',
      body: 'Reschedule another post here',
      onClick: onMoveExisting,
      recommended: false,
    },
  ];

  return (
    <CalendarModal kind="add" label={`Add a post on ${pretty}`} onClose={onClose}>
      {/*
        The design's three stops: the subtitle on 140, the first card on 198,
        and 132 between cards. The date's 28px/1.2 line and an 18px subtitle put
        those at 56 / 50 / 40 of padding.
      */}
      <div className="px-[151px] pt-[56px]">
        <p className="text-center text-[28px] font-bold leading-[1.2] text-ink">{pretty}</p>
        <p className="mt-[50px] text-center text-18 font-normal text-ink-muted">
          Choose how you want to create content for this date
        </p>

        <div className="mt-[40px] flex flex-col gap-[14px]">
          {options.map((o) => (
            <button
              key={o.title}
              type="button"
              onClick={o.onClick}
              className="relative flex h-[118px] w-full items-center rounded-2xl pl-[110px] text-left transition-shadow"
              style={
                o.recommended
                  ? {
                      background: 'linear-gradient(103deg, #B7ECF7 0%, #DDF7EE 100%)',
                      boxShadow: '0 14px 34px -20px rgba(11,170,199,0.55)',
                    }
                  : { background: '#FFFFFF', boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }
              }
            >
              {/* The recommended card's mark is the agent's own two eyes — the
                  design draws the orb's face rather than an icon. */}
              <span aria-hidden className="absolute left-[34px] top-[42px] block h-[34px] w-[46px]">
                {o.recommended ? (
                  <>
                    <span className="absolute left-0 top-[12px] block h-[9px] w-[9px] rounded-full bg-white" />
                    <span className="absolute left-[22px] top-[12px] block h-[9px] w-[9px] rounded-full bg-white" />
                  </>
                ) : (
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none" className="ml-[8px]">
                    <path
                      d={
                        o.title.startsWith('Create')
                          ? 'M15 4v22M4 15h22'
                          : 'M4 9h16M4 21h16M20 9l-4-4M20 9l-4 4M4 21l4-4M4 21l4 4'
                      }
                      stroke="#0C0C0C"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>

              <span className="block">
                <span className="block text-[22px] font-bold leading-none text-ink">{o.title}</span>
                <span className="mt-[15px] block text-[17px] font-normal text-ink-muted">{o.body}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </CalendarModal>
  );
}
