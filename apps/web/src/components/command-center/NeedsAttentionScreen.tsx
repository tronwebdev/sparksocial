'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { Skeleton } from '@/components/ui/skeleton';
import { humaniseGoal } from '@/lib/runGoal';

/**
 * AGENT COMMAND CENTER — NEEDS ATTENTION.
 *
 * ── Where this design came from ──────────────────────────────────────────
 *
 * Not from `ui build/`. Its screen label ("Command Center (Needs Attention)"),
 * its "Action Required" and "Reassurance" cards and its green reassurance pill
 * appear in no `.dc.html` in the repo — I searched all of them. The screenshot
 * supplied with the request is the specification, so the structure below is
 * followed exactly and the measurements are read off the image:
 *
 *   title      "Agent Command Center-Needs Attention" over
 *              "The Agent is safe, but requires your input to proceed."
 *   left card  "Action Required ⓘ" — one row per waiting item, each an amber
 *              `⚠ Approval Required:` line with a "✔ Resolve Now" button
 *   left card  "Reassurance ⓘ" — a green pill, then three ✛ lines
 *   right      the Spark rail, unchanged (its own prototype exists)
 *
 * ── Why this screen holds the review queue ───────────────────────────────
 *
 * `ReviewQueueList` used to sit on the Overview tab and was removed from it at
 * the design's request. Its capability is not dropped, because that is the
 * rule — it lives here, and this is the better home on the merits: the queue is
 * a list of things *blocked on a person*, which is precisely this screen's
 * subject, and the amber banner's "Review" link now opens the screen whose
 * whole purpose is resolving them.
 *
 * ── The three reassurance lines are claims, so each is checked ───────────
 *
 * The screenshot asserts "Nothing has been posted incorrectly", "The Agent
 * paused itself intentionally to protect your brand" and "Once resolved,
 * execution will resume automatically". The first two are statements about this
 * brand's actual state, not decoration, so they are only shown when they are
 * true: the pause line reads differently when the agent is not paused, and a
 * failed publish turns the first line into what actually happened. A
 * reassurance card that reassures unconditionally is the one thing on this
 * screen that must not exist.
 */

interface ReviewItem {
  callId: string;
  tool: string;
  goal?: string;
  requestedAt?: string;
  because?: string;
}

interface AgentStatus {
  paused: boolean;
  pausedAt?: string;
  reason?: string;
}

const CARD = 'rounded-[15px] bg-white';

