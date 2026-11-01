'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { platformLabel } from '@/lib/platforms';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';
import { notify, notifyResult } from '@/lib/notify';
import { Busy, SparkLoader } from '@/components/brand/SparkLoader';
import { CredentialConnectModal } from '@/components/settings/CredentialConnectModal';
import { OAUTH_POPUP_NAME, type OAuthPopupResult } from '@/lib/oauthPopup';

/**
 * `ONB-04` — *"Connect Social Accounts (connected profiles list + OAuth popup)"*.
 *
 * `integration.connect` has worked for a while and lived only in settings.
 * Connecting later is supported and is not the same as the flow §8.2 describes,
 * which puts this *before* the first campaign — and the difference is not
 * cosmetic: a campaign created with nothing connected plans a month, drafts it,
 * and holds every post, so the product looks like it is working and nothing goes
 * out. Asking here is what stops that.
 *
 * ── Why a popup, and not a redirect ──────────────────────────────────────
 *
 * `integration.connect` returns an authorize URL, and the platform's callback
 * lands on `/settings?social=…` — a hardcoded path in `social-oauth.ts`. Sending
 * the browser there mid-onboarding would drop the person out of the flow and
 * lose their unsaved answers.
 *
 * So the authorize URL opens in a second window and this tab stays put, which is
 * what §ONB-04's own words ask for. The alternative was threading a return path
 * through the signed OAuth state and honouring it in the callback — more moving
 * parts, and it adds an open-redirect surface to a security-sensitive handler for
 * no gain the popup does not already give.
 *
 * Confirmation comes from re-reading `integration.health`, not from the popup.
 * A window that was closed tells us nothing about whether the user pressed
 * Allow, and a `?social=connected` param would be reporting what the *callback*
 * thought rather than what the database says.
 *
 * ── Skippable, on purpose ─────────────────────────────────────────────────
 *
 * A platform with no configured developer app refuses by name — most of them, in
 * most environments. A step that could not be skipped would make onboarding
 * impossible to finish for exactly the reason CLAUDE.md's scope note gives:
 * platform approvals are a multi-week clock, not a code path.
 */

type ConnectionStatus = 'not_connected' | 'ok' | 'expiring' | 'expired';

interface PlatformStatus {
  platform: string;
  connected: boolean;
  status: ConnectionStatus;
  accountLabel?: string;
  supported: boolean;
  connectedVia?: string;
  connectMethod: 'oauth' | 'credentials' | 'derived';
  /** Whether Connect can lead anywhere on this deployment. */
  available?: boolean;
}


export function ConnectAccountsStep({
  genomeId,
  onConnectedCountChange,
}: {
  genomeId: string;
  /** Lifted so the step's footer can say "Continue" versus "Skip for now" without duplicating the read. */
  onConnectedCountChange?: (n: number) => void;
}) {
  const [platforms, setPlatforms] = useState<PlatformStatus[] | null>(null);
  /** The list could not be read — page state. A failed connect is a notification. */
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [credentialFor, setCredentialFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await invoke<{ platforms: PlatformStatus[] }>('integration.health', {});
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? userMessage(res.error) : 'That request was gated.');
      return;
    }
    /*
      Every account this deployment can actually connect, and nothing else.
      This was a hardcoded five ("the ones with a native flow"), which went
      stale as platforms were added and still offered the ones with no app
      registered — each Connect refusing by name. Platforms that post through
      another's connection (Stories, Facebook) are not accounts of their own.
    */
    const connectable = res.output.platforms.filter(
      (p) => !p.connectedVia && p.supported && (p.available !== false || p.connected),
    );
    setPlatforms(connectable);
    setError(null);
    onConnectedCountChange?.(connectable.filter((p) => p.connected).length);
  }, [onConnectedCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The consent popup lands on the accounts page, which reports back here and
     closes itself — see `oauthPopup.ts`. */
  useEffect(() => {
    const onMessage = (e: MessageEvent<OAuthPopupResult>) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'spark-oauth') return;
      const label = e.data.provider ? platformLabel(e.data.provider) : 'The platform';
      if (e.data.social === 'connected') notify.success(`${label} connected`);
      else if (e.data.social === 'denied') notify.info(`${label} connection cancelled`);
      else notify.error(`Couldn’t connect ${label}`, { body: 'The connection did not go through. Try again.' });
      void load();
    };
    /* When the popup could not hand back (some consent pages cut the link to
       this window), coming back to this window is the signal instead. */
    const onFocus = () => void load();
    window.addEventListener('message', onMessage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  async function connect(platform: string) {
    if (platforms?.find((p) => p.platform === platform)?.connectMethod === 'credentials') {
      setCredentialFor(platform);
      return;
    }
    setBusy(platform);
    const res = await invoke<{ authorizeUrl: string }>('integration.connect', { genomeId, provider: platform });
    setBusy(null);
    // The common case here is "not configured for native publishing yet",
    // which the tool refuses by name. Shown verbatim as the detail — it is a
    // better explanation than anything this component could paraphrase.
    if (!notifyResult(res, undefined, `Couldn’t connect ${platformLabel(platform)}`)) return;
    const win = window.open(res.output.authorizeUrl, OAUTH_POPUP_NAME, 'width=600,height=760');
    if (!win) {
      notify.warning('Your browser blocked the sign-in window', {
        body: 'Allow pop-ups for this site, then try again.',
      });
    }
  }

  async function recheck() {
    setChecking(true);
    await load();
    setChecking(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-16 text-ink-muted">
        SPARK can plan and write without these. It cannot post without them — so a campaign started now would
        fill up and then hold everything. You can also do this later in Settings.
      </p>

      {error ? <p className="text-14 text-[var(--ss-danger)]">{error}</p> : null}

      {platforms === null && !error ? (
        <SparkLoader label="Loading your connected accounts…" />
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(platforms ?? []).map((p) => (
            <li
              key={p.platform}
              className="flex items-center justify-between gap-3 rounded-xl border border-border p-4"
            >
              <div className="min-w-0">
                <p className="text-15 font-medium text-ink">{platformLabel(p.platform)}</p>
                <p className="text-13 text-ink-muted">
                  {p.connected ? (p.accountLabel ?? 'Connected') : 'Not connected'}
                </p>
              </div>
              {p.connected ? (
                <Badge variant={p.status === 'ok' ? 'success' : 'warn'}>
                  {p.status === 'ok' ? 'connected' : p.status}
                </Badge>
              ) : (
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void connect(p.platform)}>
                  {busy === p.platform ? <Busy size={16}>Opening…</Busy> : 'Connect'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {credentialFor ? (
        <CredentialConnectModal
          platform={credentialFor}
          genomeId={genomeId}
          onClose={() => setCredentialFor(null)}
          onConnected={() => {
            setCredentialFor(null);
            void load();
          }}
        />
      ) : null}

      <div>
        <Button size="sm" variant="ghost" disabled={checking} onClick={() => void recheck()}>
          {checking ? <Busy size={16}>Checking…</Busy> : 'I finished in the other window — check again'}
        </Button>
      </div>
    </div>
  );
}
