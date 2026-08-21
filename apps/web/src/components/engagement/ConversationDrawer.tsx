'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';

/**
 * `ENG-02.4` — the conversation drawer.
 *
 *   *"Sales Opportunities (hot/warm/cold + recommended action + conversation
 *   drawer)"*
 *
 * The feed shows one message with its classification and a suggested reply, and
 * the thing it could not show is the exchange the message sits in — which is
 * exactly what decides whether a "hot" lead is real. "Do you deliver?" reads
 * lukewarm alone and hot as the fourth message in a conversation about a wedding
 * date.
 *
 * ── Right-hand sheet, not an expanding card ───────────────────────────────
 *
 * A card that grows pushes every other card down, so opening one loses your
 * place in a feed you were triaging. A drawer keeps the list still, which is the
 * whole reason §8.8 calls it a drawer.
 *
 * ── Both sides, visibly different ─────────────────────────────────────────
 *
 * Inbound turns sit left on the surface colour, outbound right on the accent —
 * the arrangement every messaging app uses, because the alternative is a
 * transcript where you cannot tell who said the thing you are annoyed about. An
 * unattended reply is labelled as one: SPARK sent it with nobody reading first,
 * and that is worth knowing while judging what to say next.
 */

interface Turn {
  direction: 'inbound' | 'outbound';
  at: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  messageId: string;
  category?: string;
  intentScore?: number;
  status?: string;
}

interface Thread {
  threadKey: string;
  platform: string;
  kind: string;
  authorHandle: string;
  authorName?: string;
  turns: Turn[];
  messageCount: number;
  truncated: boolean;
  single: boolean;
  why: Explanation;
}

const KIND_LABEL: Record<string, string> = {
  comment: 'comments',
  dm: 'DMs',
  story_reply: 'story replies',
};

export function ConversationDrawer({
  genomeId,
  messageId,
  onClose,
}: {
  genomeId: string | undefined;
  /** The feed card that was opened. Undefined closes the drawer. */
  messageId: string | undefined;
  onClose: () => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!messageId || !genomeId) return;
    let cancelled = false;

    void (async () => {
      setThread(null);
      setError(null);
      const res = await invoke<Thread>('engage.thread', { genomeId, messageId, limit: 50 });
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
        return;
      }
      setThread(res.output);
    })();

    return () => {
      cancelled = true;
    };
  }, [genomeId, messageId]);

  // Escape closes it. A drawer over a list needs a way out that is not a
  // specific pixel, and the sheet has no form to lose by closing.
  useEffect(() => {
    if (!messageId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [messageId, onClose]);

  if (!messageId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Conversation">
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="flex-1 bg-black/40" onClick={onClose} />

      <aside className="flex h-full w-[520px] max-w-full flex-col bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold text-ink">
              {thread?.authorName ?? thread?.authorHandle ?? 'Conversation'}
            </p>
            {thread ? (
              <p className="mt-0.5 text-[13px] text-ink-muted">
                {thread.messageCount} {KIND_LABEL[thread.kind] ?? thread.kind} on{' '}
                <span className="capitalize">{thread.platform}</span>
                {thread.authorName ? ` · ${thread.authorHandle}` : ''}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-[14px] text-ink-muted hover:text-ink"
            aria-label="Close conversation"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

          {thread === null && !error ? (
            <div className="grid grid-cols-1 gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : null}

          {thread?.single ? (
            <p className="mb-3 rounded-lg border border-border bg-surface-muted px-3 py-2 text-[13px] text-ink-muted">
              This message arrived before SPARK tracked conversations, so there is nothing to thread it to. The
              next message from this person will be.
            </p>
          ) : null}

          {thread?.truncated ? (
            <p className="mb-3 text-[12px] text-ink-muted">
              Showing the most recent 50 messages — older ones are not loaded.
            </p>
          ) : null}

          {thread ? (
            <ol className="grid grid-cols-1 gap-3">
              {thread.turns.map((turn, i) => (
                <li
                  key={`${turn.messageId}-${turn.direction}-${i}`}
                  className={cn('flex', turn.direction === 'outbound' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5',
                      turn.direction === 'outbound'
                        ? 'bg-primary/10 text-ink'
                        : 'border border-border bg-surface-muted text-ink',
                    )}
                  >
                    <p className="whitespace-pre-wrap text-[14px]">{turn.text}</p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] tabular-nums text-ink-muted">
                        {new Date(turn.at).toLocaleString('en', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>

                      {turn.direction === 'outbound' ? (
                        <span className="text-[11px] text-ink-muted">
                          {/* The distinction the status enum keeps and a
                              transcript would otherwise flatten: nobody read an
                              auto-handled reply before it went out. */}
                          {turn.status === 'auto_handled' ? 'sent by SPARK, unattended' : 'sent'}
                        </span>
                      ) : null}

                      {turn.direction === 'inbound' && typeof turn.intentScore === 'number' ? (
                        <Badge variant={turn.intentScore >= 0.7 ? 'success' : 'neutral'}>
                          Intent {Math.round(turn.intentScore * 100)}%
                        </Badge>
                      ) : null}
                      {turn.direction === 'inbound' && turn.category ? (
                        <Badge variant="neutral">{turn.category.replace(/_/g, ' ')}</Badge>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </div>

        {thread ? (
          <footer className="border-t border-border px-6 py-3">
            {/* How these messages came to be one conversation is a rule, not a
                fact — a merged or fragmented thread looks like data and is
                actually a judgement, so it carries its own reasoning. */}
            <WhyPopover why={thread.why} className="mt-0" />
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
