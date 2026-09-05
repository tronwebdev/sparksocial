'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { invoke } from './tools';

/**
 * ONE notification system, for the whole app.
 *
 * Three surfaces, one source of truth:
 *
 *   the toast     bottom-right, while you are looking at the app
 *   the OS        a browser/Windows notification, while you are not
 *   the centre    the bell's list, for everything that has happened
 *
 * They are the same events. The provider polls `human.notifications` — the feed
 * `human.notify` has been writing into since P1 — works out which rows are new
 * since the last poll, and routes each one to *exactly one* of the first two
 * depending on whether this tab is visible. Everything lands in the third
 * regardless.
 *
 * ── Why the visible/hidden split, rather than both ────────────────────────
 *
 * A toast and an OS banner for the same event is the failure mode everybody
 * has lived with: the thing pops twice, so people turn the OS one off, and
 * then they miss the ones that mattered while they were in another window.
 * `document.visibilityState` is the one signal that says which of the two the
 * person can actually see, so it picks, and only one fires.
 *
 * ── Why polling ───────────────────────────────────────────────────────────
 *
 * There is no socket or SSE surface on the API, and `apps/web` may not add one
 * — every capability goes through `POST /v1/tools/:name` (CLAUDE.md § Frontend
 * rules). So this polls, slowly, and leans on the focus event for the case
 * that actually matters: coming back to the tab and wanting it to be current.
 * When a push channel exists, this provider is the only thing that changes.
 *
 * ── Why the first poll never toasts ───────────────────────────────────────
 *
 * The first response is a baseline, not news. Without that, opening the app
 * would fire a toast for every unread notification of the last week, which is
 * how a notification system teaches people to dismiss without reading.
 */

export type NotificationTopic =
  | 'content_ready'
  | 'published'
  | 'failed'
  | 'queued'
  | 'connection'
  | 'generic';

export interface AppNotification {
  messageId: string;
  message: string;
  urgency: 'low' | 'normal' | 'high';
  at: string;
  read: boolean;
  topic?: NotificationTopic;
  target?: { type: 'content_item'; id: string };
  runId?: string;
  channel?: string;
}

/** A toast on screen right now. Local — it may or may not have a feed row behind it. */
export interface Toast {
  id: string;
  title: string;
  body?: string;
  topic: NotificationTopic;
  /** Present when there is somewhere for "Review" to go. */
  target?: { type: 'content_item'; id: string };
  messageId?: string;
}

interface NotificationsApi {
  items: AppNotification[] | null;
  unreadCount: number;
  loading: boolean;
  /** Re-read the feed now — after acting on something, or on demand. */
  refresh: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (messageId: string) => Promise<void>;
  /** Raise a toast from anywhere in the app, for something local and immediate. */
  toast: (t: Omit<Toast, 'id'>) => void;
  toasts: Toast[];
  dismissToast: (id: string) => void;
  /**
   * Ask the browser for permission to show OS notifications. Must be called
   * from a user gesture — browsers refuse (and Chrome permanently blocks) a
   * request made on load, which is why nothing here asks by itself.
   */
  requestOsPermission: () => Promise<void>;
  osPermission: NotificationPermission | 'unsupported';
}

const NotificationsContext = createContext<NotificationsApi | null>(null);

const POLL_MS = 45_000;

/**
 * The first line of a notification is its title and the rest is its body.
 *
 * `human.notify` takes one string, because it was written for WhatsApp where
 * that is all there is. The screens want a heading and a detail line, so the
 * split happens here rather than by adding a column no producer fills: the
 * first sentence is the heading, the remainder is the detail, and a one-
 * sentence message is a heading with no detail. That is a presentation rule,
 * which is where it belongs.
 */
