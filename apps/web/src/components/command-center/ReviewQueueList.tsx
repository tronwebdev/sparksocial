'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The prototype's "What is your Agent doing next?" queue card (`SparkSocial
 * Command Center.dc.html:143-186`), narrowed to what it actually is: the
 * *review* queue — items `invokeTool` gated on the approval ladder, waiting
 * on `approval.decide`. The mockup's rows mix this with already-scheduled
 * posts (a "send" action, a thumbnail carousel); those are `CampaignFocusCard`'s
 * "what the agent is doing next" list instead, because they need no decision
 * — conflating "blocked on you" with "already happening" is exactly the
 * distinction a real queue can't afford to lose.
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

  if (items === null) return <Skeleton className="h-40 w-full rounded-xl" />;

  return (
    <section id="review-queue" className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Waiting on you</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-[14px] text-ink-muted">Nothing is held for review right now.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3">
          {items.map((item) => (
            <li
              key={item.callId}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-border p-4"
            >
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-ink">
                  <code className="rounded bg-surface-muted px-1.5 py-0.5 text-[12px]">{item.tool}</code>
                </p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  {item.reason ?? `Held by ${item.ruleId ?? 'the approval ladder'}`}
                  {' · '}
                  {new Date(item.requestedAt).toLocaleString('en', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={deciding === item.callId}
                  onClick={() => void decide(item.callId, 'reject')}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={deciding === item.callId}
                  onClick={() => void decide(item.callId, 'approve')}
                >
                  {deciding === item.callId ? 'Working…' : 'Approve'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
