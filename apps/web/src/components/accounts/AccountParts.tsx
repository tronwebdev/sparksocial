'use client';

import { useState } from 'react';
import { platformLabel } from '@/lib/platforms';
import { cn } from '@/lib/utils';
import { PlatformIcon } from '@/components/common/PlatformIcon';
import { Busy } from '@/components/brand/SparkLoader';

/**
 * A connected account, drawn the one way the prototypes draw it.
 *
 * Four designs show accounts and every one is the same idea — the account's
 * own picture in a disc, with the platform's mark on its lower right:
 *
 *   Settings WS Social Accounts  the 221x68 chip: a 46.97 disc on `#F8F8F8`
 *   Create Campaign (step 4)     in a 1.188 `rgba(120,120,120,.28)` ring, the
 *                                mark 26.49 at 26.75,25.09 (bare); the name at
 *                                73,25 in 16/600; the × 12.76 at 197,11
 *   Automation (Name & accounts) a 58px pill: a 41 disc, the mark 16 in a white
 *                                circle at right/bottom −2
 *   Automation (review)          a 46 disc, the mark 13 in a 17 white rounded
 *                                square at right/bottom −2
 *
 * They had been built five different ways — a coloured letter block, a bare
 * platform icon in a grey circle, a name in a text pill — so the same account
 * looked like a different thing on each screen. These are the pieces; the
 * screens arrange them.
 *
 * The picture is the provider's avatar when it gave one, and the platform's
 * mark when it did not or when the URL has stopped resolving (signed avatar
 * URLs do, weeks later) — never a broken image.
 */

export interface AccountLike {
  platform: string;
  accountLabel?: string;
  accountAvatarUrl?: string;
}

export function accountName(a: AccountLike): string {
  return a.accountLabel ?? platformLabel(a.platform);
}

const BADGE = {
  /* The chip's: the mark itself, no backing, overlapping the disc. */
  chip: { ratio: 26.49 / 46.97, at: [26.75 / 46.97, 25.09 / 46.97] },
} as const;

