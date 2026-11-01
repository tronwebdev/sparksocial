'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { platformLabel } from '@/lib/platforms';
import { expiresInWords } from '@sparksocial/shared';
import { CredentialConnectModal } from './CredentialConnectModal';
import { userMessage } from '@/lib/errorCopy';
import { notify, notifyResult } from '@/lib/notify';
import { Busy, SparkLoader } from '@/components/brand/SparkLoader';
import { PlatformIcon } from '@/components/common/PlatformIcon';
import { ModalShell } from '@/components/common/ModalShell';
import { handBackToOpener } from '@/lib/oauthPopup';

/**
 * `Settings WS Social Accounts`, measured relative to the 1350 content card:
 *
 *   "Preselected Accounts"  18/500, then the connected chips — 221x68 r10 white
 *                           in a `rgba(12,12,12,.1)` ring: a 47 avatar disc at
 *                           11,9 with the platform's 26.5 mark at its lower
 *                           right, the name at 73,25 in 16/600, and a 12.8 ×
 *                           at 197,11 in `#838383`
 *   "+ Add Accounts"        18/500, then 129.5x103.2 r10.53 tiles: a 47 mark
 *                           centred at top 14.7, the name 14.74/600 at 68.4;
 *                           the ones that cannot be used at 40% opacity
 *
 * ── What changed, and why ─────────────────────────────────────────────────
 *
 * This was the design's two rows plus a second, developer-facing panel under
 * them ("Publishing health": adapters, "via aggregator:stub", a Refresh
 * button) that repeated Connect and Disconnect in another form. The design
 * has the two rows only, and both jobs fit in them: the × on a chip is
 * Disconnect, and a chip whose access is running out says so and offers
 * Reconnect. Expiry warnings sit above the chips, where they are read first.
 *
 * Tiles used to dim everything not yet connected and offer Connect on all of
 * them — including six platforms that have no app registered on this
 * deployment, whose Connect could only fail. `integration.health` now says
 * which are `available`; those are full-strength, the rest are dimmed as the
 * design dims its own unavailable tiles, and say so.
 *
 * The return from a consent screen (`?social=`, and Canva's `?canva=`) is read
 * here and becomes a notification — it used to be read only by the panel that
 * is gone, and Canva's returned to a page that read nothing.
 */

type ConnectionStatus = 'not_connected' | 'ok' | 'expiring' | 'expired';

interface Platform {
  platform: string;
  connected: boolean;
  status: ConnectionStatus;
  accountLabel?: string;
  accountAvatarUrl?: string;
  hoursUntilExpiry: number | null;
  supported: boolean;
  /** Posts through another platform's connection — no account of its own. */
  connectedVia?: string;
  /** `credentials` opens a form (Bluesky's app password), not a consent screen. */
  connectMethod: 'oauth' | 'credentials' | 'derived';
  /** Whether Connect can lead anywhere on this deployment. Absent from an older API: assume yes. */
  available?: boolean;
}

interface Attention {
  platform: string;
  status: ConnectionStatus;
  detail: string;
}

/** What `?social=failed&reason=` means, for the person who just came back. */
const FAILED_BECAUSE: Record<string, string> = {
  expired: 'The connection link had expired. Start again from here.',
  incomplete: 'The platform sent you back without finishing. Try again.',
  not_configured: 'This platform is not set up for this workspace yet.',
  exchange: 'The platform did not accept the connection. Try again in a moment.',
};

