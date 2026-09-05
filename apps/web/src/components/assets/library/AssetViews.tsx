'use client';

import { formatBytes } from '../AssetsLibraryScreen';
import { assetKind, assetName, assetStamp, type Asset } from './types';

/**
 * The two halves of `Folder Assets` — `isGrid` and `isList`.
 *
 * **Grid** (`SparkSocial Assets Library.dc.html`): cards 316x338 at radius 18
 * on a 328 pitch from 352,242, each under
 * `0 16px 40px -32px rgba(12,12,12,.35)`, with
 *
 *   media    14,14 · 288x186 r12 on `#EFEFEF`
 *   chip     22,216 · h36 r9, px13 gap8, 14.5px/600
 *   preview  right 74 / top 212 · 44x44 r11 in a `rgba(131,131,131,.35)` ring
 *   remove   right 20 / top 212 · 44x44 r11 in a `rgba(243,85,37,.55)` ring,
 *            hover `rgba(243,85,37,.06)`
 *   name     22,272 · 18px/600
 *   stamp    22,302 · 15px/400 `#838383`
 *
 * **List**: one 1300-wide card at radius 18 with a 60px header
 * (`inset 0 -1px 0 rgba(131,131,131,.15)`, labels at 26/468/860/1000/1226 in
 * 16px/500 `#838383`) over 114px rows on
 * `inset 0 -1px 0 rgba(131,131,131,.1)` — a 140x76 thumb at 20,19 on
 * `#F1F1F3`, the name at 184, the meta at 468, the chip at 848, the date at
 * 1000, and two 40x40 buttons at 1220 and 1270.
 *
 * ── The design's three media modes ───────────────────────────────────────
 *
 * The prototype draws `cover`, `poster` (a 92x162 portrait card floated on the
 * well) and `circle` (a 150px disc on near-black) — a per-asset styling choice
 * in its fixture data. Nothing in `asset.retrieve` says which of the three an
 * asset wants, and guessing from the URL would be decoration pretending to be
 * data, so every asset renders `cover` and a video gets the design's play badge
 * over it. That is the mode its own fixtures use for three of four rows.
 */

