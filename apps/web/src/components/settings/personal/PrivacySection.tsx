'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import { SettingsSaveBar } from '../SettingsShell';
import { PrefGroup, PrefRow } from './fields';
import { useAccountPrefs } from './prefs';

/**
 * `Settings PS Privacy` — 1093 tall.
 *
 * Two halves: what may be used, and what you can take or remove. The first is
 * preference state on the account; the second is the honest part — a data
 * export and an account deletion both belong to the provider that owns the
 * account, and neither is something this screen should attempt itself.
 *
 * Deleting an account is deliberately not a button here. It is irreversible,
 * it removes other people's access to brands you own, and the provider's own
 * flow is the one that handles those consequences.
 */

const DEFAULTS = {
  productAnalytics: true,
  sessionReplay: false,
  improveModels: false,
};

export function PrivacySection() {
  const { user } = useUser();
  const { openUserProfile } = useClerk();
  const { prefs, set, reset, save, busy, note, dirty, ready } = useAccountPrefs('privacy', DEFAULTS);

  if (!ready) {
    return <p className="text-16" style={{ color: 'rgb(131,131,131)' }}>Loading your preferences…</p>;
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-[30px]">
        <PrefGroup title="What may be collected">
          <PrefRow
            title="Product analytics"
            detail="Which screens are used and which actions fail. Never post content, never message bodies."
            on={prefs.productAnalytics}
            onToggle={() => set({ productAnalytics: !prefs.productAnalytics })}
          />
          <PrefRow
            title="Session replay"
            detail="Off by default, and it stays off unless you turn it on here."
            on={prefs.sessionReplay}
            onToggle={() => set({ sessionReplay: !prefs.sessionReplay })}
          />
          <PrefRow
            title="Help improve the models"
            detail="Allow your approved posts to be used as training examples. Drafts you rejected are never used either way."
            on={prefs.improveModels}
            onToggle={() => set({ improveModels: !prefs.improveModels })}
          />
        </PrefGroup>

        <section>
          <h3 className="text-18 font-semibold text-ink">Your data</h3>
          <div className="mt-[13px] grid grid-cols-1 gap-[12px]">
            <div
              className="rounded bg-white px-[22px] py-[18px]"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
            >
              <p className="text-16 font-semibold text-ink">Take a copy of a brand</p>
              <p className="mt-[6px] text-16 leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
                A brand&rsquo;s genome exports as portable JSON from Brand Settings → Import /
                Export. That is brand data rather than personal data, which is why it lives there.
              </p>
            </div>

            <div
              className="rounded bg-white px-[22px] py-[18px]"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
            >
              <p className="text-16 font-semibold text-ink">Your account and its data</p>
              <p className="mt-[6px] max-w-[720px] text-16 leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
                Your name, email and sign-in history belong to the provider that authenticates you.
                Requesting a copy, or closing the account, happens in its dialog — closing it is
                irreversible and would remove other people&rsquo;s access to brands you own, so it
                is not a button on this page.
              </p>
              <button
                type="button"
                onClick={() => openUserProfile()}
                className="mt-[16px] h-[44.809px] rounded-[9.704px] bg-white px-[24px] text-16 font-medium transition-colors hover:bg-surface-200"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)', color: 'rgb(131,131,131)' }}
              >
                Open account settings
              </button>
            </div>
          </div>

          {user?.createdAt ? (
            <p className="mt-[14px] text-16" style={{ color: 'rgb(131,131,131)' }}>
              This account was created{' '}
              {new Date(user.createdAt).toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}.
            </p>
          ) : null}
        </section>
      </div>

      <SettingsSaveBar onSave={() => void save()} onCancel={reset} busy={busy} dirty={dirty} note={note} />
    </>
  );
}
