'use client';

import { useState } from 'react';
import { invoke } from '@/lib/tools';
import { platformLabel } from '@/lib/platforms';
import { Button } from '@/components/ui/button';

/**
 * Connecting a platform that has no OAuth redirect.
 *
 * Bluesky is the only one today, and it is genuinely different rather than
 * awkwardly different: AT Protocol authenticates with a handle and an **app
 * password** the user creates in their own Bluesky settings. There is no consent
 * screen to send a browser to, so there is nothing for `integration.connect` to
 * return — and until this existed, clicking Connect on the Bluesky tile called
 * that tool anyway and got back *"bluesky isn't configured for native publishing
 * yet"*, which sent people looking for a developer console that does not exist.
 *
 * ── Why an app password, said twice ───────────────────────────────────────
 *
 * Nothing on either side can tell an app password from an account password —
 * both authenticate. The difference is that an app password is scoped and can be
 * revoked on its own, and the account password cannot. Since the code cannot
 * enforce it, the wording has to carry it, which is why it is stated in the
 * label, in the placeholder and in the help line rather than once.
 *
 * The credential is verified against Bluesky by the tool before it is stored, so
 * a typo fails here, in front of the person who made it, rather than at the first
 * scheduled post hours later.
 */

export interface CredentialConnectModalProps {
  platform: string;
  genomeId: string;
  onClose: () => void;
  onConnected: (accountLabel: string) => void;
}

export function CredentialConnectModal({ platform, genomeId, onClose, onConnected }: CredentialConnectModalProps) {
  const [handle, setHandle] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = platformLabel(platform);
  const ready = handle.trim().length > 0 && appPassword.trim().length > 0;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const res = await invoke<{ connected: boolean; accountLabel: string }>('integration.connect_credentials', {
      genomeId,
      provider: platform,
      handle: handle.trim(),
      appPassword: appPassword.trim(),
    });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(
        res.status === 'failed' ? res.error.message : 'Connecting an account needs an approval this screen cannot give.',
      );
      return;
    }
    onConnected(res.output.accountLabel);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Connect ${label}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[440px] rounded-xl border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[18px] font-semibold text-ink">Connect {label}</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          {label} has no sign-in redirect. It authenticates with your handle and an app password you create in your own{' '}
          {label} settings.
        </p>

        <label className="mt-4 block text-[13px] font-medium text-ink" htmlFor="cc-handle">
          Handle
        </label>
        <input
          id="cc-handle"
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink"
          placeholder="name.bsky.social"
          value={handle}
          autoComplete="off"
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />

        <label className="mt-3 block text-[13px] font-medium text-ink" htmlFor="cc-password">
          App password
        </label>
        <input
          id="cc-password"
          type="password"
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink"
          placeholder="xxxx-xxxx-xxxx-xxxx"
          value={appPassword}
          /*
           * `new-password`, not `current-password`: the browser must not offer to
           * fill — or to save — the account password here. The two are
           * indistinguishable to a password manager, and the whole point of this
           * field is that it takes the one that is revocable.
           */
          autoComplete="new-password"
          onChange={(e) => setAppPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        <p className="mt-1.5 text-[12px] text-ink-muted">
          Not your account password. In {label}: Settings → Privacy and Security → App Passwords → Add App Password.
          You can revoke it there at any time without changing your real password.
        </p>

        {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={!ready || busy}>
            {busy ? 'Checking…' : 'Connect'}
          </Button>
        </div>
      </div>
    </div>
  );
}