const CHIP: Record<string, { bg: string; fg: string; icon: React.ReactNode }> = {
  Video: {
    bg: 'var(--ss-lib-chip-video-bg)',
    fg: 'var(--ss-lib-chip-video)',
    icon: (
      <>
        <rect x="1" y="3" width="10" height="10" rx="2.6" stroke="currentColor" strokeWidth="1.5" />
        <path d="m11 7 3.4-2.1a.5.5 0 0 1 .76.43v5.34a.5.5 0 0 1-.76.43L11 9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </>
    ),
  },
  Image: {
    bg: 'var(--ss-lib-chip-image-bg)',
    fg: 'var(--ss-lib-chip-image)',
    icon: (
      <>
        <rect x="1.2" y="2.2" width="13.6" height="11.6" rx="2.6" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="5.6" cy="6.4" r="1.4" stroke="currentColor" strokeWidth="1.3" />
        <path d="m2.5 12 3.4-3.4a1.5 1.5 0 0 1 2.1 0l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  Audio: {
    bg: 'rgba(108,232,255,0.18)',
    fg: '#2F8291',
    icon: (
      <>
        <path d="M2 9h2.2M6 4v9M9 1.5v14M12 5.5v7M14.5 9H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  PDF: {
    bg: 'rgba(243,85,37,0.12)',
    fg: '#C23E14',
    icon: (
      <>
        <path d="M2.5 2.6A1.6 1.6 0 0 1 4.1 1h5l4 4v8.4a1.6 1.6 0 0 1-1.6 1.6h-7.4a1.6 1.6 0 0 1-1.6-1.6V2.6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M9.1 1v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </>
    ),
  },
  File: {
    bg: 'rgba(131,131,131,0.14)',
    fg: '#5B5B5B',
    icon: (
      <>
        <path d="M2.5 2.6A1.6 1.6 0 0 1 4.1 1h5l4 4v8.4a1.6 1.6 0 0 1-1.6 1.6h-7.4a1.6 1.6 0 0 1-1.6-1.6V2.6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M9.1 1v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </>
    ),
  },
};

function KindChip({ mediaType, small = false }: { mediaType: string; small?: boolean }) {
  const kind = assetKind(mediaType);
  const c = CHIP[kind]!;
  return (
    <span
      className={
        small
          ? 'flex h-[36px] w-fit items-center gap-[8px] rounded-[9px] px-[12px] text-14 font-semibold'
          : 'flex h-[36px] w-fit items-center gap-[8px] rounded-[9px] px-[13px] text-[14.5px] font-semibold'
      }
      style={{ background: c.bg, color: c.fg }}
    >
      <svg width={small ? 15 : 16} height={small ? 15 : 16} viewBox="0 0 16 16" fill="none" aria-hidden>
        {c.icon}
      </svg>
      {kind}
    </span>
  );
}

export function Thumb({ asset, rounded }: { asset: Asset; rounded: string }) {
  const kind = assetKind(asset.mediaType);
  const isVideo = kind === 'Video';
  const isImage = kind === 'Image';

  /* Rendering a page of a PDF needs a renderer this screen does not carry, and
     an <img> at a PDF url paints the broken-image glyph. Its own mark and its
     filename say more than a blank tile would. */
  if (kind === 'PDF') {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-[8px] px-[12px]">
        <svg width="28" height="32" viewBox="0 0 14 16" fill="none" aria-hidden>
          <path d="M2.5 2.6A1.6 1.6 0 0 1 4.1 1h5l4 4v8.4a1.6 1.6 0 0 1-1.6 1.6h-7.4a1.6 1.6 0 0 1-1.6-1.6V2.6Z" stroke="#F35525" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M9.1 1v4h4" stroke="#F35525" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        <span className="max-w-full truncate text-[12px] font-medium text-ink-muted">PDF document</span>
      </span>
    );
  }

  return (
    <>
      {isImage || isVideo ? (
        <img
          src={asset.url}
          alt=""
          loading="lazy"
          className={`h-full w-full object-cover ${rounded}`}
          /* A blob URL from another origin can refuse a referrer'd request. */
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[12px] font-medium text-ink-muted">
          {asset.mediaType}
        </span>
      )}
      {isVideo ? (
        <svg
          width="30"
          height="32"
          viewBox="0 0 9 10"
          fill="none"
          aria-hidden
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ filter: 'drop-shadow(0 0 8px rgba(0,0,0,0.6))' }}
        >
          <path d="M8.2 3.5c1 .5 1 2 0 2.5L2.2 9.3C1.2 9.8 0 9.1 0 8V1.4C0 .3 1.2-.3 2.2.2l6 3.3Z" fill="#FFFFFF" />
        </svg>
      ) : null}
    </>
  );
}

