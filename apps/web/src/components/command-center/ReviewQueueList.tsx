'use client';

import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { toolLabel } from '@sparksocial/shared/toolLabel';

/**
 * "Waiting on you" — the *review* queue: calls `invokeTool` gated on the
 * approval ladder, waiting on `approval.decide`.
 *
 * It is not the design's "What is your Agent doing next?" card, and conflating
 * the two is a distinction a real queue cannot afford to lose: that card is
 * already-scheduled posts, which need no decision, and this is work that has
 * stopped until a person says yes. `PlanQueue` is the other one.
 *
 * ── It wears that card's clothes, though ──────────────────────────────────
 *
 * This was `rounded-xl border border-border bg-surface p-6` with an 18px
 * heading and bordered rows — a different card from every other panel on the
 * screen, on a screen whose panels are all one card. So it takes the Queue
 * card's treatment: white at radius 15, a 20px/600 heading with an info glyph
 * over a `rgba(131,131,131,0.15)` hairline at y=70, and full-bleed rows on
 * `rgba(131,131,131,0.12)` rules. The *contents* stay its own — these rows
 * carry a decision, not a schedule.
 */

export interface ReviewItem {
  callId: string;
  tool: string;
  ruleId?: string;
  reason?: string;
  requestedAt: string;
  requestedBy?: string;
  genomeId?: string;
  input: unknown;
}

export function ReviewQueueList({
  items,
  onDecide,
}: {
  items: ReviewItem[] | null;
  onDecide: (callId: string, decision: 'approve' | 'reject') => Promise<void>;
}) {
  const [deciding, setDeciding] = useState<string | null>(null);

  async function decide(callId: string, decision: 'approve' | 'reject') {
    setDeciding(callId);
    await onDecide(callId, decision);
    setDeciding(null);
  }

  if (items === null) return <Skeleton className="h-40 w-full rounded-lg" />;

  return (
    <section id="review-queue" className="overflow-hidden rounded-lg bg-white">
      {/* The Queue card's header band: 70 tall, heading at 20,24. */}
      <div className="flex items-start gap-3 px-5 pb-[20.4px] pt-6">
        <h2 className="text-20 font-semibold leading-[1.28] text-ink">Waiting on you</h2>
        <span
          title="Work your agent has stopped and is holding until you decide. Approving here runs the call it was gated on."
          className="mt-1 flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
          style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
        >
          i
        </span>
        {items.length > 0 ? (
          <span className="ml-auto shrink-0 text-16 font-medium text-warn">
            {items.length} held
          </span>
        ) : null}
      </div>

      <div className="h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />

      {items.length === 0 ? (
        <p className="px-5 py-[26px] text-16 text-ink-muted">Nothing is held for review right now.</p>
      ) : (
        <ul>
          {items.map((item, i) => (
            <li
              key={item.callId}
              className="relative flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-[22px]"
              style={{ borderTop: i === 0 ? undefined : '1px solid rgba(131,131,131,0.12)' }}
            >
              <div className="min-w-0 flex-1">
                {/*
                  The description, not the identifier. This row once asked a brand
                  owner to approve `recipe.delete` — consent to something it had
                  not described. The tool name stays reachable underneath, because
                  a person reporting a defect needs it; it is just not the primary
                  text.
                */}
                <p className="truncate text-20 font-semibold leading-[1.28] text-ink">
                  {toolLabel(item.tool)}
                </p>
                <p className="mt-[9px] truncate text-16 text-ink-muted">
                  {item.reason ?? `Held by ${item.ruleId ?? 'the approval ladder'}`}
                  {' · '}
                  {new Date(item.requestedAt).toLocaleString('en', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <p className="mt-[4px] truncate font-mono text-[11px] text-ink-muted">{item.tool}</p>
              </div>

              {/*
                The Queue card's own 37x37 action buttons, so a decision row reads
                like a schedule row — but these two are real, which is the one
                difference that matters: `approval.decide` is keyed on exactly the
                `callId` these rows carry.
              */}
              <div className="flex shrink-0 items-center gap-[10px]">
                <button
                  type="button"
                  disabled={deciding === item.callId}
                  onClick={() => void decide(item.callId, 'approve')}
                  aria-label="Approve"
                  title={deciding === item.callId ? 'Working…' : 'Approve and run this call'}
                  className="flex h-[37px] w-[37px] items-center justify-center rounded-lg border-0 disabled:opacity-50"
                  style={{ background: '#3EC332' }}
                >
                  <svg width="15" height="12" viewBox="0 0 16 12" fill="none" aria-hidden>
                    <path
                      d="m1 6 4.5 4.5L15 1"
                      stroke="#FFFFFF"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={deciding === item.callId}
                  onClick={() => void decide(item.callId, 'reject')}
                  aria-label="Reject"
                  title="Reject — the call will not run"
                  className="flex h-[37px] w-[37px] items-center justify-center rounded-lg border-0 bg-transparent disabled:opacity-50"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(243,85,37,0.6)' }}
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path
                      d="M2 2l10 10M12 2 2 12"
                      stroke="#F35525"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
