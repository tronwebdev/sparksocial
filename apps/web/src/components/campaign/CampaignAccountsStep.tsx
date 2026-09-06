'use client';

import { InfoIcon, PANEL_CLIP, StepPanel } from './campaignChrome';
import { platformLabel } from '@/lib/platforms';

/**
 * `Step 4 — Add Social Account`.
 *
 *   panel     218,237 · 592×756 (its wash is 749), clip `s4`
 *   chips     24,193 and 257,193 · 221×68 r10 — the accounts already connected
 *   tiles     x 22 / 160 / 298 / 436 · y 326 / 436 / 546 / 656 · 123×98 r10,
 *             `transition: opacity 0.2s`, **1 when selected, 0.3 when not**
 *
 * ── What the tiles are ────────────────────────────────────────────────────
 *
 * The design draws thirteen fixed tiles, four of which (Sora, Medium,
 * WordPress, Shopify) are not platforms this product publishes to. The grid is
 * filled from `integration.health` instead — the fourteen the publisher
 * actually supports — in the design's geometry.
 *
 * The design's tile has one state, opacity. A real tile has two facts to carry:
 * whether the account is *connected* and whether this campaign is *posting to
 * it*. Opacity carries the second, as designed. The first is a hairline ring
 * and a "Connect" affordance, because a tile that dims and undims while
 * nothing is connected behind it would let someone finish the wizard having
 * chosen four accounts that cannot receive a post.
 */

export interface PlatformStatus {
  platform: string;
  connected: boolean;
  accountLabel?: string;
  supported: boolean;
}

const TILE_X = [22, 160, 298, 436];
const TILE_Y = [326, 436, 546, 656];

/** A mark per platform, since the prototype's PNG sprites are not in the app. */
function PlatformMark({ platform }: { platform: string }) {
  const letter = platformLabel(platform).replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || '?';
  const tint: Record<string, string> = {
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
  return (
    <span
      aria-hidden
      className="flex h-[44px] w-[44px] items-center justify-center rounded-[12px] text-[20px] font-bold text-white"
      style={{ background: tint[platform] ?? '#838383' }}
    >
      {letter}
    </span>
  );
}

export function AccountsStep({
  platforms,
  selected,
  onToggle,
  onConnect,
  connecting,
}: {
  platforms: PlatformStatus[] | null;
  selected: string[];
  onToggle: (platform: string) => void;
  onConnect: (platform: string) => void;
  connecting: string | null;
}) {
  const connected = (platforms ?? []).filter((p) => p.connected);
  const grid = (platforms ?? []).filter((p) => p.supported);

  return (
    <StepPanel x={218} y={237} w={592} h={756} clip={PANEL_CLIP.s4}>
      <h2 className="absolute left-[24px] top-[42px] whitespace-nowrap text-[25px] font-semibold leading-[1.43] text-black">
        Add Social Account
      </h2>
      <p className="absolute left-[24px] top-[79px] w-[431px] text-[18px] font-normal leading-[0.9987]" style={{ color: 'rgb(131,131,131)' }}>
        Connect your social media accounts to enhance your online presence.
      </p>

      <span className="absolute left-[25px] top-[155px] whitespace-nowrap text-[18px] font-medium leading-none text-ink">
        Preselected Accounts
      </span>
      <InfoIcon className="absolute left-[218px] top-[156px]" title="Everything you have connected is selected to start. Untick any this campaign should skip." />

      {connected.length === 0 ? (
        <p className="absolute left-[24px] top-[196px] w-[440px] text-[16px] font-normal leading-[1.35]" style={{ color: 'rgb(131,131,131)' }}>
          Nothing is connected yet. Pick a platform below and connect it — a campaign with no account
          has nowhere to publish.
        </p>
      ) : (
        connected.slice(0, 2).map((p, i) => (
          <div
            key={p.platform}
            className="absolute h-[68px] w-[221px] rounded bg-white"
            style={{ left: i === 0 ? 24 : 257, top: 193, boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}
          >
            <span className="absolute left-[11px] top-[9px] block">
              <PlatformMark platform={p.platform} />
            </span>
            <span className="absolute left-[73px] top-[25px] block max-w-[120px] truncate text-[16px] font-semibold leading-none text-black">
              {p.accountLabel ?? platformLabel(p.platform)}
            </span>
            <button
              type="button"
              onClick={() => onToggle(p.platform)}
              aria-label={`${selected.includes(p.platform) ? 'Remove' : 'Add'} ${platformLabel(p.platform)}`}
              className="absolute left-[195px] top-[9px] flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full text-[13px] leading-none transition-colors hover:bg-surface-200"
              style={{ color: 'rgb(131,131,131)' }}
            >
              {selected.includes(p.platform) ? '✕' : '+'}
            </button>
          </div>
        ))
      )}

      <span className="absolute left-[25px] top-[292px] whitespace-nowrap text-[18px] font-medium leading-none text-ink">
        + Add Accounts
      </span>

      {platforms === null ? (
        <p className="absolute left-[25px] top-[330px] text-[16px]" style={{ color: 'rgb(131,131,131)' }}>
          Reading your connections…
        </p>
      ) : (
        grid.map((p, i) => {
          const on = selected.includes(p.platform);
          return (
            <button
              key={p.platform}
              type="button"
              onClick={() => (p.connected ? onToggle(p.platform) : onConnect(p.platform))}
              aria-pressed={p.connected ? on : undefined}
              className="absolute h-cmp-tile-h w-cmp-tile cursor-pointer rounded bg-white transition-opacity duration-200"
              style={{
                left: TILE_X[i % 4],
                top: TILE_Y[Math.floor(i / 4)],
                opacity: p.connected && on ? 1 : 0.3,
                boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = 'inset 0 0 0 1.4px rgba(12,12,12,0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(12,12,12,0.1)';
              }}
            >
              <span className="absolute left-1/2 top-[14px] block -translate-x-1/2">
                <PlatformMark platform={p.platform} />
              </span>
              <span className="absolute inset-x-0 top-[65px] block truncate px-[6px] text-center text-[14px] font-semibold leading-none text-black">
                {platformLabel(p.platform)}
              </span>
              {/* The one fact the design's tile has no room for, and the one
                  that decides whether choosing it means anything. */}
              {!p.connected ? (
                <span className="absolute inset-x-0 top-[81px] block text-center text-[11px] font-medium" style={{ color: 'rgb(131,131,131)' }}>
                  {connecting === p.platform ? 'Opening…' : 'Connect'}
                </span>
              ) : null}
            </button>
          );
        })
      )}
    </StepPanel>
  );
}
