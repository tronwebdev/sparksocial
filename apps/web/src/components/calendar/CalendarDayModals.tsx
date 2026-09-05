'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';
import { CalendarModal } from './CalendarModal';
import type { BoardActions } from './CalendarBoard';

/**
 * The Calendar screen's four remaining modals — `SparkSocial Calendar.dc.html`.
 *
 * All four in the shared shell, at the design's own heights: Ask Agent 872,
 * Draft Review 760, Create Specific 700, Move Post 640. They were the existing
 * `DayActionSheet` and `DraftPanel` — functional, but wearing their own clothes
 * rather than the design's 1035-wide panel.
 *
 * The layout each one uses, card-relative:
 *
 *   title      28px/700, centred under the close button
 *   subtitle   18px/400 `#838383`
 *   section    19px/600 heading over a 900-wide panel inset 40
 *
 * ── Where the work happens ────────────────────────────────────────────────
 *
 * Nowhere here. `calendar.recommend_slot` is read below because it is a read,
 * but every *write* goes through `BoardActions` — `CalendarBoard`'s own
 * `acceptRecommendation`, `acceptMove` and `openTriggerFor`, which close over
 * the loaded view and its reload. These modals are the design's presentation of
 * flows that already existed; duplicating the handlers to own them here would
 * have produced a second "accept a recommendation" that drifts from the first.
 */

interface Recommendation {
  playbookId: string;
  playbookName?: string;
  mode?: string;
  why?: { summary?: string };
}

const PANEL = 'rounded-2xl bg-white px-[26px] py-[22px]';
const PANEL_RING = { boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.08)' } as const;

/** The design writes its dates as "March 14, 2026 · 12 : 00 : 00". */
function prettyDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('en', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function Head({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-[50px] pt-[44px]">
      <p className="text-center text-[28px] font-bold leading-[1.2] text-ink">{title}</p>
      <p className="mt-[14px] text-center text-18 font-normal text-ink-muted">{subtitle}</p>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-[40px] pt-[28px]">
      <p className="text-[19px] font-semibold text-ink">{label}</p>
      <div className={cn('mt-[14px]', PANEL)} style={PANEL_RING}>
        {children}
      </div>
    </div>
  );
}

function Primary({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="px-[40px] pb-[32px] pt-[26px]">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="ml-auto flex h-[52px] items-center justify-center rounded-xl bg-ink px-[26px] text-[17px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {children}
      </button>
    </div>
  );
}

/* ── Ask Agent — 872 ─────────────────────────────────────────────────────── */

export function AskAgentModal({
  day,
  actions,
  onClose,
}: {
  day: string;
  actions: BoardActions | null;
  onClose: () => void;
}) {
  const [rec, setRec] = useState<Recommendation | null | 'none'>(null);

  const load = useCallback(async () => {
    if (!actions) return;
    const res = await invoke<Recommendation>('calendar.recommend_slot', {
      campaignId: actions.campaignId,
      day,
    });
    setRec(res.status === 'succeeded' ? res.output : 'none');
  }, [actions, day]);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = rec !== null && rec !== 'none' ? rec : null;

  return (
    <CalendarModal kind="ask" label={`Ask the agent to plan ${prettyDay(day)}`} onClose={onClose}>
      <Head title="Ask Agent" subtitle="Agent suggests content before creating it" />

      <Section label="Agent Recommendation">
        {rec === null ? (
          <p className="text-[19px] font-medium text-ink-muted">Working out what fits this day…</p>
        ) : rec === 'none' ? (
          <p className="text-[19px] font-medium text-ink-muted">
            {/* A recommendation nobody can produce is a real state — the campaign
                may have nothing left that fits this day — so it says that
                rather than showing an empty panel. */}
            Nothing in this campaign fits this day yet.
          </p>
        ) : (
          <p className="text-[19px] font-medium text-ink">
            {ready?.playbookName ?? ready?.playbookId}
          </p>
        )}
      </Section>

      {/*
        The design's Preview panel lists Format, Hook, CTA and Goal for a post
        that does not exist yet. `calendar.recommend_slot` returns the playbook
        and its `why`, not a drafted hook or CTA — those are written by
        `content.draft`, after this is accepted. So the panel carries the
        reasoning it does have, and the four invented lines are left out.
      */}
      <Section label="Preview">
        <p className="text-[19px] font-medium leading-[1.45] text-ink-muted">
          {ready?.why?.summary ??
            'The hook, CTA and caption are written when this is accepted — the agent picks the format first.'}
        </p>
      </Section>

      <Primary
        disabled={!ready || !actions}
        onClick={() => {
          if (!ready || !actions) return;
          void actions.acceptRecommendation(day, ready.playbookId, ready.mode);
          onClose();
        }}
      >
        Accept &amp; Draft
      </Primary>
    </CalendarModal>
  );
}

/* ── Create Something Specific — 700 ─────────────────────────────────────── */

const OUTPUTS = ['Image', 'Reel', 'Carousel', 'Text'] as const;

export function CreateSpecificModal({
  day,
  actions,
  onClose,
}: {
  day: string;
  actions: BoardActions | null;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [brandKit, setBrandKit] = useState(true);
  const [outputs, setOutputs] = useState<string[]>(['Image']);

  return (
    <CalendarModal
      kind="create"
      label={`Create content for ${prettyDay(day)}`}
      onClose={onClose}
    >
      <Head
        title="Create Something Specific"
        subtitle={`Create with AI or from scratch for ${prettyDay(day)}`}
      />

      <Section label="Enter Prompt">
        <label className="sr-only" htmlFor="cal-create-prompt">
          What should this post be about?
        </label>
        <textarea
          id="cal-create-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="What should this post be about?"
          className="w-full resize-none border-0 bg-transparent text-18 font-medium text-ink outline-none placeholder:text-ink-placeholder"
        />
      </Section>

      <div className="flex flex-wrap items-center gap-x-[34px] gap-y-4 px-[40px] pt-[24px]">
        <span className="flex items-center gap-[12px]">
          <span className="text-18 font-semibold text-ink">Apply Brand Kit</span>
          {/* 45x25 track, a 20px knob at 2.5 or 22.5 — `#3EC332` on. */}
          <button
            type="button"
            role="switch"
            aria-checked={brandKit}
            aria-label="Apply Brand Kit"
            onClick={() => setBrandKit((v) => !v)}
            className="relative h-[25px] w-[45px] shrink-0 rounded-full transition-colors"
            style={{ background: brandKit ? '#3EC332' : 'rgba(12,12,12,0.15)' }}
          >
            <span
              className="absolute top-[2.5px] block h-[20px] w-[20px] rounded-full bg-white transition-[left]"
              style={{ left: brandKit ? 22.5 : 2.5 }}
            />
          </button>
        </span>

        <span className="flex flex-wrap items-center gap-[10px]">
          <span className="text-18 font-semibold text-ink">Outputs:</span>
          {OUTPUTS.map((o) => {
            const on = outputs.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setOutputs((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]))
                }
                className="flex h-[38px] items-center rounded-lg px-[16px] text-16 font-semibold text-ink"
                style={{
                  background: on ? '#FFFFFF' : 'rgba(131,131,131,0.06)',
                  boxShadow: on ? 'inset 0 0 0 1.2px #838383' : 'inset 0 0 0 1px rgba(12,12,12,0.1)',
                }}
              >
                {o}
              </button>
            );
          })}
        </span>
      </div>

      {/*
        The prompt, the brand-kit switch and the output chips are the Draft
        Panel's own trigger phase — it is the component that turns them into a
        draft. So this hands the day over to it rather than posting them
        anywhere: `content.draft` takes a playbook and a genome, not a free-text
        prompt with a list of formats, and pretending otherwise here would build
        a form whose values go nowhere.
      */}
      <Primary
        disabled={!actions}
        onClick={() => {
          actions?.openTriggerFor(day);
          onClose();
        }}
      >
        Create for this date
      </Primary>
    </CalendarModal>
  );
}