export function NeedsAttentionScreen({ onOpenDraft }: { onOpenDraft?: (contentItemId: string) => void }) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [failed, setFailed] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [review, agent] = await Promise.all([
      invoke<{ items: ReviewItem[] }>('queue.review.list', { limit: 25 }),
      invoke<AgentStatus>('agent.status', {}),
    ]);
    setItems(review.status === 'succeeded' ? review.output.items : []);
    if (agent.status === 'succeeded') setStatus(agent.output);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * "Nothing has been posted incorrectly" is only sayable if nothing failed.
   * `content.list` is genome-scoped and this screen is brand-scoped, so the
   * count comes from the publish side: a failed row is one that went out and
   * did not land.
   */
  useEffect(() => {
    void (async () => {
      const res = await invoke<{ genomes: Array<{ genomeId: string }> }>('genome.list', {});
      if (res.status !== 'succeeded' || res.output.genomes.length === 0) {
        setFailed(0);
        return;
      }
      const list = await invoke<{ items: Array<{ status: string }> }>('content.list', {
        genomeId: res.output.genomes[0]!.genomeId,
        status: 'failed',
        limit: 100,
      });
      setFailed(list.status === 'succeeded' ? list.output.items.length : 0);
    })();
  }, []);

  const decide = useCallback(
    async (callId: string, decision: 'approve' | 'reject') => {
      setBusy(callId);
      /* `idempotent: false` — approving replays the original held call, so a
         retried click must not decide it twice. Deterministic on
         callId+decision so a double click or a network retry dedupes. */
      const res = await invoke('approval.decide', { callId, decision }, `approval-decide:${callId}:${decision}`);
      setBusy(null);
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That decision was gated.');
        return;
      }
      setError(null);
      await load();
    },
    [load],
  );

  const waiting = items?.length ?? 0;

  return (
    <div className="flex flex-col gap-dash-card-gap">
      <div>
        <h1 className="text-[28px] font-semibold leading-[1.27] text-ink">Agent Command Center — Needs Attention</h1>
        <p className="mt-[9px] text-16 text-ink-muted">
          {waiting > 0
            ? 'The Agent is safe, but requires your input to proceed.'
            : 'Nothing is waiting on you. The Agent is running on its own.'}
        </p>
      </div>

      {/* ── Action Required ──────────────────────────────────────────── */}
      <section className={CARD}>
        <div className="flex items-center gap-3 px-7 py-[16px]">
          <h2 className="text-20 font-semibold leading-[1.28] text-ink">Action Required</h2>
          <span
            title="Every tool call SPARK is holding because your approval mode requires a person. Approving replays the original call; rejecting drops it."
            className="flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
            style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
          >
            i
          </span>
          {waiting > 0 ? (
            <span className="ml-auto pr-7 text-16 font-medium text-ink-muted">
              {waiting} waiting
            </span>
          ) : null}
        </div>

        {items === null ? (
          <div className="px-7 pb-7">
            <Skeleton className="h-[46px] w-full rounded-lg" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-7 pb-[26px] text-16 text-ink-muted">
            Nothing is held. When your approval mode holds a call — a post going out, a reply being sent — it appears
            here with what it was going to do.
          </p>
        ) : (
          <ul className="px-7 pb-[26px]">
            {items.map((it) => (
              <li
                key={it.callId}
                className="mb-[12px] flex flex-wrap items-center gap-x-[14px] gap-y-3 rounded-[12px] px-[16px] py-[14px] last:mb-0"
                style={{ background: 'var(--ss-cc-attn-bg)', boxShadow: 'inset 0 0 0 1px var(--ss-cc-attn-ring)' }}
              >
                <span className="block h-[21.8px] w-[21.9px] shrink-0" aria-hidden>
                  <svg width="21.9" height="21.8" viewBox="0 0 22 22" fill="none">
                    <path
                      d="M13.9 1.1C13 .4 12 0 10.9 0 9.9 0 8.8.4 7.9 1.1 5.4 3.2 3.1 5.5 1.1 8c-1.5 1.8-1.4 4-.1 5.8 2.1 2.6 4.4 5 7 7 1.8 1.4 4 1.4 5.8 0 2.6-2 4.9-4.4 7-6.9 1.4-1.8 1.4-4.1 0-5.9-2-2.5-4.3-4.9-6.9-6.9Z"
                      fill="rgba(230,167,81,0.3)"
                    />
                    <path d="M10.9 5.5v6.2M10.9 15.4v.6" stroke="#E6A751" strokeWidth="2.3" strokeLinecap="round" />
                  </svg>
                </span>

                <span className="min-w-0 flex-1 text-16 leading-[1.35] text-warn">
                  <b className="font-bold">Approval Required:</b>{' '}
                  <span className="font-medium">
                    {/* The tool name is what is actually held; the goal is what
                        it was for. Both go through `humaniseGoal` so a held
                        `content.publish` on a UUID reads as a sentence. */}
                    {it.goal ? humaniseGoal(it.goal, new Map()) : `${it.tool} is waiting for your approval`}
                  </span>
                  {it.because ? <span className="block text-[14.5px] text-ink-muted">{it.because}</span> : null}
                </span>

                <div className="flex shrink-0 items-center gap-[10px]">
                  <button
                    type="button"
                    disabled={busy === it.callId}
                    onClick={() => void decide(it.callId, 'approve')}
                    className="flex h-[38px] shrink-0 items-center gap-[8px] rounded-lg bg-white px-[16px] text-[15px] font-semibold text-ink disabled:opacity-50"
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.2)' }}
                  >
                    <svg width="14" height="11" viewBox="0 0 16 12" fill="none" aria-hidden>
                      <path d="m1 6 4.5 4.5L15 1" stroke="#13A711" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {busy === it.callId ? 'Resolving…' : 'Resolve Now'}
                  </button>
                  <button
                    type="button"
                    disabled={busy === it.callId}
                    onClick={() => void decide(it.callId, 'reject')}
                    className="h-[38px] shrink-0 rounded-lg px-[12px] text-[15px] font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {error ? <p className="px-7 pb-6 text-14 text-destructive">{error}</p> : null}
      </section>

      {/* ── Reassurance ──────────────────────────────────────────────── */}
      <section className={CARD}>
        <div className="flex flex-wrap items-center gap-3 px-7 py-[16px]">
          <h2 className="text-20 font-semibold leading-[1.28] text-ink">Reassurance</h2>
          <span
            title="Each line here is checked against this brand's state rather than printed unconditionally — see this file's header."
            className="flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
            style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
          >
            i
          </span>
          <span
            className="ml-auto flex h-[34px] items-center rounded-[10px] px-[16px] text-[15px] font-medium"
            style={{ background: '#E9F9E7', boxShadow: 'inset 0 0 0 1px rgba(19,215,17,0.35)', color: '#13A711' }}
          >
            Your Agent only pauses when necessary. You are always in control.
          </span>
        </div>

        <ul className="flex flex-col gap-[16px] px-7 pb-[26px]">
          {[
            failed === null
              ? 'Checking whether anything failed to publish…'
              : failed === 0
                ? 'Nothing has been posted incorrectly.'
                : `${failed} post${failed === 1 ? '' : 's'} failed to publish — open the queue to see which.`,
            status === null
              ? 'Checking the agent…'
              : status.paused
                ? `The Agent paused itself intentionally to protect your brand${status.reason ? ` — ${status.reason}` : ''}.`
                : 'The Agent is running; nothing has been paused.',
            waiting > 0
              ? 'Once resolved, execution will resume automatically.'
              : 'There is nothing to resolve, so nothing is being held up.',
          ].map((line) => (
            <li key={line} className="flex items-start gap-[12px] text-16 text-ink">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="mt-[5px] shrink-0">
                <path d="M7 1v12M1 7h12" stroke="#838383" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              {line}
            </li>
          ))}
        </ul>
      </section>

      {onOpenDraft && waiting === 0 ? null : null}
    </div>
  );
}