function PreviewButton({ onClick, size }: { onClick: () => void; size: 40 | 44 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Preview"
      className="flex items-center justify-center rounded-[11px] bg-white transition-shadow hover:shadow-[inset_0_0_0_1.4px_#838383]"
      style={{ width: size, height: size, boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)', borderRadius: size === 40 ? 10 : 11 }}
    >
      <svg width={size === 40 ? 17 : 19} height={size === 40 ? 13 : 15} viewBox="0 0 19 15" fill="none" aria-hidden>
        <path d="M1.5 7.5S4.4 1.8 9.5 1.8s8 5.7 8 5.7-2.9 5.7-8 5.7-8-5.7-8-5.7Z" stroke="#5B5B5B" strokeWidth="1.4" strokeLinejoin="round" />
        <circle cx="9.5" cy="7.5" r="2.4" stroke="#5B5B5B" strokeWidth="1.4" />
      </svg>
    </button>
  );
}

function RemoveButton({ onClick, size }: { onClick: () => void; size: 40 | 44 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Delete"
      className="flex items-center justify-center bg-white transition-colors hover:bg-[rgba(243,85,37,0.06)]"
      style={{ width: size, height: size, borderRadius: size === 40 ? 10 : 11, boxShadow: 'inset 0 0 0 1px rgba(243,85,37,0.55)' }}
    >
      <svg width={size === 40 ? 13 : 14} height={size === 40 ? 15 : 16} viewBox="0 0 14 16" fill="none" aria-hidden>
        <path
          d="M1 3.8h12M5 3.5V2.2C5 1.5 5.5 1 6.2 1h1.6c.7 0 1.2.5 1.2 1.2v1.3M2.6 3.8l.7 9.7c.05.8.7 1.4 1.5 1.4h4.4c.8 0 1.45-.6 1.5-1.4l.7-9.7"
          stroke="#F35525"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M5.6 6.8v4.6M8.4 6.8v4.6" stroke="#F35525" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function AssetGrid({
  assets,
  onPreview,
  onRemove,
  onFile,
}: {
  assets: Asset[];
  onPreview: (a: Asset) => void;
  onRemove: (a: Asset) => void;
  /** Only passed in the Unfiled view — puts an asset back into a folder. */
  onFile?: (a: Asset) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-lib-asset-gap">
      {assets.map((a) => (
        <li
          key={a.assetId}
          className="relative h-lib-asset-h w-lib-asset shrink-0 rounded-[18px] bg-white"
          style={{ boxShadow: '0 16px 40px -32px rgba(12,12,12,0.35)' }}
        >
          <div className="absolute left-[14px] top-[14px] h-lib-asset-media w-[288px] overflow-hidden rounded-xl bg-lib-well">
            <Thumb asset={a} rounded="rounded-xl" />
          </div>

          <div className="absolute left-[22px] top-[216px]">
            <KindChip mediaType={a.mediaType} />
          </div>

          {/* right 20 and right 74 in the design — with both 44 wide that is a
              10px gap, not 6. */}
          <div className="absolute right-[20px] top-[212px] flex items-center gap-[10px]">
            {/* Joins the cluster rather than sitting at 22,216, which is exactly
                where the type chip is drawn — the first version put the two on
                top of each other. */}
            {onFile ? (
              <button
                type="button"
                onClick={() => onFile(a)}
                className="h-[44px] rounded-[11px] px-[12px] text-14 font-semibold text-ink transition-opacity hover:opacity-80"
                style={{ background: 'var(--ss-lib-toggle)' }}
              >
                File…
              </button>
            ) : null}
            <PreviewButton onClick={() => onPreview(a)} size={44} />
            <RemoveButton onClick={() => onRemove(a)} size={44} />
          </div>

          <p className="absolute left-[22px] right-[22px] top-[272px] truncate text-18 font-semibold text-ink" title={assetName(a)}>
            {assetName(a)}
          </p>
          <p className="absolute left-[22px] top-[302px] text-15 font-normal text-ink-muted">{assetStamp(a.createdAt)}</p>
        </li>
      ))}
    </ul>
  );
}

export function AssetList({
  assets,
  onPreview,
  onRemove,
  onFile,
}: {
  assets: Asset[];
  onPreview: (a: Asset) => void;
  onRemove: (a: Asset) => void;
  onFile?: (a: Asset) => void;
}) {
  return (
    /* Below 1300 the table scrolls in its own box rather than compressing —
       five columns of real filenames do not survive being squeezed. */
    <div className="max-w-lib-rule overflow-x-auto">
    <div
      className="w-lib-rule overflow-hidden rounded-[18px] bg-white pb-[10px]"
      style={{ boxShadow: '0 16px 40px -32px rgba(12,12,12,0.35)' }}
    >
      {/*
        The design's five columns are absolute x's on a 1300-wide card
        (26/468/860/1000/1226). A grid with those as widths puts each label and
        its cell on the same track and cannot drift apart when a filename is
        long — which absolute offsets do, as the Upcoming Contents row on the
        dashboard proved.
      */}
      <div
        className="grid h-lib-row-head items-center pl-[26px] text-16 font-medium"
        style={{ gridTemplateColumns: HEAD_COLUMNS, color: '#838383', boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.15)' }}
      >
        <span>Assets</span>
        <span>Meta Description</span>
        <span>Type</span>
        <span>Date Uploaded</span>
        <span className="text-right">Action</span>
      </div>

      <ul>
        {assets.map((a) => (
          <li
            key={a.assetId}
            className="grid h-lib-row items-center pl-[20px]"
            style={{ gridTemplateColumns: ROW_COLUMNS, boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.1)' }}
          >
            <div className="flex min-w-0 items-center gap-[24px]">
              <div className="relative h-[76px] w-lib-row-thumb shrink-0 overflow-hidden rounded-[10px] bg-lib-list-thumb">
                <Thumb asset={a} rounded="rounded-[10px]" />
              </div>
              <span className="min-w-0 truncate text-17 font-medium text-ink" title={assetName(a)}>
                {assetName(a)}
              </span>
            </div>

            <span className="min-w-0 truncate text-17 font-medium text-ink" title={a.caption ?? ''}>
              {a.caption ?? <span className="text-ink-muted">no description</span>}
            </span>

            <KindChip mediaType={a.mediaType} small />

            <span className="whitespace-nowrap text-16 font-medium text-ink">{assetStamp(a.createdAt)}</span>

            <div className="flex items-center justify-end gap-[10px] pr-[10px]">
              {onFile ? (
                <button
                  type="button"
                  onClick={() => onFile(a)}
                  className="h-[40px] rounded-[10px] px-[12px] text-14 font-semibold text-ink transition-opacity hover:opacity-80"
                  style={{ background: 'var(--ss-lib-toggle)' }}
                >
                  File…
                </button>
              ) : null}
              <PreviewButton onClick={() => onPreview(a)} size={40} />
              <RemoveButton onClick={() => onRemove(a)} size={40} />
            </div>
          </li>
        ))}
      </ul>

      {assets.some((a) => a.sizeBytes !== null) ? (
        <p className="px-[26px] pt-[12px] text-14 text-ink-muted">
          {assets.length} {assets.length === 1 ? 'file' : 'files'} ·{' '}
          {formatBytes(assets.reduce((n, a) => n + (a.sizeBytes ?? 0), 0))}
        </p>
      ) : null}
    </div>
    </div>
  );
}

/**
 * The design's column x's — labels at 26/468/860/1000/1226, row content at
 * 20 (thumb), 184 (name), 468, 848 (chip), 1000, 1220+1270 (buttons) — carried
 * as *track widths* so a label and its cell cannot drift apart the way absolute
 * offsets do when a filename runs long.
 *
 * Two corrections to the design's own numbers:
 *
 *  - Its second action button sits at 1220+50 and is 40 wide, which ends at
 *    1310 on a 1300 card: the design clips its own delete button. The cluster
 *    is right-anchored instead, which puts `Action` at 1200 rather than 1226 —
 *    26px left of the design, and the only column that moves.
 *  - There is no gap and no right padding on the grid, because both come out of
 *    the tracks: `px-26 + gap-4` was consuming 116px and every `minmax` track
 *    was silently shrinking below its maximum — which is what put the live
 *    headers at 376/751/1126/1282/1524 instead of 378/820/1212/1352/1578.
 */
const HEAD_COLUMNS = '442px 392px 140px 200px 1fr';
/** Rows start at the thumb's 20 rather than the label's 26 — 6 wider, same x's. */
const ROW_COLUMNS = '448px 392px 140px 200px 1fr';
