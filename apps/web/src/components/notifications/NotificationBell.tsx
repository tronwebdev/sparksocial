'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications, splitMessage } from '@/lib/notifications';
import { relativeTime } from '@/lib/relativeTime';
import { TOPIC, TopicTile } from './topics';

/**
 * The bell and the notification centre — the user's third screenshot.
 *
 * The bell lives in `AskSpark`'s header block, which is the one control every
 * screen's chrome already renders (Dashboard, Command Center, Calendar,
 * Discovery, Assets, Settings, Account Home). Putting it there is what makes
 * "add the bell to the other pages" one change rather than nineteen, and it is
 * where the screenshot puts it: immediately left of the avatar.
 *
 * The panel is a dropdown, not a drawer: it is a list you glance at and close,
 * and the screenshot draws it hanging off the bell with the page still visible
 * behind. 344 wide, radius 16, one 68px row per notification.
 *
 * ── The unread dot, and what reading means ────────────────────────────────
 *
 * Opening the panel does not mark everything read — that would make the badge a
 * lie about what you have looked at, and it is the thing that turns a badge into
 * noise. A row is read when you act on it, or when you press "Mark all read".
 * Read rows stay, greyed: a token-expiry warning from yesterday is exactly what
 * you want to find again today.
 */
export function NotificationBell({ compact = false }: { compact?: boolean }) {
  const { items, unreadCount, loading, refresh, markAllRead, markRead, requestOsPermission, osPermission } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const size = compact ? 44 : 48;

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            void refresh();
            /* The one place the OS permission may be asked: inside a click.
               Browsers refuse a request made on load, and Chrome holds the
               refusal against the origin permanently. */
            if (osPermission === 'default') void requestOsPermission();
          }
        }}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative flex items-center justify-center rounded-full bg-white transition-colors hover:bg-[#F4F5F7]"
        style={{ width: size, height: size, boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.22)' }}
      >
        <svg width="19" height="20" viewBox="0 0 19 20" fill="none" aria-hidden>
          <path
            d="M9.5 2.2a5.6 5.6 0 0 0-5.6 5.6c0 3.6-1.4 4.8-1.4 4.8h14s-1.4-1.2-1.4-4.8A5.6 5.6 0 0 0 9.5 2.2Z"
            stroke="#0C0C0C"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M11.3 15.4a2 2 0 0 1-3.6 0" stroke="#0C0C0C" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {unreadCount > 0 ? (
          <span
            aria-hidden
            className="absolute right-[9px] top-[9px] flex min-w-[17px] items-center justify-center rounded-full px-[4px] text-[10.5px] font-bold text-white"
            style={{ height: 17, background: '#F35525' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-[calc(100%+10px)] z-[110] w-[344px] max-w-[calc(100vw-32px)] animate-menu-in overflow-hidden rounded-[16px] bg-white motion-reduce:animate-none"
          style={{ boxShadow: '0 26px 64px -26px rgba(12,12,12,0.45), inset 0 0 0 1px rgba(131,131,131,0.14)' }}
        >
          <div className="flex items-center justify-between px-[16px] pb-[10px] pt-[14px]">
            <p className="text-[15px] font-bold text-ink">Notifications</p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-[12.5px] font-semibold transition-opacity hover:opacity-70"
                style={{ color: '#2F8291' }}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[420px] overflow-y-auto pb-[8px]">
            {items === null && loading ? (
              <p className="px-[16px] py-[26px] text-center text-[13px] text-ink-muted">Loading…</p>
            ) : (items?.length ?? 0) === 0 ? (
              <p className="px-[22px] py-[26px] text-center text-[13px] leading-[1.5] text-ink-muted">
                Nothing yet. SPARK tells you here when a post is ready to review, when something
                publishes, and when something needs you.
              </p>
            ) : (
              <ul>
                {items!.map((n) => {
                  const { title, body } = splitMessage(n.message);
                  const topic = n.topic ?? 'generic';
                  const canReview = (TOPIC[topic] ?? TOPIC.generic).actionable && !!n.target;
                  return (
                    <li key={n.messageId}>
                      <div
                        className="flex w-full items-start gap-[12px] px-[16px] py-[11px] transition-colors hover:bg-[rgba(131,131,131,0.05)]"
                        style={{ opacity: n.read ? 0.62 : 1 }}
                      >
                        <TopicTile topic={topic} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-ink" title={title}>
                            {title}
                          </p>
                          {body ? (
                            <p className="mt-[2px] line-clamp-2 text-[12.5px] leading-[1.4] text-ink-muted">{body}</p>
                          ) : null}
                          {canReview ? (
                            <button
                              type="button"
                              onClick={() => {
                                void markRead(n.messageId);
                                setOpen(false);
                                /* Same deep link the chat drawer uses — see
                                   `NotificationToasts`. */
                                router.push(`/agents?draft=${encodeURIComponent(n.target!.id)}`);
                              }}
                              className="mt-[6px] h-[26px] rounded-[7px] px-[10px] text-[12px] font-semibold text-ink transition-colors hover:bg-[rgba(131,131,131,0.1)]"
                              style={{ boxShadow: 'inset 0 0 0 1.1px rgba(12,12,12,0.4)' }}
                            >
                              Review
                            </button>
                          ) : null}
                        </div>
                        <span className="shrink-0 pt-[2px] text-[11.5px]" style={{ color: '#9A9A9A' }}>
                          {relativeTime(n.at)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Only when the browser has actually refused. Saying "turn on
              notifications" to somebody who already has is noise. */}
          {osPermission === 'denied' ? (
            <p className="border-t px-[16px] py-[9px] text-[11.5px] leading-[1.4] text-ink-muted" style={{ borderColor: 'rgba(131,131,131,0.16)' }}>
              Your browser is blocking desktop notifications, so these only appear here while
              SparkSocial is open.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