/* ── Move existing post — 640 ───────────────────────────────────────────── */

interface Movable {
  contentItemId: string;
  summary: string;
  scheduledAt?: string;
}

export function MoveExistingModal({
  day,
  genomeId,
  actions,
  onClose,
}: {
  day: string;
  genomeId: string | undefined;
  actions: BoardActions | null;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Movable[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;
    void (async () => {
      const res = await invoke<{ items: Movable[] }>('content.list', {
        genomeId,
        status: 'scheduled',
        limit: 100,
      });
      if (cancelled) return;
      setItems(res.status === 'succeeded' ? res.output.items : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId]);

  return (
    <CalendarModal kind="move" label={`Move a post to ${prettyDay(day)}`} onClose={onClose}>
      <Head title="Move existing post" subtitle={`Reschedule another post to ${prettyDay(day)}`} />

      <Section label="Agent recommendation">
        <p className="text-[19px] font-medium leading-[1.45] text-ink-muted">
          {/* The design asserts the agent suggests which post to move. Nothing
              ranks a move — `calendar.recommend_slot` recommends a *playbook*
              for an empty day — so this says what the list below is instead of
              claiming a recommendation behind it. */}
          Pick a scheduled post to reschedule onto this day. Its slot is freed.
        </p>
      </Section>

      <div className="max-h-[240px] overflow-y-auto px-[40px] pt-[20px]">
        {items === null ? (
          <p className="text-16 text-ink-muted">Loading scheduled posts…</p>
        ) : items.length === 0 ? (
          <p className="text-16 text-ink-muted">Nothing is scheduled, so there is nothing to move.</p>
        ) : (
          <ul className="flex flex-col gap-[10px]">
            {items.map((it) => (
              <li key={it.contentItemId}>
                <button
                  type="button"
                  onClick={() => setPicked(it.contentItemId)}
                  aria-pressed={picked === it.contentItemId}
                  className="flex w-full items-center gap-[16px] rounded-2xl bg-white px-[24px] py-[18px] text-left"
                  style={{
                    boxShadow:
                      picked === it.contentItemId
                        ? 'inset 0 0 0 1.6px var(--ss-accent-purple)'
                        : 'inset 0 0 0 1px rgba(12,12,12,0.08)',
                  }}
                >
                  {/* 74x74 well at 24,22 in the design. */}
                  <span
                    aria-hidden
                    className="flex h-[74px] w-[74px] shrink-0 items-center justify-center rounded-xl text-[11px] text-ink-muted"
                    style={{ background: 'rgba(131,131,131,0.1)' }}
                  >
                    no preview
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[19px] font-medium text-ink">{it.summary}</span>
                    {it.scheduledAt ? (
                      <span className="mt-[6px] block text-16 text-ink-muted">
                        Currently {new Date(it.scheduledAt).toLocaleDateString('en', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Primary
        disabled={!picked || !actions}
        onClick={() => {
          if (!picked || !actions) return;
          void actions.acceptMove(day, picked);
          onClose();
        }}
      >
        Move to this date
      </Primary>
    </CalendarModal>
  );
}