export function splitMessage(message: string): { title: string; body?: string } {
  const trimmed = message.trim();
  const cut = trimmed.search(/(?<=[.!?])\s/);
  if (cut === -1 || cut > 90) return { title: trimmed };
  return { title: trimmed.slice(0, cut + 1).trim(), body: trimmed.slice(cut + 1).trim() };
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, orgId } = useAuth();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [osPermission, setOsPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');

  /** Ids already accounted for. The first poll fills it without announcing anything. */
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setOsPermission(Notification.permission);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `t_${Math.random().toString(36).slice(2, 9)}`;
    /* Three at a time. A stack taller than that covers the thing it is telling
       you about, and the rest are in the bell anyway. */
    setToasts((cur) => [...cur.slice(-2), { ...t, id }]);
  }, []);

  const announce = useCallback(
    (n: AppNotification) => {
      const { title, body } = splitMessage(n.message);
      const topic = n.topic ?? 'generic';

      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (visible) {
        toast({ title, ...(body ? { body } : {}), topic, ...(n.target ? { target: n.target } : {}), messageId: n.messageId });
        return;
      }

      if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
        /* No permission and the tab is hidden: it stays in the bell, which is
           the whole reason the bell exists. Nothing is lost, and nothing is
           faked by toasting into a tab nobody is looking at. */
        return;
      }
      try {
        const os = new Notification(title, {
          ...(body ? { body } : {}),
          /* Collapses repeats of the same event rather than stacking them. */
          tag: n.messageId,
          icon: '/icon.png',
        });
        os.onclick = () => {
          window.focus();
          os.close();
        };
      } catch {
        /* Some browsers throw here on mobile, where the Notification
           constructor is only allowed from a service worker. The row is in the
           bell either way. */
      }
    },
    [toast],
  );

  const refresh = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    const res = await invoke<{ notifications: AppNotification[]; unreadCount: number }>(
      'human.notifications',
      { limit: 20 },
    );
    setLoading(false);
    if (res.status !== 'succeeded') {
      /* A brand that has never been selected, or a gated read — either way the
         bell shows nothing rather than an error nobody can act on. */
      setItems((cur) => cur ?? []);
      return;
    }

    const rows = res.output.notifications;
    setItems(rows);
    setUnreadCount(res.output.unreadCount);

    if (seen.current === null) {
      seen.current = new Set(rows.map((r) => r.messageId));
      return;
    }
    /* Oldest first, so a burst arrives in the order it happened. */
    for (const row of [...rows].reverse()) {
      if (seen.current.has(row.messageId)) continue;
      seen.current.add(row.messageId);
      if (!row.read) announce(row);
    }
  }, [isSignedIn, announce]);

  /* A different org is a different feed — start the baseline again. */
  useEffect(() => {
    seen.current = null;
  }, [orgId]);

  useEffect(() => {
    if (!isSignedIn) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [isSignedIn, refresh]);

  const markAllRead = useCallback(async () => {
    const res = await invoke<{ unreadCount: number }>('human.notifications.read', { all: true });
    if (res.status === 'succeeded') {
      setUnreadCount(res.output.unreadCount);
      setItems((cur) => cur?.map((n) => ({ ...n, read: true })) ?? cur);
    }
  }, []);

  const markRead = useCallback(async (messageId: string) => {
    const res = await invoke('human.notifications.read', { messageIds: [messageId] });
    if (res.status === 'succeeded') {
      setItems((cur) => cur?.map((n) => (n.messageId === messageId ? { ...n, read: true } : n)) ?? cur);
      setUnreadCount((c) => Math.max(0, c - 1));
    }
  }, []);

  const requestOsPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      setOsPermission(await Notification.requestPermission());
    } catch {
      /* Safari's callback-only signature on older versions. Nothing to do. */
    }
  }, []);

  const value = useMemo<NotificationsApi>(
    () => ({
      items,
      unreadCount,
      loading,
      refresh,
      markAllRead,
      markRead,
      toast,
      toasts,
      dismissToast,
      requestOsPermission,
      osPermission,
    }),
    [items, unreadCount, loading, refresh, markAllRead, markRead, toast, toasts, dismissToast, requestOsPermission, osPermission],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

/**
 * The hook every surface uses.
 *
 * Returns a no-op API rather than throwing when the provider is missing — the
 * root layout wraps auth screens too, and a sign-in page that crashed because
 * it rendered a header would be a bad trade for a stricter contract.
 */
export function useNotifications(): NotificationsApi {
  const ctx = useContext(NotificationsContext);
  return ctx ?? INERT;
}

const INERT: NotificationsApi = {
  items: null,
  unreadCount: 0,
  loading: false,
  refresh: async () => {},
  markAllRead: async () => {},
  markRead: async () => {},
  toast: () => {},
  toasts: [],
  dismissToast: () => {},
  requestOsPermission: async () => {},
  osPermission: 'unsupported',
};