export function AccountAvatar({
  account,
  size = 46.97,
  badge = 'chip',
  className,
}: {
  account: AccountLike;
  size?: number;
  /** `chip` — the settings/campaign chip; `pill` — automation's picker; `square` — automation's review. */
  badge?: 'chip' | 'pill' | 'square' | 'none';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(account.accountAvatarUrl) && !failed;
  const chipBadge = badge === 'chip' ? Math.round(size * BADGE.chip.ratio * 10) / 10 : 0;

  return (
    <span
      aria-hidden
      className={cn('relative block shrink-0', className)}
      style={{
        width: badge === 'chip' ? size * BADGE.chip.at[0] + chipBadge : size,
        height: badge === 'chip' ? size * BADGE.chip.at[1] + chipBadge : size,
      }}
    >
      <span
        className="absolute left-0 top-0 flex items-center justify-center overflow-hidden rounded-full"
        style={{ width: size, height: size, background: '#F8F8F8', boxShadow: 'inset 0 0 0 1.188px rgba(120,120,120,0.28)' }}
      >
        {showPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element -- a provider's avatar URL, not a local asset
          <img
            src={account.accountAvatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <PlatformIcon platform={account.platform} size={Math.round(size * 0.56)} />
        )}
      </span>

      {badge === 'chip' && showPhoto ? (
        <span className="absolute" style={{ left: size * BADGE.chip.at[0], top: size * BADGE.chip.at[1] }}>
          <PlatformIcon platform={account.platform} size={chipBadge} />
        </span>
      ) : null}
      {badge === 'pill' && showPhoto ? (
        <span
          className="absolute -bottom-[2px] -right-[2px] flex h-[16px] w-[16px] items-center justify-center rounded-full bg-white"
          style={{ boxShadow: '0 0 0 1px rgba(12,12,12,0.08)' }}
        >
          <PlatformIcon platform={account.platform} size={13} />
        </span>
      ) : null}
      {/* Badges only on a photo: on the platform's own mark they would draw
          the same logo twice. */}
      {badge === 'square' && showPhoto ? (
        <span
          className="absolute -bottom-[2px] -right-[2px] flex h-[17px] w-[17px] items-center justify-center rounded-[5px] bg-white"
          style={{ boxShadow: '0 0 0 1px rgba(12,12,12,0.08)' }}
        >
          <PlatformIcon platform={account.platform} size={13} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * The 221x68 chip. `status` is the one fact the design's chip has no room
 * for — an account whose access is running out — and is only drawn then; a
 * healthy chip is exactly the design's.
 */
export function AccountChip({
  account,
  onRemove,
  removeLabel,
  status,
}: {
  account: AccountLike;
  onRemove?: () => void;
  removeLabel?: string;
  status?: React.ReactNode;
}) {
  return (
    <div
      className="relative h-[68px] w-[221px] shrink-0 rounded-[10px] bg-white"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}
    >
      <AccountAvatar account={account} className="absolute left-[11px] top-[9px]" />
      <span
        className={cn(
          'absolute left-[73px] right-[28px] block truncate text-16 font-semibold leading-none text-black',
          status ? 'top-[17px]' : 'top-[25px]',
        )}
        title={accountName(account)}
      >
        {accountName(account)}
      </span>
      {status ? <span className="absolute left-[73px] right-[10px] top-[38px] block truncate text-12">{status}</span> : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? `Remove ${accountName(account)}`}
          title={removeLabel}
          className="absolute left-[193px] top-[7px] flex h-[21px] w-[21px] items-center justify-center rounded-full transition-colors hover:bg-[rgba(131,131,131,0.15)]"
        >
          <svg width="12.76" height="12.76" viewBox="0 0 12.764 12.764" fill="none" aria-hidden>
            <path d="M1.5 1.5l9.764 9.764M11.264 1.5 1.5 11.264" stroke="rgb(131,131,131)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

const TILE = {
  /* Settings WS Social Accounts: 129.51x103.19 r10.53, mark 47.12 at top 14.74, name 14.74/600 at 68.44. */
  settings: { w: 129.51, h: 103.19, r: 10.53, mark: 47.12, markTop: 14.74, labelTop: 68.44, font: 14.74 },
  /* Create Campaign step 4: 123x98 r10, mark ~45 at top 14, name 14/600 at 65. */
  campaign: { w: 123, h: 98, r: 10, mark: 44.75, markTop: 14, labelTop: 65, font: 14 },
} as const;

/**
 * Marks the designs draw smaller than the rest on the same tile. X is a solid
 * black square where the others are open shapes, so both designs set it at
 * 39.45 of 47.12 (and 37.47 of 44.75) — 84% — centred in the same space.
 */
const MARK_SCALE: Record<string, number> = { x: 0.837 };

/**
 * The platform tile — the mark and the name, and nothing else, as both designs
 * draw it. State is carried the way the designs carry it: opacity. A tile that
 * cannot be used is at the design's 40%; `title` and the accessible name say
 * why, and `connected` adds the one mark a tile needs to not read as an offer.
 */
export function PlatformTile({
  platform,
  size = 'settings',
  dim = false,
  connected = false,
  busy = false,
  disabled = false,
  pressed,
  title,
  ariaLabel,
  onClick,
}: {
  platform: string;
  size?: keyof typeof TILE;
  /** Drawn at the design's reduced opacity. */
  dim?: boolean | number;
  connected?: boolean;
  busy?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  title?: string;
  ariaLabel: string;
  onClick?: () => void;
}) {
  const t = TILE[size];
  const opacity = typeof dim === 'number' ? dim : dim ? 0.4 : 1;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      className="relative shrink-0 bg-white transition-[opacity,box-shadow] duration-200 enabled:hover:shadow-[inset_0_0_0_1.4px_rgba(12,12,12,0.3)] disabled:cursor-default"
      style={{ width: t.w, height: t.h, borderRadius: t.r, opacity, boxShadow: 'inset 0 0 0 1.053px rgba(12,12,12,0.1)' }}
    >
      <span
        className="absolute left-1/2 block -translate-x-1/2"
        style={{ top: t.markTop + (t.mark * (1 - (MARK_SCALE[platform] ?? 1))) / 2 }}
      >
        <PlatformIcon platform={platform} size={t.mark * (MARK_SCALE[platform] ?? 1)} />
      </span>
      <span
        className="absolute inset-x-0 block truncate px-[6px] text-center font-semibold leading-none text-black"
        style={{ top: t.labelTop, fontSize: t.font }}
      >
        {busy ? <Busy size={14}>Opening…</Busy> : platformLabel(platform)}
      </span>
      {connected ? (
        <span
          aria-hidden
          className="absolute right-[8px] top-[8px] flex h-[16px] w-[16px] items-center justify-center rounded-full"
          style={{ background: 'var(--ss-set-online)' }}
        >
          <svg width="8" height="7" viewBox="0 0 9 8" fill="none">
            <path d="m1 4 2.2 2.2L8 1" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : null}
    </button>
  );
}
