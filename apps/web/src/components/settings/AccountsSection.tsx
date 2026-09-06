'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { platformLabel } from '@/lib/platforms';
import { PublishHealthPanel } from './PublishHealthPanel';

/**
 * `Settings WS Social Accounts`, measured relative to the 1350 content card:
 *
 *   "Preselected Accounts"  31,125 · 18/500
 *   connected chips         30,167 · 221x68 r10 white, on a 233 pitch
 *   "+ Add Accounts"        28,273 · 18/500
 *   platform tiles          28,321 · 130x103 r10.529 white, on a 145.5 pitch,
 *                           the label 14.741/600 centred at +68
 *
 * ── What the tiles are, and the state the design has no room for ──────────
 *
 * The prototype draws thirteen fixed tiles, four of which (Sora, Medium,
 * WordPress, Shopify) are not platforms this product publishes to. The grid is
 * filled from `integration.health` instead — the fourteen the publisher
 * actually supports — in the design's geometry.
 *
 * A tile has to carry two facts the design's single state cannot: whether the
 * account is connected, and whether it is healthy. Connected tiles are opaque
 * with a green dot; the rest are dimmed and say "Connect", which starts
 * `integration.connect`. Without that, a grid of identical tiles would let
 * somebody believe they had connected everything on the screen.
 */

interface Platform {
  platform: string;
  connected: boolean;
  accountLabel?: string;
  supported: boolean;
}

const TINT: Record<string, string> = {
  instagram: '#E1306C',
  instagram_story: '#E1306C',
  facebook: '#1877F2',
  facebook_group: '#1877F2',
  linkedin: '#0A66C2',
  x: '#0C0C0C',
  tiktok: '#010101',
  youtube_shorts: '#FF0000',
  youtube_long: '#FF0000',
  threads: '#0C0C0C',
  pinterest: '#E60023',
  google_business: '#4285F4',
  reddit: '#FF4500',
  bluesky: '#0085FF',
};

function Mark({ platform, size = 45 }: { platform: string; size?: number }) {
  const letter = platformLabel(platform).replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className="flex items-center justify-center rounded-[12px] font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.44, background: TINT[platform] ?? '#838383' }}
    >
      {letter}
    </span>
  );
}

export function AccountsSection() {
  const [platforms, setPlatforms] = useState<Platform[] | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await invoke<{ platforms: Platform[] }>('integration.health', {});
    if (res.status !== 'succeeded') {
      setPlatforms([]);
      setError(res.status === 'failed' ? res.error.message : 'Reading connections needs an approval.');
      return;
    }
    setPlatforms(res.output.platforms);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Coming back from a provider's consent screen should show the new account. */
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [load]);

  async function connect(platform: string) {
    setConnecting(platform);
    setError(null);
    const res = await invoke<{ authorizeUrl: string }>('integration.connect', { platform });
    setConnecting(null);
    if (res.status !== 'succeeded') {
      setError(
        res.status === 'failed'
          ? res.error.message
          : 'Connecting an account needs an approval this screen cannot give.',
      );
      return;
    }
    window.open(res.output.authorizeUrl, '_blank', 'noopener');
  }

  const connected = (platforms ?? []).filter((p) => p.connected);
  const grid = (platforms ?? []).filter((p) => p.supported);

  return (
    <div className="grid grid-cols-1 gap-[34px]">
      <section>
        <p className="text-18 font-medium text-ink">Preselected Accounts</p>

        {platforms === null ? (
          <p className="mt-[14px] text-16" style={{ color: 'rgb(131,131,131)' }}>Reading your connections…</p>
        ) : connected.length === 0 ? (
          <p className="mt-[14px] max-w-[620px] text-16 leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
            Nothing is connected yet. Pick a platform below — a brand with no account has nowhere to
            publish.
          </p>
        ) : (
          <ul className="mt-[16px] flex flex-wrap gap-[12px]">
            {connected.map((p) => (
              <li
                key={p.platform}
                className="flex h-[68px] w-[221px] items-center gap-[12px] rounded-[10px] bg-white px-[11px]"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}
              >
                <Mark platform={p.platform} size={47} />
                <span className="min-w-0">
                  <span className="block truncate text-16 font-semibold text-black">
                    {p.accountLabel ?? platformLabel(p.platform)}
                  </span>
                  <span className="mt-[3px] flex items-center gap-[6px] text-[13px]" style={{ color: 'var(--ss-green-700)' }}>
                    <span aria-hidden className="block h-[7px] w-[7px] rounded-full" style={{ background: 'var(--ss-set-online)' }} />
                    Connected
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <p className="text-18 font-medium text-ink">+ Add Accounts</p>

        <ul className="mt-[16px] flex flex-wrap gap-[15px]">
          {grid.map((p) => (
            <li key={p.platform}>
              <button
                type="button"
                onClick={() => (p.connected ? undefined : void connect(p.platform))}
                disabled={p.connected}
                aria-label={p.connected ? `${platformLabel(p.platform)} is connected` : `Connect ${platformLabel(p.platform)}`}
                className="flex h-[103px] w-[130px] flex-col items-center justify-center gap-[9px] rounded-[10.529px] bg-white transition-shadow disabled:cursor-default"
                style={{
                  boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)',
                  opacity: p.connected ? 1 : 0.55,
                }}
              >
                <Mark platform={p.platform} />
                <span className="max-w-full truncate px-[6px] text-center text-[14.741px] font-semibold text-black">
                  {platformLabel(p.platform)}
                </span>
                {!p.connected ? (
                  <span className="text-[11.5px] font-medium" style={{ color: 'rgb(131,131,131)' }}>
                    {connecting === p.platform ? 'Opening…' : 'Connect'}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        {error ? <p className="mt-[16px] text-16 text-destructive">{error}</p> : null}
      </section>

      {/* Publishing health is the other half of "is this account working". */}
      <PublishHealthPanel />
    </div>
  );
}
