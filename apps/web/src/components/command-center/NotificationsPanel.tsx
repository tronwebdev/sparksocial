'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { relativeTime } from '@/lib/relativeTime';

/**
 * What SPARK has told you — the other half of `PendingQuestionsPanel`.
 *
 * That panel shows questions waiting on an answer. This shows the things that
 * needed no answer but did need saying, and until now nothing showed them at
 * all: `human.notify` wrote rows from P1 onward, the store's only list method
 * filtered `kind = 'ask'`, and so every notification the system produced was
 * invisible. Three real paths were writing into that silence — a post that
 * exhausted its publish retries, a platform token about to expire, and a
 * conversation escalated to a person.
 *
 * ── Why it is a log, not a queue ──────────────────────────────────────────
 *
 * A question is work: it blocks something, it is ordered oldest-first, and
 * answering it removes it. A notification is a record: nothing waits on it, it
 * is ordered newest-first, and reading it does not delete it. Same table, two
 * shapes, and conflating them is how a "you have 47 notifications" badge becomes
 * something people learn to ignore.
 *
 * Read items stay on screen, greyed rather than gone. A token-expiry warning you
 * read yesterday is exactly the thing you want to find again today.
 */

interface Notification {
  messageId: string;
  message: string;
  urgency: 'low' | 'normal' | 'high';
  at: string;
  read: boolean;
  runId?: string;
  /** The transport that accepted it. Absent means it was never delivered anywhere — see below. */
  channel?: string;
}

/**
 * Same restraint as `PendingQuestionsPanel`: `warn` is reserved for genuinely
 * high urgency rather than spent on every row, because a list where everything
 * is highlighted has nothing highlighted.
 */
const URGENCY_TONE: Record<Notification['urgency'], 'neutral' | 'warn'> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warn',
};

export function NotificationsPanel() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  async function load() {
    const res = await invoke<{ notifications: Notification[]; unreadCount: number }>('human.notifications', {
      limit: 20,
    });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      setItems([]);
      return;
    }
    setError(null);
    setItems(res.output.notifications);
    setUnread(res.output.unreadCount);
  }

  useEffect(() => {
    void load();
  }, []);

  async function markAllRead() {
    if (marking || unread === 0) return;
    setMarking(true);
    const res = await invoke<{ unreadCount: number }>('human.notifications.read', { all: true });
    setMarking(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    // Reload rather than patching locally: the tool reports what it actually
    // changed, and another session may have read some of these already.
    await load();
  }

  async function markOneRead(messageId: string) {
    if (marking) return;
    setMarking(true);
    const res = await invoke('human.notifications.read', { messageIds: [messageId] });
    setMarking(false);
    if (res.status === 'succeeded') await load();
  }

  if (items === null) {
    return (
      <div className="grid grid-cols-1 gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-medium text-ink">What SPARK told you</h2>
          {unread > 0 ? <Badge variant="warn">{unread} new</Badge> : null}
        </div>
        {unread > 0 ? (
          <Button size="sm" variant="outline" disabled={marking} onClick={() => void markAllRead()}>
            {marking ? 'Marking…' : 'Mark all read'}
          </Button>
        ) : null}
      </header>

      {error ? <p className="px-4 py-3 text-[12px] text-destructive">{error}</p> : null}

      {items.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-ink-muted">
          Nothing yet. SPARK posts here when something needs your attention but not your answer — a post that
          stopped retrying, a platform login about to expire, a conversation it handed to you.
        </p>
      ) : (
        <ul className="grid grid-cols-1">
          {items.map((n) => (
            <li
              key={n.messageId}
              className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] ${n.read ? 'text-ink-muted' : 'text-ink'}`}>{n.message}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                  <span>{relativeTime(n.at)}</span>
                  {n.urgency === 'high' ? <Badge variant={URGENCY_TONE[n.urgency]}>Urgent</Badge> : null}
                  {/*
                    Absent `channel` is the honest state and worth showing: it
                    means this was written to the inbox and never delivered
                    anywhere else. WhatsApp delivery exists as a transport but
                    nothing routes notifications to it, so "in the app only" is
                    the truth for every row today rather than a bug in this view.
                  */}
                  <span>{n.channel ? `sent via ${n.channel}` : 'in the app only'}</span>
                </div>
              </div>
              {!n.read ? (
                <Button size="sm" variant="outline" disabled={marking} onClick={() => void markOneRead(n.messageId)}>
                  Mark read
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
