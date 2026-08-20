'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';

/**
 * `integration.health` — real since 18 Aug 2026, replacing `publish.status`
 * as this panel's data source. `publish.status` only ever reported routing
 * (which adapter would serve a platform); `integration.health` adds the
 * thing that was actually missing — whether this brand has connected a
 * real account for it — plus the Connect/Disconnect actions themselves
 * (`integration.connect`, `brand.oauth.disconnect` widened to cover native
 * platforms too, see `packages/agency/src/canva.ts`'s own comment on why).
 *
 * The connect round trip mirrors `ConnectionsPanel.tsx`'s Canva flow
 * exactly: `integration.connect` only mints an authorize URL, the actual
 * connection completes on the platform's redirect back to the API
 * (apps/api/src/social-oauth.ts), which bounces the browser back here with
 * `?social=connected&provider=X|denied|failed` — read once on mount.
 */

type ConnectionStatus = 'not_connected' | 'ok' | 'expiring' | 'expired';

interface PlatformStatus {
  platform: string;
  connected: boolean;
  /** PRD §10's health indicator, computed server-side so this panel and the alert agree. */
  status: ConnectionStatus;
  accountLabel?: string;
  expiresAt?: string;
  hoursUntilExpiry: number | null;
  supported: boolean;
  via: string | null;
}

interface Attention {
  platform: string;
  status: ConnectionStatus;
  detail: string;
}

/**
 * The badge is the whole point of §10's "health indicator": a token that expired
 * last Tuesday used to render identically to a healthy one, because both were
 * `connected: true`. `expiring` is amber rather than red on purpose — it is the
 * one state where acting now prevents a missed post instead of explaining one,
 * and dressing it as a failure would train people to ignore the red.
 */
const STATUS_BADGE: Record<ConnectionStatus, { variant: 'success' | 'warn' | 'destructive' | 'neutral'; label: string }> = {
  ok: { variant: 'success', label: 'connected' },
  expiring: { variant: 'warn', label: 'expiring' },
  expired: { variant: 'destructive', label: 'expired' },
  not_connected: { variant: 'neutral', label: 'not connected' },
};

function expiryNote(p: PlatformStatus): string | null {
  if (p.status === 'expired') return 'Access expired — posts to this account will fail until you reconnect.';
  if (p.status !== 'expiring' || p.hoursUntilExpiry === null) return null;
  const days = Math.round(p.hoursUntilExpiry / 24);
  // Under a day is stated in hours: "expires in 0 days" is the kind of rounding
  // that makes a warning easy to dismiss on the one day it matters most.
  return days >= 1
    ? `Expires in ${days} day${days === 1 ? '' : 's'} — reconnect before it does.`
    : `Expires in under ${Math.max(1, Math.round(p.hoursUntilExpiry))} hours — reconnect now.`;
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube_shorts: 'YouTube Shorts',
};

export function PublishHealthPanel() {
  const { genome } = useSelectedGenome();
  const [platforms, setPlatforms] = useState<PlatformStatus[] | null>(null);
  const [attention, setAttention] = useState<Attention[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await invoke<{ platforms: PlatformStatus[]; needsAttention: Attention[] }>('integration.health', {});
    setLoading(false);
    if (res.status === 'succeeded') {
      setPlatforms(res.output.platforms);
      setAttention(res.output.needsAttention);
      setError(null);
    } else {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const social = params.get('social');
    if (!social) return;
    const provider = params.get('provider');
    const label = provider ? (PLATFORM_LABEL[provider] ?? provider) : 'Platform';
    if (social === 'connected') setMessage({ kind: 'ok', text: `${label} connected.` });
    else if (social === 'denied') setMessage({ kind: 'err', text: 'Connection was cancelled.' });
    else if (social === 'failed') setMessage({ kind: 'err', text: 'Connection failed — check apps/api logs for the vendor error.' });
    window.history.replaceState(null, '', window.location.pathname);
    void load();
  }, [load]);

  async function connect(platform: string) {
    if (!genome) return;
    setBusyPlatform(platform);
    setMessage(null);
    const res = await invoke<{ authorizeUrl: string }>('integration.connect', { genomeId: genome.genomeId, provider: platform });
    if (res.status === 'succeeded') {
      window.location.href = res.output.authorizeUrl;
      return;
    }
    setBusyPlatform(null);
    setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
  }

  async function disconnect(platform: string) {
    if (!genome) return;
    setBusyPlatform(platform);
    setMessage(null);
    const res = await invoke<{ removed: boolean }>('brand.oauth.disconnect', { genomeId: genome.genomeId, provider: platform });
    setBusyPlatform(null);
    if (res.status === 'succeeded') {
      setMessage({ kind: 'ok', text: 'Disconnected.' });
      await load();
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">Publishing health</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Connect this brand&rsquo;s own account per platform, and see which adapter (native once connected, the
            stub otherwise) and how much posting budget is left today.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
      {message ? (
        <p className={`mt-3 text-[13px] ${message.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>{message.text}</p>
      ) : null}

      {/* Above the list, not inside it: a connection three days from expiry is
          the one thing on this screen worth reading, and it should not have to
          be found among eleven rows. Mirrors the notification the watcher
          sends, so the two never say different things. */}
      {attention.length > 0 ? (
        <div className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3">
          <p className="text-[13px] font-medium text-ink">
            {attention.length === 1 ? 'One connection needs attention' : `${attention.length} connections need attention`}
          </p>
          <ul className="mt-1 list-inside list-disc text-[13px] text-ink-muted">
            {attention.map((a) => (
              <li key={a.platform}>{a.detail}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4">
        {platforms === null ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {platforms.map((p) => (
              <li key={p.platform} className="flex items-center justify-between gap-3 rounded border border-border p-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">{PLATFORM_LABEL[p.platform] ?? p.platform}</p>
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    {p.connected ? `Connected${p.accountLabel ? ` — ${p.accountLabel}` : ''}` : 'Not connected'}
                    {p.supported ? ` · via ${p.via}` : ' · no adapter configured'}
                  </p>
                  {expiryNote(p) ? (
                    <p className={`mt-0.5 text-[12px] ${p.status === 'expired' ? 'text-destructive' : 'text-warn'}`}>{expiryNote(p)}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={STATUS_BADGE[p.status].variant}>{STATUS_BADGE[p.status].label}</Badge>
                  {p.connected ? (
                    <>
                      {/* §10's retry flow, at the human end: an expired token is
                          fixed by reconnecting, and making somebody disconnect
                          first is a step that exists only because the UI was
                          missing a button. */}
                      {p.status === 'expiring' || p.status === 'expired' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyPlatform === p.platform || !genome}
                          onClick={() => void connect(p.platform)}
                        >
                          {busyPlatform === p.platform ? 'Redirecting…' : 'Reconnect'}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" disabled={busyPlatform === p.platform} onClick={() => void disconnect(p.platform)}>
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busyPlatform === p.platform || !genome} onClick={() => void connect(p.platform)}>
                      {busyPlatform === p.platform ? 'Redirecting…' : 'Connect'}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
