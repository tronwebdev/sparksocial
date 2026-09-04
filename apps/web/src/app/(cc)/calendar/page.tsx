'use client';

import { useState } from 'react';
import { CalendarBoard } from '@/components/calendar/CalendarBoard';
import { CalendarMonthGrid } from '@/components/command-center/CalendarMonthGrid';
import { PlanQueue } from '@/components/command-center/PlanQueue';
import { DraftPanel } from '@/components/command-center/draft-panel/DraftPanel';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { AddPostModal } from '@/components/calendar/AddPostModal';
import {
  AskAgentModal,
  CreateSpecificModal,
  MoveExistingModal,
} from '@/components/calendar/CalendarDayModals';
import { DraftReviewModal } from '@/components/calendar/DraftReviewModal';
import type { BoardActions } from '@/components/calendar/CalendarBoard';
import {
  CalendarScreenChrome,
  type CalendarLayout,
  type CalendarSpan,
} from '@/components/calendar/CalendarScreenChrome';

/**
 * `CAL-01` — the calendar, `SparkSocial Calendar.dc.html`.
 *
 * ── Why it moved out of `(app)` ───────────────────────────────────────────
 *
 * It rendered inside `AppShell`'s 322px sidebar frame under a `TopBar`, with a
 * 20px heading and a one-line subtitle. The prototype is full-bleed: the same
 * 1698-wide card at 15,18 the Command Center uses, its own wordmark and Back
 * button, a 30px "Calendar" title at 64,150, and its two view controls at
 * 1082,156 and 1372,156. There is no sidebar and no page header.
 *
 * `AppShell` has had a `chrome="bare"` prop for exactly this, and nothing could
 * reach it — the prop is set where `AppShell` is rendered, in `(app)/layout.tsx`,
 * and a page cannot influence its own layout. `(cc)/layout.tsx` is the group
 * that opts out, and its own docstring already named Calendar as one of the
 * screens that belongs there. A route group changes no URL: this is still
 * `/calendar`.
 *
 * ── What is reused ────────────────────────────────────────────────────────
 *
 * All of the body. `CalendarBoard` already reads `calendar.get`, generates from
 * a campaign, filters its slots, opens a day sheet and pins a draft to a date —
 * so this screen is its chrome, not a second calendar. The view toggle moved up
 * here because the design puts it in the chrome; the board takes it as a prop.
 */
export default function CalendarPage() {
  const [layout, setLayout] = useState<CalendarLayout>('calendar');
  /*
    Month / Week / Day. Only Month is designed — the prototype toasts the other
    two as mocks — and `calendar.get` returns a month's slots, so the control is
    real for Month and says what it cannot do for the rest rather than
    pretending to rescope.
  */
  const [span, setSpan] = useState<CalendarSpan>('month');
  const [monthOffset, setMonthOffset] = useState(0);
  const [draft, setDraft] = useState<{ open: boolean; contentItemId?: string }>({ open: false });
  /*
    Two day-keyed states, because the design has two steps.

    `addFor` is the Add Post chooser an empty cell opens. Picking any of its
    three options hands the same date to `CalendarBoard` as `dayFor`, which opens
    its own `DayActionSheet` — the component that already runs
    `calendar.recommend_slot`, accepts a recommendation, accepts a move and
    hands off to the Draft Panel, all against the view it has loaded.
  */
  /*
    Which of the design's five is open, and on what.

    The prototype holds exactly this — one `modal` field, null or one of five —
    so the screen does too rather than five booleans that can disagree.
  */
  const [modal, setModal] = useState<
    | { kind: 'add' | 'ask' | 'create' | 'move'; day: string }
    | { kind: 'review'; contentItemId: string }
    | null
  >(null);
  /* The board's own flow handlers — see `BoardActions`. */
  const [actions, setActions] = useState<BoardActions | null>(null);
  const { genome } = useSelectedGenome();

  return (
    <CalendarScreenChrome
      layout={layout}
      onLayout={setLayout}
      span={span}
      onSpan={setSpan}
      /*
        The prototype hardcodes "7 Post from 1st April 2026 to 30th April 2026"
        and "Post this month is doing 89% better than last month". Both are
        claims about real data — the second is a comparison nothing on this
        screen measures — so the summary is filled by the board's own slots via
        the callback below, and the stat pill is left out until there is a
        month-over-month number behind it. A made-up 89% on the calendar is the
        kind of thing that makes the honest numbers unreadable.
      */
      summary={undefined}
    >
      {/*
        The design's card at 48,250 — 1629 wide, 1345 tall in Calendar Mode and
        860 in List. Calendar Mode is `CalendarMonthGrid`'s `screen` variant
        (226px cells); List View is the queue card, which is byte-for-byte the
        Command Center's "Upcoming action queue" in this prototype — same six
        columns, same 157px rows, same five filters — so it is that component
        rather than a second table.
      */}
      {layout === 'calendar' ? (
        <section className="overflow-hidden rounded-lg bg-white">
          <CalendarMonthGrid
            variant="screen"
            genomeId={genome?.genomeId}
            monthOffset={monthOffset}
            onMonthOffset={setMonthOffset}
            onOpenDraft={(id) => setModal({ kind: 'review', contentItemId: id })}
            onAddPost={(day) => setModal({ kind: 'add', day })}
          />
        </section>
      ) : (
        <PlanQueue
          genomeId={genome?.genomeId}
          layout="table"
          title="Upcoming action queue"
          onOpen={(id) => setModal({ kind: 'review', contentItemId: id })}
        />
      )}

      {/*
        Campaign generation, ordered after the calendar.

        `CalendarBoard` carries the campaign list, `calendar.generate`, the mix
        preview and the impact preview — none of which the prototype's Calendar
        screen draws, and all of which are the only route to filling the grid it
        *does* draw. So it follows the card rather than leading, the same
        treatment the Command Center's control bars got.
      */}
      <div className="mt-[19px]">
        <CalendarBoard layout={layout} onActions={setActions} />
      </div>

      {/* The design's five, all in the shared shell. */}
      {modal?.kind === 'add' ? (
        <AddPostModal
          date={modal.day}
          onClose={() => setModal(null)}
          onAskAgent={() => setModal({ kind: 'ask', day: modal.day })}
          onCreateSpecific={() => setModal({ kind: 'create', day: modal.day })}
          onMoveExisting={() => setModal({ kind: 'move', day: modal.day })}
        />
      ) : null}

      {modal?.kind === 'ask' ? (
        <AskAgentModal day={modal.day} actions={actions} onClose={() => setModal(null)} />
      ) : null}

      {modal?.kind === 'create' ? (
        <CreateSpecificModal day={modal.day} actions={actions} onClose={() => setModal(null)} />
      ) : null}

      {modal?.kind === 'move' ? (
        <MoveExistingModal
          day={modal.day}
          genomeId={genome?.genomeId}
          actions={actions}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.kind === 'review' ? (
        <DraftReviewModal
          contentItemId={modal.contentItemId}
          genomeId={genome?.genomeId}
          onClose={() => setModal(null)}
          onOpenPanel={(id) => setDraft({ open: true, contentItemId: id })}
        />
      ) : null}

      <DraftPanel
        genomeId={genome?.genomeId}
        contentItemId={draft.contentItemId}
        open={draft.open}
        onClose={() => setDraft({ open: false })}
      />
    </CalendarScreenChrome>
  );
}
