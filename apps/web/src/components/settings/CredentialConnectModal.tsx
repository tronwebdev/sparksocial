'use client';

import { useState } from 'react';
import { invoke } from '@/lib/tools';
import { platformLabel } from '@/lib/platforms';
import { Button } from '@/components/ui/button';
import { FieldHint, FieldLabel, TextField } from '@/components/ui/field';
import { notify, notifyResult } from '@/lib/notify';
import { Busy } from '@/components/brand/SparkLoader';

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

  const label = platformLabel(platform);
  const ready = handle.trim().length > 0 && appPassword.trim().length > 0;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    const res = await invoke<{ connected: boolean; accountLabel: string }>('integration.connect_credentials', {
      genomeId,
      provider: platform,
      handle: handle.trim(),
      appPassword: appPassword.trim(),
    });
    setBusy(false);
    if (!notifyResult(res, undefined, `Couldn’t connect ${label}`)) return;
    // Named — the account, not just the platform — like every other connect
    // confirmation; see `PublishHealthPanel`'s `?social=` handler for why.
    notify.success(`${label} connected`, { body: `As ${res.output.accountLabel}.` });
    onConnected(res.output.accountLabel);
  }

  return (
    <div
      // The settings modals' scrim (`TeamModals`): a light ink wash, blurred.
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,12,12,0.28)] p-4 backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Connect ${label}`}
      onClick={onClose}
    >
      <div
        // r20 and the deep soft shadow of every drawn modal — no stroke.
        className="w-full max-w-[480px] rounded-[20px] bg-surface px-8 pb-7 pt-7 shadow-[0_40px_90px_-40px_rgba(12,12,12,0.5)] max-sm:px-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-24 font-semibold text-ink">Connect {label}</h2>
        <p className="mt-2 text-15 text-ink-muted">
          {label} has no sign-in redirect. It authenticates with your handle and an app password you create in your own{' '}
          {label} settings.
        </p>

        <FieldLabel htmlFor="cc-handle" className="mt-6">
          Handle
        </FieldLabel>
        <TextField
          id="cc-handle"
          placeholder="name.bsky.social"
          value={handle}
          autoComplete="off"
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />

        <FieldLabel htmlFor="cc-password" className="mt-5">
          App password
        </FieldLabel>
        <TextField
          id="cc-password"
          type="password"
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
        <FieldHint>
          Not your account password. In {label}: Settings → Privacy and Security → App Passwords → Add App Password.
          You can revoke it there at any time without changing your real password.
        </FieldHint>

        <div className="mt-7 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!ready || busy}>
            {busy ? <Busy>Checking…</Busy> : 'Connect'}
          </Button>
        </div>
      </div>
    </div>
  );
}
