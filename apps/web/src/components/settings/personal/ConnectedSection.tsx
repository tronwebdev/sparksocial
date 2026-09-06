'use client';

import { useEffect, useState } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import { invoke } from '@/lib/tools';
import { platformLabel } from '@/lib/platforms';

/**
 * `Settings PS Connected` — 1523 tall, two lists of connections.
 *
 * The distinction the design does not draw, and which matters: some
 * connections belong to **you** (the identity you sign in with) and some belong
 * to the **brand** (the accounts its posts go out through). Disconnecting the
 * first locks you out; disconnecting the second stops publishing. They are
 * listed separately here for that reason.
 *
 * Both halves are real reads — Clerk's `externalAccounts` for the first,
 * `integration.health` for the second.
 */

interface Health {
  platforms: Array<{ platform: string; connected: boolean; accountLabel?: string; supported: boolean }>;
}

export function ConnectedSection() {
  const { user, isLoaded } = useUser();
  const { openUserProfile } = useClerk();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await invoke<Health>('integration.health', {});
      setHealth(res.status === 'succeeded' ? res.output : { platforms: [] });
    })();
  }, []);

  const sign = user?.externalAccounts ?? [];
  const publishing = (health?.platforms ?? []).filter((p) => p.connected);

  return (
    <div className="grid grid-cols-1 gap-[34px]">
      <section>
        <h3 className="text-18 font-semibold text-ink">How you sign in</h3>
        <p className="mt-[8px] text-16" style={{ color: 'rgb(131,131,131)' }}>
          The identities attached to your own account. Removing the last one would lock you out, so
          they are managed in the provider&rsquo;s dialog.
        </p>

        <ul className="mt-[15px] grid grid-cols-1 gap-[12px]">
          {!isLoaded ? (
            <li className="text-16" style={{ color: 'rgb(131,131,131)' }}>Loading…</li>
          ) : sign.length === 0 ? (
            <li
              className="rounded bg-white px-[22px] py-[18px] text-16"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)', color: 'rgb(131,131,131)' }}
            >
              You sign in with an email address and password only — no third-party identity is
              linked.
            </li>
          ) : (
            sign.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-[16px] rounded bg-white px-[22px] py-[16px]"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
              >
                <span className="min-w-0">
                  <span className="block text-18 font-semibold capitalize text-ink">
                    {a.provider.replace(/^oauth_/, '').replace(/_/g, ' ')}
                  </span>
                  <span className="mt-[4px] block truncate text-16" style={{ color: 'rgb(131,131,131)' }}>
                    {a.emailAddress || a.username || 'Linked'}
                  </span>
                </span>
                <span className="text-16 font-semibold" style={{ color: 'var(--ss-green-700)' }}>
                  {a.verification?.status === 'verified' ? 'Verified' : 'Linked'}
                </span>
              </li>
            ))
          )}
        </ul>

        <button
          type="button"
          onClick={() => openUserProfile()}
          className="mt-[16px] h-[44.809px] rounded-[9.704px] bg-white px-[24px] text-16 font-medium transition-colors hover:bg-surface-200"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)', color: 'rgb(131,131,131)' }}
        >
          Manage sign-in methods
        </button>
      </section>

      <section>
        <h3 className="text-18 font-semibold text-ink">Where this brand publishes</h3>
        <p className="mt-[8px] text-16" style={{ color: 'rgb(131,131,131)' }}>
          These belong to the brand, not to you — anyone on the team publishes through them.
        </p>

        <ul className="mt-[15px] grid grid-cols-1 gap-[12px]">
          {health === null ? (
            <li className="text-16" style={{ color: 'rgb(131,131,131)' }}>Reading connections…</li>
          ) : publishing.length === 0 ? (
            <li
              className="rounded bg-white px-[22px] py-[18px] text-16"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)', color: 'rgb(131,131,131)' }}
            >
              Nothing is connected yet. Connect an account under Brand Settings → Account
              Connection.
            </li>
          ) : (
            publishing.map((p) => (
              <li
                key={p.platform}
                className="flex flex-wrap items-center justify-between gap-[16px] rounded bg-white px-[22px] py-[16px]"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
              >
                <span className="min-w-0">
                  <span className="block text-18 font-semibold text-ink">{platformLabel(p.platform)}</span>
                  <span className="mt-[4px] block truncate text-16" style={{ color: 'rgb(131,131,131)' }}>
                    {p.accountLabel ?? 'Connected'}
                  </span>
                </span>
                <span className="flex items-center gap-[8px] text-16 font-semibold" style={{ color: 'var(--ss-green-700)' }}>
                  <span aria-hidden className="block h-[10px] w-[10px] rounded-full" style={{ background: 'var(--ss-set-online)' }} />
                  Healthy
                </span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
