'use client';

import { SettingsSaveBar } from '../SettingsShell';
import { PrefGroup, PrefRow } from './fields';
import { useAccountPrefs } from './prefs';

/**
 * `Settings PS Notifications` — a 1402-tall screen of labelled switches in
 * groups.
 *
 * The switch is the same 45x24.324 control as everywhere else in the product
 * (`#3EC332` on, `rgba(131,131,131,0.3)` off, the knob at 23.108 / 3).
 *
 * ── Which of these do anything today ──────────────────────────────────────
 *
 * The in-app bell is real: `human.notifications` is what fills it and the app
 * already renders it on every screen. Desktop notifications are the browser's
 * own permission, which `NotificationBell` requests. Email and digest delivery
 * have no sender behind them — no tool queues mail — so those rows say so
 * instead of pretending to arm something.
 *
 * Every row stores against the account rather than the browser, because "tell
 * me when a post needs review" should follow you to your laptop.
 */

const DEFAULTS = {
  inAppReview: true,
  inAppPublished: true,
  inAppFailures: true,
  desktop: false,
  emailDigest: false,
  emailMentions: false,
  weeklySummary: false,
};

export function NotificationsSection() {
  const { prefs, set, reset, save, busy, note, dirty, ready } = useAccountPrefs('notifications', DEFAULTS);

  if (!ready) {
    return <p className="text-16" style={{ color: 'rgb(131,131,131)' }}>Loading your preferences…</p>;
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-[30px]">
        <PrefGroup title="In the app">
          <PrefRow
            title="A post needs review"
            detail="The bell in the top bar, on every screen."
            on={prefs.inAppReview}
            onToggle={() => set({ inAppReview: !prefs.inAppReview })}
          />
          <PrefRow
            title="A post published"
            detail="Confirmation once a platform accepts it."
            on={prefs.inAppPublished}
            onToggle={() => set({ inAppPublished: !prefs.inAppPublished })}
          />
          <PrefRow
            title="Something failed"
            detail="A publish that was rejected, or a connection that stopped working."
            on={prefs.inAppFailures}
            onToggle={() => set({ inAppFailures: !prefs.inAppFailures })}
          />
        </PrefGroup>

        <PrefGroup title="On this device">
          <PrefRow
            title="Desktop notifications"
            detail="Shown by your operating system when the app is not in front. Your browser asks first."
            on={prefs.desktop}
            onToggle={() => {
              const next = !prefs.desktop;
              set({ desktop: next });
              if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                void Notification.requestPermission();
              }
            }}
          />
        </PrefGroup>

        <PrefGroup title="Email">
          <PrefRow
            title="Daily digest"
            detail="Nothing sends mail yet — no tool in the registry queues it — so this records the preference and delivers nothing."
            on={prefs.emailDigest}
            onToggle={() => set({ emailDigest: !prefs.emailDigest })}
          />
          <PrefRow
            title="Mentions and replies"
            detail="Same: stored, not yet delivered."
            on={prefs.emailMentions}
            onToggle={() => set({ emailMentions: !prefs.emailMentions })}
          />
          <PrefRow
            title="Weekly performance summary"
            detail="Same: stored, not yet delivered."
            on={prefs.weeklySummary}
            onToggle={() => set({ weeklySummary: !prefs.weeklySummary })}
          />
        </PrefGroup>
      </div>

      <SettingsSaveBar onSave={() => void save()} onCancel={reset} busy={busy} dirty={dirty} note={note} />
    </>
  );
}
