'use client';

import { PlatformIcon } from '@/components/common/PlatformIcon';
import { InfoIcon, PANEL_CLIP, StepPanel } from './campaignChrome';
import { platformLabel } from '@/lib/platforms';
import { Busy, SparkLoader } from '@/components/brand/SparkLoader';

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
  /** Posts through another platform's connection; Connect goes to that one. */
  connectedVia?: string;
  /** `credentials` is a handle and app password (Bluesky), not a consent screen. */
  connectMethod?: 'oauth' | 'credentials' | 'derived';
  /** Whether Connect can lead anywhere on this deployment. */
  available?: boolean;
}

const TILE_X = [22, 160, 298, 436];
const TILE_Y = [326, 436, 546, 656];

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
  /* Accounts, not platforms: Stories and Facebook post through Instagram's
     connection, and two of the design's two chips spent on one account said
     less than one would. */
  const connected = (platforms ?? []).filter((p) => p.connected && !p.connectedVia);
  const grid = (platforms ?? []).filter((p) => p.supported);

  return (
    <StepPanel x={218} y={237} w={592} h={756} clip={PANEL_CLIP.s4}>
      <h2 className="absolute left-[24px] top-[42px] whitespace-nowrap text-26 font-semibold leading-[1.43] text-black">
        Add Social Account
      </h2>
      <p className="absolute left-[24px] top-[79px] w-[431px] text-18 font-normal leading-[0.9987]" style={{ color: 'rgb(131,131,131)' }}>
        Connect your social media accounts to enhance your online presence.
      </p>

      <span className="absolute left-[25px] top-[155px] whitespace-nowrap text-18 font-medium leading-none text-ink">
        Preselected Accounts
      </span>
      <InfoIcon className="absolute left-[218px] top-[156px]" title="Everything you have connected is selected to start. Untick any this campaign should skip." />

      {connected.length === 0 ? (
        <p className="absolute left-[24px] top-[196px] w-[440px] text-16 font-normal leading-[1.35]" style={{ color: 'rgb(131,131,131)' }}>
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
            <span
              className="absolute left-[11px] top-[9px] flex h-[47px] w-[47px] items-center justify-center rounded-full"
              style={{ background: '#F8F8F8', boxShadow: 'inset 0 0 0 1.188px rgba(120,120,120,0.28)' }}
            >
              <PlatformIcon platform={p.platform} size={28} />
            </span>
            <span className="absolute left-[73px] top-[25px] block max-w-[120px] truncate text-16 font-semibold leading-none text-black">
              {p.accountLabel ?? platformLabel(p.platform)}
            </span>
            <button
              type="button"
              onClick={() => onToggle(p.platform)}
              aria-label={`${selected.includes(p.platform) ? 'Remove' : 'Add'} ${platformLabel(p.platform)}`}
              className="absolute left-[195px] top-[9px] flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full text-13 leading-none transition-colors hover:bg-surface-200"
              style={{ color: 'rgb(131,131,131)' }}
            >
              {selected.includes(p.platform) ? '✕' : '+'}
            </button>
          </div>
        ))
      )}

      <span className="absolute left-[25px] top-[292px] whitespace-nowrap text-18 font-medium leading-none text-ink">
        + Add Accounts
      </span>

      {platforms === null ? (
        // 323, not 330: the 30px mark centres on the line, 7px above where the text sat.
        <SparkLoader size="inline" label="Reading your connections…" className="absolute left-[25px] top-[323px]" />
      ) : (
        grid.map((p, i) => {
          const on = selected.includes(p.platform);
          /* What Connect actually connects: Stories and Facebook post through
             another platform's account, and asking for their own was refused. */
          const target = p.connectedVia ?? p.platform;
          const owner = (platforms ?? []).find((x) => x.platform === target);
          const available = p.connected || owner?.available !== false;
          return (
            <button
              key={p.platform}
              type="button"
              onClick={() => (p.connected ? onToggle(p.platform) : onConnect(target))}
              disabled={!available}
              title={available ? undefined : `${platformLabel(p.platform)} isn’t set up for this workspace yet.`}
              aria-pressed={p.connected ? on : undefined}
              className="absolute h-cmp-tile-h w-cmp-tile cursor-pointer rounded bg-white transition-opacity duration-200 disabled:cursor-default"
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
                <PlatformIcon platform={p.platform} size={44} />
              </span>
              <span className="absolute inset-x-0 top-[65px] block truncate px-[6px] text-center text-14 font-semibold leading-none text-black">
                {platformLabel(p.platform)}
              </span>
              {/* The one fact the design's tile has no room for, and the one
                  that decides whether choosing it means anything. */}
              {!p.connected ? (
                <span className="absolute inset-x-0 top-[81px] block text-center text-11 font-medium" style={{ color: 'rgb(131,131,131)' }}>
                  {connecting === target ? (
                    <Busy size={14}>Opening…</Busy>
                  ) : !available ? (
                    'Not available yet'
                  ) : p.connectedVia ? (
                    `Connects with ${platformLabel(p.connectedVia)}`
                  ) : (
                    'Connect'
                  )}
                </span>
              ) : null}
            </button>
          );
        })
      )}
    </StepPanel>
  );
}
