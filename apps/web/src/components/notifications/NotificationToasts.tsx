'use client';

import { useRouter } from 'next/navigation';
import { useNotifications } from '@/lib/notifications';
import { TOPIC, TopicTile } from './topics';

/**
 * The in-app toast — the first of the user's three screenshots.
 *
 * Bottom-right of the app frame: a white card with the topic tile on the left,
 * a title and one line of detail, and Review / Dismiss beneath. Mounted once,
 * in the root layout, so every route has it without any screen opting in.
 *
 * ── No auto-dismiss ───────────────────────────────────────────────────────
 *
 * The design draws an explicit Dismiss, which settles it: a toast that removes
 * itself after four seconds is fine for "saved" and wrong for "your carousel is
 * ready to review" — the whole point is that it survives you looking away. The
 * stack is capped at three instead (see `toast()` in `lib/notifications.tsx`),
 * which is what stops a burst from covering the page.
 *
 * Review marks the row read and opens what it is about; Dismiss only takes it
 * off the screen — it stays in the bell, unread, because dismissing a toast is
 * not the same as having dealt with the thing.
 */
export function NotificationToasts() {
  const { toasts, dismissToast, markRead } = useNotifications();
  const router = useRouter();

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-[26px] right-[26px] z-[120] flex w-[352px] max-w-[calc(100vw-32px)] flex-col gap-[12px]"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const visual = TOPIC[t.topic] ?? TOPIC.generic;
        const canReview = visual.actionable && !!t.target;
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto relative animate-toast-in rounded-[16px] bg-white p-[16px] motion-reduce:animate-none"
            style={{ boxShadow: '0 24px 60px -24px rgba(12,12,12,0.45), inset 0 0 0 1px rgba(131,131,131,0.14)' }}
          >
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Close notification"
              className="absolute right-[10px] top-[10px] flex h-[24px] w-[24px] items-center justify-center rounded-full transition-colors hover:bg-[rgba(131,131,131,0.12)]"
            >
              <svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden>
                <path d="m1 1 9 9m0-9-9 9" stroke="#838383" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>

            <div className="flex items-start gap-[13px] pr-[22px]">
              <TopicTile topic={t.topic} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-[1.3] text-ink">{t.title}</p>
                {t.body ? (
                  <p className="mt-[3px] line-clamp-2 text-[13px] leading-[1.4] text-ink-muted">{t.body}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-[13px] flex items-center justify-end gap-[9px]">
              {canReview ? (
                <button
                  type="button"
                  onClick={() => {
                    if (t.messageId) void markRead(t.messageId);
                    dismissToast(t.id);
                    /* `?draft=` and not `?review=`: the Command Center reads
                       exactly one deep-link param and it opens the draft panel
                       for that content item, which is what reviewing one is.
                       See `app/(cc)/agents/page.tsx`. */
                    router.push(`/agents?draft=${encodeURIComponent(t.target!.id)}`);
                  }}
                  className="h-[34px] rounded-[9px] px-[16px] text-[13.5px] font-semibold text-ink transition-colors hover:bg-[rgba(131,131,131,0.08)]"
                  style={{ boxShadow: 'inset 0 0 0 1.2px rgba(12,12,12,0.5)' }}
                >
                  Review
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="h-[34px] rounded-[9px] px-[16px] text-[13.5px] font-medium transition-colors hover:bg-[rgba(131,131,131,0.08)]"
                style={{ color: '#5B5B5B', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
