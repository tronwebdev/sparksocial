'use client';

import { ModalShell } from '@/components/common/ModalShell';
import { formatBytes } from '../AssetsLibraryScreen';
import { assetKind, assetName, type Asset } from './types';

/**
 * `View Asset Modal` — `SparkSocial Assets Library.dc.html`.
 *
 *   panel    474,170 · 780x700 at radius 24, plain white
 *   name     40,34 · 22px/700
 *   size     40,70 · h30 r8 on `rgba(131,131,131,.1)`, 13.5px/600 `#5B5B5B`
 *   close    right 26 / top 28 · 34x34, `#9B9B9B`
 *   media    40,118 · 700x436 r16 on `#F1F1F3`, `contain` — a video gets a
 *            64px white disc with a 20x22 play triangle
 *   footer   centred at 588, gap 22 — Cancel and Continue, both h54 r12
 *
 * ── What Continue does ───────────────────────────────────────────────────
 *
 * The prototype toasts "Asset ready to use in the Draft Panel". There is no
 * tool that hands an asset to a draft: the Draft Panel *retrieves* what it
 * needs by role and intent (`asset.retrieve`), which is the Asset Graph's whole
 * design — assets are found by meaning, not handed over by id. So the button
 * says what is true of this asset instead of claiming a handoff, and a video
 * plays in place rather than being a still with a badge on it.
 */

export function ViewAssetModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const kind = assetKind(asset.mediaType);

  return (
    <ModalShell top={170} height={700} width={780} radius={24} background="#FFFFFF" label="View asset" onClose={onClose}>
      <div className="px-[40px] pt-[34px]">
        <p className="pr-[40px] text-[22px] font-bold text-ink">{assetName(asset)}</p>
        <span
          className="mt-[14px] flex h-[30px] w-fit items-center rounded-lg px-[11px] text-[13.5px] font-semibold"
          style={{ background: 'rgba(131,131,131,0.1)', color: '#5B5B5B' }}
        >
          {asset.sizeBytes === null ? 'size not recorded' : formatBytes(asset.sizeBytes)}
        </span>
      </div>

      <div className="px-[40px] pt-[18px]">
        <div className="relative h-[436px] w-full overflow-hidden rounded-2xl" style={{ background: '#F1F1F3' }}>
          {kind === 'Video' ? (
            /* Playable, rather than a still under a badge — the design draws
               the badge because its fixture is an image standing in for one. */
            <video src={asset.url} controls className="h-full w-full object-contain" />
          ) : kind === 'Audio' ? (
            <div className="flex h-full w-full items-center justify-center px-10">
              <audio src={asset.url} controls className="w-full" />
            </div>
          ) : kind === 'Image' ? (
            <img src={asset.url} alt={assetName(asset)} referrerPolicy="no-referrer" className="h-full w-full object-contain" />
          ) : kind === 'PDF' ? (
            /*
              The browser's own PDF viewer.
              
              No `sandbox`, deliberately, after trying both: Chrome will not run
              its PDF viewer inside a sandboxed frame — at `sandbox=""` and at
              `sandbox="allow-scripts"` alike the frame renders blank, verified
              with a real PDF. What makes that acceptable is that the isolation
              does not come from the attribute here: assets are served from
              storage, which is a different origin from this app in every
              environment — the API host in dev, Blob Storage behind Front Door
              in production (CLAUDE.md § Infrastructure). A cross-origin frame
              already cannot read this app's DOM, cookies or storage, so a PDF
              carrying script gains nothing from being displayed.
              
              This stops being true the day assets are served from the app's own
              origin. If that ever changes, this frame has to go back to
              `sandbox` and lose inline rendering, or move behind a renderer
              that rasterises the file.
            */
            <iframe
              src={asset.url}
              title={assetName(asset)}
              referrerPolicy="no-referrer"
              className="h-full w-full"
            />
          ) : (
            <p className="flex h-full w-full items-center justify-center text-16 text-ink-muted">
              {asset.mediaType} — no inline preview for this type.
            </p>
          )}
        </div>

        {asset.caption ? (
          <p className="mt-[16px] line-clamp-2 text-15 text-ink-muted">{asset.caption}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-[22px] pt-[26px]">
        <button
          type="button"
          onClick={onClose}
          className="flex h-[54px] items-center rounded-xl bg-white px-[34px] text-17 font-medium"
          style={{ boxShadow: '0 10px 26px -16px rgba(12,12,12,0.4), inset 0 0 0 1px rgba(131,131,131,0.15)', color: '#5B5B5B' }}
        >
          Cancel
        </button>
        <a
          href={asset.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex h-[54px] items-center gap-[18px] rounded-xl bg-white px-[26px] active:scale-[0.985]"
          style={{ boxShadow: '0 10px 26px -16px rgba(12,12,12,0.4), inset 0 0 0 1px rgba(131,131,131,0.15)' }}
        >
          <span className="text-17 font-semibold text-ink">Open original</span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M6 2h8v8M14 2 4.5 11.5M11 14H2V5" stroke="#0C0C0C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>

      <p className="px-[40px] pt-[16px] text-center text-[13.5px] text-ink-muted">
        SPARK finds this by meaning when it drafts — there is no “send to the Draft Panel”, because the panel
        retrieves what it needs by role and intent.
      </p>
    </ModalShell>
  );
}
