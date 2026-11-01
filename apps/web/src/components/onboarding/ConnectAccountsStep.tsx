'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { platformLabel } from '@/lib/platforms';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';
import { notifyResult } from '@/lib/notify';
import { Busy, SparkLoader } from '@/components/brand/SparkLoader';
import { AccountChip, PlatformTile } from '@/components/accounts/AccountParts';
import { CredentialConnectModal } from '@/components/settings/CredentialConnectModal';
import { openConsentPopup, useConsentPopupResult } from '@/lib/oauthPopup';

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
  accountAvatarUrl?: string;
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
  useConsentPopupResult(() => void load());

  async function connect(platform: string) {
    if (platforms?.find((p) => p.platform === platform)?.connectMethod === 'credentials') {
      setCredentialFor(platform);
      return;
    }
    setBusy(platform);
    await openConsentPopup(async () => {
      const res = await invoke<{ authorizeUrl: string }>('integration.connect', { genomeId, provider: platform });
      // The common case here is "not configured for native publishing yet",
      // which the tool refuses by name. Shown verbatim as the detail — it is a
      // better explanation than anything this component could paraphrase.
      return notifyResult(res, undefined, `Couldn’t connect ${platformLabel(platform)}`) ? res.output.authorizeUrl : null;
    });
    setBusy(null);
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
        <>
          {/* The same chips and tiles as Settings → Account Connection, so an
              account looks like one thing wherever it is connected. */}
          {(platforms ?? []).some((p) => p.connected) ? (
            <ul className="flex flex-wrap gap-[12px]">
              {(platforms ?? [])
                .filter((p) => p.connected)
                .map((p) => (
                  <li key={p.platform}>
                    <AccountChip
                      account={p}
                      status={
                        p.status === 'expired' || p.status === 'expiring' ? (
                          <span style={{ color: p.status === 'expired' ? 'var(--ss-danger)' : 'var(--ss-warn)' }}>
                            {p.status === 'expired' ? 'Access expired' : 'Expiring soon'}
                          </span>
                        ) : undefined
                      }
                    />
                  </li>
                ))}
            </ul>
          ) : null}
          <ul className="flex flex-wrap gap-[15.8px]">
            {(platforms ?? [])
              .filter((p) => !p.connected)
              .map((p) => (
                <li key={p.platform}>
                  <PlatformTile
                    platform={p.platform}
                    state="connect"
                    busy={busy === p.platform}
                    disabled={busy !== null}
                    onClick={() => void connect(p.platform)}
                    title={`Connect ${platformLabel(p.platform)}`}
                    ariaLabel={`Connect ${platformLabel(p.platform)}`}
                  />
                </li>
              ))}
          </ul>
        </>
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
