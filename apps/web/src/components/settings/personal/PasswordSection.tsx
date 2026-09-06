'use client';

import { useClerk, useUser } from '@clerk/nextjs';

/**
 * `Settings PS Password` — "Password & Security".
 *
 * ── Why this screen does not contain a password form ──────────────────────
 *
 * The account is Clerk's. Passwords, second factors, backup codes and active
 * sessions are all its state, and the flows around them — re-authentication,
 * rate limits, breach checks, recovery — are the reason it exists. A form here
 * that collected a password and posted it onward would be re-implementing the
 * one part of the product that must not be re-implemented casually, and it
 * would put a credential through this application for no gain.
 *
 * So this screen reports what is true of the account and opens Clerk's own
 * dialog for the change. Everything shown is a real read: whether a password is
 * set, which second factors are enabled, and when the account was last updated.
 */
export function PasswordSection() {
  const { user, isLoaded } = useUser();
  const { openUserProfile } = useClerk();

  if (!isLoaded) {
    return <p className="text-16" style={{ color: 'rgb(131,131,131)' }}>Loading your account…</p>;
  }

  const rows: Array<{ label: string; value: string; tone?: 'good' | 'warn' }> = [
    {
      label: 'Password',
      value: user?.passwordEnabled ? 'Set' : 'Not set — you sign in another way',
      tone: user?.passwordEnabled ? 'good' : undefined,
    },
    {
      label: 'Two-step verification',
      value: user?.twoFactorEnabled ? 'On' : 'Off',
      tone: user?.twoFactorEnabled ? 'good' : 'warn',
    },
    {
      label: 'Authenticator app',
      value: user?.totpEnabled ? 'Configured' : 'Not configured',
      tone: user?.totpEnabled ? 'good' : undefined,
    },
    {
      label: 'Backup codes',
      value: user?.backupCodeEnabled ? 'Generated' : 'None generated',
      tone: user?.backupCodeEnabled ? 'good' : undefined,
    },
    {
      label: 'Email addresses',
      value: `${user?.emailAddresses.length ?? 0} on the account`,
    },
    {
      label: 'Last updated',
      value: user?.updatedAt
        ? new Date(user.updatedAt).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
        : '—',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-[26px]">
      <ul className="grid grid-cols-1 gap-[12px]">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex flex-wrap items-center justify-between gap-[16px] rounded bg-white px-[22px] py-[18px]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
          >
            <span className="text-18 font-medium text-ink">{r.label}</span>
            <span
              className="text-16 font-semibold"
              style={{
                color:
                  r.tone === 'good'
                    ? 'var(--ss-green-700)'
                    : r.tone === 'warn'
                      ? 'var(--ss-amber-500)'
                      : 'rgb(131,131,131)',
              }}
            >
              {r.value}
            </span>
          </li>
        ))}
      </ul>

      <div
        className="rounded-xl bg-white p-[24px]"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
      >
        <p className="text-18 font-semibold text-ink">Change your password or add a second factor</p>
        <p className="mt-[8px] max-w-[640px] text-16 leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
          These are handled by the account provider that signs you in, so they happen in its own
          dialog rather than in a form here. Nothing about your credentials passes through
          SparkSocial.
        </p>
        <button
          type="button"
          onClick={() => openUserProfile()}
          className="mt-[18px] h-[44.809px] rounded-[9.704px] bg-ink px-[26px] text-16 font-medium text-white transition-colors hover:bg-ink-800"
        >
          Open account security
        </button>
      </div>
    </div>
  );
}
