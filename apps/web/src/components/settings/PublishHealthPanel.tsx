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

interface PlatformStatus {
  platform: string;
  connected: boolean;
  accountLabel?: string;
  expiresAt?: string;
  supported: boolean;
  via: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await invoke<{ platforms: PlatformStatus[] }>('integration.health', {});
    setLoading(false);
    if (res.status === 'succeeded') {
      setPlatforms(res.output.platforms);
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
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={p.connected ? 'success' : 'neutral'}>{p.connected ? 'connected' : 'not connected'}</Badge>
                  {p.connected ? (
                    <Button size="sm" variant="ghost" disabled={busyPlatform === p.platform} onClick={() => void disconnect(p.platform)}>
                      Disconnect
                    </Button>
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