export function AccountsSection() {
  /*
   * `integration.connect` takes the brand in its *input*, not off the request:
   * `ctx.genomeId` comes from the `x-genome-id` header the proxy forwards, and
   * the tool's schema is `{ genomeId, provider }`.
   */
  const { genome } = useSelectedGenome();
  const [platforms, setPlatforms] = useState<Platform[] | null>(null);
  const [attention, setAttention] = useState<Attention[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [credentialFor, setCredentialFor] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<Platform | null>(null);
  const [canva, setCanva] = useState<{ connected: boolean; connectedBy?: string } | null>(null);
  /* Only a failed read of the connections stays on the page. */
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await invoke<{ platforms: Platform[]; needsAttention: Attention[] }>('integration.health', {});
    if (res.status !== 'succeeded') {
      setPlatforms([]);
      setError(res.status === 'failed' ? userMessage(res.error) : 'Reading connections needs an approval.');
      return null;
    }
    setError(null);
    setPlatforms(res.output.platforms);
    setAttention(res.output.needsAttention);
    return res.output.platforms;
  }, []);

  const loadCanva = useCallback(async (genomeId: string) => {
    const res = await invoke<{ connected: boolean; connectedBy?: string }>('brand.oauth.status', { genomeId, provider: 'canva' });
    setCanva(res.status === 'succeeded' ? res.output : { connected: false });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (genome) void loadCanva(genome.genomeId);
  }, [genome, loadCanva]);

  /* Back from a consent screen: say how it went, naming the account. Only
     Google offers an account chooser — the others connect whichever account
     the browser is signed in to — so the name is the thing worth reading. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const social = params.get('social');
    const canvaResult = params.get('canva');
    if (!social && !canvaResult) return;
    window.history.replaceState(null, '', window.location.pathname);
    /* Onboarding's consent popup lands here too; hand the result back and close. */
    if (
      social &&
      handBackToOpener({
        social: social === 'connected' || social === 'denied' ? social : 'failed',
        provider: params.get('provider'),
        reason: params.get('reason'),
      })
    ) {
      return;
    }

    if (canvaResult === 'connected') notify.success('Canva connected');
    else if (canvaResult === 'denied') notify.info('Canva connection cancelled');
    else if (canvaResult === 'failed') notify.error('Couldn’t connect Canva', { body: 'Canva did not accept the connection. Try again in a moment.' });

    if (!social) return;
    const provider = params.get('provider');
    const label = provider ? platformLabel(provider) : 'The platform';
    if (social === 'denied') {
      notify.info(`${label} connection cancelled`, { body: 'Nothing was connected.' });
      return;
    }
    if (social === 'failed') {
      const reason = params.get('reason') ?? '';
      notify.error(provider ? `Couldn’t connect ${label}` : 'Couldn’t connect that account', {
        body: FAILED_BECAUSE[reason] ?? 'The connection did not go through. Try again.',
      });
      return;
    }
    void (async () => {
      const fresh = await load();
      const account = fresh?.find((p) => p.platform === provider)?.accountLabel;
      notify.success(account ? `${label} connected as ${account}` : `${label} connected`, {
        body: account
          ? 'If that is not the account you meant, disconnect it, sign out of it on the platform and connect again.'
          : undefined,
      });
    })();
  }, [load]);

  async function connect(platform: string) {
    if (!genome) {
      notify.warning('Select a brand first', { body: 'An account connects to a brand — pick one before connecting.' });
      return;
    }
    if (platforms?.find((p) => p.platform === platform)?.connectMethod === 'credentials') {
      setCredentialFor(platform);
      return;
    }
    setBusy(platform);
    const res = await invoke<{ authorizeUrl: string }>('integration.connect', { genomeId: genome.genomeId, provider: platform });
    if (!notifyResult(res, undefined, `Couldn’t connect ${platformLabel(platform)}`)) {
      setBusy(null);
      return;
    }
    /* Same tab: the platform sends the browser back to this page, which then
       says how it went. A new tab left this one stale and the result on a
       second copy of the page. */
    window.location.href = res.output.authorizeUrl;
  }

  async function disconnect(p: Platform) {
    if (!genome) return;
    setBusy(p.platform);
    const res = await invoke<{ removed: boolean }>('brand.oauth.disconnect', { genomeId: genome.genomeId, provider: p.platform });
    setBusy(null);
    setConfirmOff(null);
    if (!notifyResult(res, `${platformLabel(p.platform)} disconnected`, `Couldn’t disconnect ${platformLabel(p.platform)}`)) return;
    await load();
  }

  async function connectCanva() {
    if (!genome) return;
    setBusy('canva');
    const res = await invoke<{ authorizeUrl: string }>('brand.oauth.connect', { genomeId: genome.genomeId, provider: 'canva' });
    if (!notifyResult(res, undefined, 'Couldn’t connect Canva')) {
      setBusy(null);
      return;
    }
    window.location.href = res.output.authorizeUrl;
  }

  async function disconnectCanva() {
    if (!genome) return;
    setBusy('canva');
    const res = await invoke<{ removed: boolean }>('brand.oauth.disconnect', { genomeId: genome.genomeId, provider: 'canva' });
    setBusy(null);
    if (!notifyResult(res, 'Canva disconnected', 'Couldn’t disconnect Canva')) return;
    setCanva({ connected: false });
  }

  const byPlatform = new Map((platforms ?? []).map((p) => [p.platform, p]));
  /* One chip per account: the platforms that post through another's
     connection (Stories, Facebook, long-form YouTube) are not accounts. */
  const chips = (platforms ?? []).filter((p) => p.connected && !p.connectedVia);
  const tiles = (platforms ?? []).filter((p) => p.supported);

  return (
    <div className="grid grid-cols-1 gap-[34px]">
      <section>
        <p className="flex items-center gap-[8px] text-18 font-medium text-ink">
          Preselected Accounts
          <span
            className="flex h-[20px] w-[20px] cursor-help items-center justify-center rounded-full text-12 font-semibold"
            style={{ boxShadow: 'inset 0 0 0 1.3px rgb(131,131,131)', color: 'rgb(131,131,131)' }}
            title="The accounts this brand publishes to. SPARK chooses among these when it plans a post."
            aria-label="The accounts this brand publishes to. SPARK chooses among these when it plans a post."
          >
            i
          </span>
        </p>

        {attention.length > 0 ? (
          <div className="mt-[14px] max-w-[720px] rounded-[10px] px-[16px] py-[12px]" style={{ background: 'rgba(255,177,64,0.14)', boxShadow: 'inset 0 0 0 1px rgba(230,167,81,0.45)' }}>
            <p className="text-15 font-semibold text-ink">
              {attention.length === 1 ? 'One connection needs you' : `${attention.length} connections need you`}
            </p>
            <ul className="mt-[4px] list-inside list-disc text-14 text-ink-muted">
              {attention.map((a) => (
                <li key={a.platform}>{a.detail}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {platforms === null ? (
          <SparkLoader size="inline" label="Reading your connections…" className="mt-[14px]" />
        ) : chips.length === 0 ? (
          <p className="mt-[14px] max-w-[620px] text-16 leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
            Nothing is connected yet. Pick a platform below — a brand with no account has nowhere to publish.
          </p>
        ) : (
          <ul className="mt-[16px] flex flex-wrap gap-[12px]">
            {chips.map((p) => (
              <AccountChip
                key={p.platform}
                p={p}
                busy={busy === p.platform}
                onDisconnect={() => setConfirmOff(p)}
                onReconnect={() => void connect(p.platform)}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <p className="text-18 font-medium text-ink">+ Add Accounts</p>

        <ul className="mt-[16px] flex flex-wrap gap-[15.8px]">
          {tiles.map((p) => {
            const owner = p.connectedVia ? byPlatform.get(p.connectedVia) : p;
            const available = owner?.available !== false;
            const connected = p.connected;
            const target = p.connectedVia ?? p.platform;
            const state = connected
              ? p.connectedVia
                ? `With ${platformLabel(p.connectedVia)}`
                : 'Connected'
              : !available
                ? 'Not available yet'
                : p.connectedVia
                  ? `Connects with ${platformLabel(p.connectedVia)}`
                  : 'Connect';
            return (
              <li key={p.platform}>
                <button
                  type="button"
                  onClick={() => void connect(target)}
                  disabled={connected || !available || busy !== null}
                  title={
                    !available
                      ? `${platformLabel(p.platform)} isn’t set up for this workspace yet.`
                      : p.connectedVia && !connected
                        ? `${platformLabel(p.platform)} posts through your ${platformLabel(p.connectedVia)} connection.`
                        : undefined
                  }
                  aria-label={
                    connected
                      ? `${platformLabel(p.platform)} is connected`
                      : !available
                        ? `${platformLabel(p.platform)} is not available yet`
                        : `Connect ${platformLabel(target)}`
                  }
                  className="flex h-[103.2px] w-[129.5px] flex-col items-center rounded-[10.53px] bg-white pt-[14.7px] transition-shadow enabled:hover:shadow-[0_10px_26px_-18px_rgba(12,12,12,0.45)] disabled:cursor-default"
                  style={{ boxShadow: 'inset 0 0 0 1.053px rgba(12,12,12,0.1)', opacity: available ? 1 : 0.4 }}
                >
                  <PlatformIcon platform={p.platform} size={40} />
                  <span className="mt-[6px] max-w-full truncate px-[6px] text-center text-15 font-semibold text-black">
                    {platformLabel(p.platform)}
                  </span>
                  <span
                    className="mt-[3px] max-w-full truncate px-[4px] text-12 font-medium"
                    style={{ color: connected ? 'var(--ss-green-700)' : 'rgb(131,131,131)' }}
                  >
                    {busy === target ? <Busy size={16}>Opening…</Busy> : state}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Only Google offers an account chooser; every other platform connects
            whichever account this browser is signed in to, without asking. An
            agency connecting a client's account from its own laptop gets its
            own, silently — this is what stops that before it happens. */}
        <p className="mt-[16px] max-w-[720px] text-14 leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
          Except for Google, platforms connect whichever account this browser is signed in to, without asking. To
          connect a different one, sign out of it on the platform first, or connect from a private window.
        </p>

        {error ? <p className="mt-[16px] text-16 text-destructive">{error}</p> : null}
      </section>

      {/* Canva lives with the other connections. Its return used to land on the
          settings overview, which read nothing, so connecting it said nothing. */}
      <section>
        <p className="text-18 font-medium text-ink">Design tools</p>
        <div
          className="mt-[16px] flex h-[68px] w-[300px] max-w-full items-center gap-[12px] rounded-[10px] bg-white px-[14px]"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}
        >
          <span
            aria-hidden
            className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full text-16 font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#00C4CC,#7D2AE8)' }}
          >
            C
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-16 font-semibold text-black">Canva</span>
            <span className="block truncate text-13" style={{ color: canva?.connected ? 'var(--ss-green-700)' : 'rgb(131,131,131)' }}>
              {canva === null ? 'Checking…' : canva.connected ? `Connected${canva.connectedBy ? ` by ${canva.connectedBy}` : ''}` : 'For the Bulk Connector recipe'}
            </span>
          </span>
          {canva === null ? null : canva.connected ? (
            <button
              type="button"
              onClick={() => void disconnectCanva()}
              disabled={busy !== null}
              className="shrink-0 text-14 font-medium transition-opacity hover:opacity-70 disabled:opacity-50"
              style={{ color: 'rgb(131,131,131)' }}
            >
              {busy === 'canva' ? <Busy size={16}>Removing…</Busy> : 'Disconnect'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void connectCanva()}
              disabled={busy !== null || !genome}
              className="shrink-0 rounded-[9px] px-[12px] py-[7px] text-14 font-semibold text-ink transition-opacity hover:opacity-85 disabled:opacity-50"
              style={{ background: 'var(--ss-lib-toggle)' }}
            >
              {busy === 'canva' ? <Busy size={16}>Opening…</Busy> : 'Connect'}
            </button>
          )}
        </div>
      </section>

      {credentialFor && genome ? (
        <CredentialConnectModal
          platform={credentialFor}
          genomeId={genome.genomeId}
          onClose={() => setCredentialFor(null)}
          onConnected={() => {
            setCredentialFor(null);
            void load();
          }}
        />
      ) : null}

      {confirmOff ? (
        <ModalShell top={220} height="auto" width={560} radius={24} label="Disconnect account" onClose={() => setConfirmOff(null)}>
          <div className="px-[44px] pb-[36px] pt-[40px] text-center">
            <p className="text-24 font-bold text-ink">
              Disconnect {platformLabel(confirmOff.platform)}
              {confirmOff.accountLabel ? ` (${confirmOff.accountLabel})` : ''}?
            </p>
            <p className="mx-auto mt-[12px] max-w-[420px] text-16 leading-[1.5] text-ink-muted">
              Posts planned for {platformLabel(confirmOff.platform)} won’t go out until an account is connected
              again. Posts already published stay where they are.
            </p>
            <div className="mt-[26px] flex items-center justify-center gap-[18px]">
              <button
                type="button"
                onClick={() => setConfirmOff(null)}
                className="flex h-[50px] items-center rounded-[11px] bg-white px-[24px] text-16 font-medium"
                style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)', color: 'rgb(131,131,131)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void disconnect(confirmOff)}
                disabled={busy !== null}
                className="flex h-[50px] items-center rounded-[11px] px-[22px] text-16 font-semibold text-white disabled:opacity-70"
                style={{ background: '#F35525' }}
              >
                {busy === confirmOff.platform ? <Busy>Disconnecting…</Busy> : 'Disconnect'}
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}

/** One connected account, in the design's chip — plus the health it does not draw. */
function AccountChip({
  p,
  busy,
  onDisconnect,
  onReconnect,
}: {
  p: Platform;
  busy: boolean;
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const left = p.hoursUntilExpiry !== null ? expiresInWords(p.hoursUntilExpiry * 3_600_000) : null;
  const health =
    p.status === 'expired'
      ? { text: 'Access expired', color: 'var(--ss-danger)' }
      : p.status === 'expiring'
        ? { text: left ? `Expires in ${left}` : 'Expiring soon', color: 'var(--ss-warn)' }
        : { text: 'Connected', color: 'var(--ss-green-700)' };

  return (
    <li
      className="relative flex h-[68px] w-[221px] items-center rounded-[10px] bg-white pl-[11px] pr-[28px]"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}
    >
      <span className="relative block h-[51.6px] w-[53.2px] shrink-0">
        <span
          className="absolute left-0 top-0 flex h-[47px] w-[47px] items-center justify-center overflow-hidden rounded-full"
          style={{ background: '#F8F8F8', boxShadow: 'inset 0 0 0 1.188px rgba(120,120,120,0.28)' }}
        >
          {p.accountAvatarUrl && !avatarFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- a provider's avatar URL, not a local asset
            <img
              src={p.accountAvatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <PlatformIcon platform={p.platform} size={28} />
          )}
        </span>
        <span className="absolute left-[26.7px] top-[25.1px] flex h-[26.5px] w-[26.5px] items-center justify-center rounded-full bg-white">
          <PlatformIcon platform={p.platform} size={22} />
        </span>
      </span>

      <span className="ml-[9px] min-w-0">
        <span className="block truncate text-16 font-semibold text-black" title={p.accountLabel ?? platformLabel(p.platform)}>
          {p.accountLabel ?? platformLabel(p.platform)}
        </span>
        {p.status === 'expired' || p.status === 'expiring' ? (
          <button
            type="button"
            onClick={onReconnect}
            disabled={busy}
            className="mt-[3px] block text-12 font-semibold underline underline-offset-2"
            style={{ color: health.color }}
          >
            {busy ? <Busy size={14}>Opening…</Busy> : `${health.text} · Reconnect`}
          </button>
        ) : (
          <span className="mt-[3px] flex items-center gap-[6px] text-12" style={{ color: health.color }}>
            <span aria-hidden className="block h-[7px] w-[7px] rounded-full" style={{ background: 'var(--ss-set-online)' }} />
            {health.text}
          </span>
        )}
      </span>

      <button
        type="button"
        onClick={onDisconnect}
        aria-label={`Disconnect ${platformLabel(p.platform)}${p.accountLabel ? ` (${p.accountLabel})` : ''}`}
        title="Disconnect"
        className="absolute right-[9px] top-[9px] flex h-[18px] w-[18px] items-center justify-center rounded-full transition-colors hover:bg-[rgba(131,131,131,0.15)]"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M1 1l8 8M9 1 1 9" stroke="rgb(131,131,131)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}
