'use client';

import { AccountChip, PlatformTile, accountName } from '@/components/accounts/AccountParts';
import { InfoIcon, PANEL_CLIP, StepPanel } from './campaignChrome';
import { platformLabel } from '@/lib/platforms';
import { SparkLoader } from '@/components/brand/SparkLoader';

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
 * The design's tile has one state, opacity, and the design's chips are the
 * selection: a tile toggles its account in and out, and a chip's × takes it
 * out. Both are drawn that way here, with the shared `AccountChip` and
 * `PlatformTile`. A tile for a platform with nothing connected behind it is
 * never selectable — pressing it starts connecting it instead — so the wizard
 * cannot be finished with accounts that cannot receive a post. One that
 * cannot be connected on this deployment is disabled and says why on hover.
 */

export interface PlatformStatus {
  platform: string;
  connected: boolean;
  accountLabel?: string;
  supported: boolean;
  accountAvatarUrl?: string;
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
  const byPlatform = new Map((platforms ?? []).map((p) => [p.platform, p]));
  /* The chips are the selection, as the design draws them. A platform that
     posts through another's account (Stories, Facebook) is still its own
     target here, so it gets its own chip, named for the account it uses. */
  const chosen = selected
    .map((platform) => byPlatform.get(platform))
    .filter((p): p is PlatformStatus => Boolean(p?.connected));
  const anyConnected = (platforms ?? []).some((p) => p.connected);
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

      {chosen.length === 0 ? (
        <p className="absolute left-[24px] top-[196px] w-[440px] text-16 font-normal leading-[1.35]" style={{ color: 'rgb(131,131,131)' }}>
          {anyConnected
            ? 'No account is selected. Pick the ones this campaign posts to from the platforms below.'
            : 'Nothing is connected yet. Pick a platform below and connect it — a campaign with no account has nowhere to publish.'}
        </p>
      ) : (
        /* 24,193 and 257,193 in the design — two chips on a 233 pitch. More
           than two scroll sideways in the same row rather than pushing the
           tiles down. */
        <ul className="absolute left-[24px] top-[193px] flex w-[544px] gap-[12px] overflow-x-auto pb-[4px]">
          {chosen.map((p) => {
            const owner = p.connectedVia ? byPlatform.get(p.connectedVia) : undefined;
            const account = {
              platform: p.platform,
              accountLabel: owner
                ? `${accountName(owner)} · ${platformLabel(p.platform)}`
                : p.accountLabel,
              accountAvatarUrl: p.accountAvatarUrl ?? owner?.accountAvatarUrl,
            };
            return (
              <li key={p.platform}>
                <AccountChip
                  account={account}
                  onRemove={() => onToggle(p.platform)}
                  removeLabel={`Don’t post to ${accountName(account)}`}
                />
              </li>
            );
          })}
        </ul>
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
          const owner = byPlatform.get(target);
          const available = p.connected || owner?.available !== false;
          return (
            <span
              key={p.platform}
              className="absolute"
              style={{ left: TILE_X[i % 4], top: TILE_Y[Math.floor(i / 4)] }}
            >
              <PlatformTile
                platform={p.platform}
                size="campaign"
                dim={p.connected && on ? 1 : 0.3}
                busy={connecting === target}
                disabled={!available}
                pressed={p.connected ? on : undefined}
                onClick={() => (p.connected ? onToggle(p.platform) : onConnect(target))}
                title={
                  !available
                    ? `${platformLabel(p.platform)} isn’t set up for this workspace yet.`
                    : !p.connected
                      ? p.connectedVia
                        ? `Connect ${platformLabel(p.connectedVia)} — ${platformLabel(p.platform)} posts through it.`
                        : `Connect ${platformLabel(p.platform)}`
                      : on
                        ? `Posting to ${platformLabel(p.platform)} — press to skip it`
                        : `Not posting to ${platformLabel(p.platform)} — press to include it`
                }
                ariaLabel={
                  !available
                    ? `${platformLabel(p.platform)} is not available yet`
                    : !p.connected
                      ? `Connect ${platformLabel(target)}`
                      : `${on ? 'Skip' : 'Post to'} ${platformLabel(p.platform)}`
                }
              />
            </span>
          );
        })
      )}
    </StepPanel>
  );
}
