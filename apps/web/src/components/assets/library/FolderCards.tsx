'use client';

import { longDate } from '../AssetsLibraryScreen';
import type { Folder } from './types';

/**
 * The folder card, the dashed create card, and the empty state — the
 * `My Folders` and `Assets Empty State` halves of
 * `SparkSocial Assets Library.dc.html`.
 *
 *   card       248x266 r18 white under `0 16px 40px -32px rgba(12,12,12,.35)`,
 *              on a 270 pitch (so a 22px gap)
 *   thumb      12,12 · 224x132 r12 on `#F3F4F6`, hover `#EDF6F8`, holding the
 *              96x76 folder glyph: a 42x18 tab, a 96x68 back plate on
 *              `180deg #A9ECF8 → #7ADCEF`, and a 96x56 front plate on
 *              `180deg #CDF4FC → #94E5F3` with an inner white highlight
 *   checkbox   22,22 · 24x24 r7, `#0C0C0C` when ticked and white in a
 *              `rgba(12,12,12,.25)` ring when not, over `background .15s`
 *   menu       right 16 / top 18 · 30x30 r8, hover `rgba(131,131,131,.1)`
 *   name       centred at 158, 16.5px/700
 *   counts     centred at 190, 14px/500 `#5B5B5B` either side of a 4px dot
 *   created    centred at 220, 14px/400 `#838383`
 */

/**
 * One row of the ⋯ menu.
 *
 * The prototype's ⋯ only toasts — there is no menu drawn anywhere in
 * `SparkSocial Assets Library.dc.html` — so this is built to the app's own
 * popover shape (the sort menu on the same screen) rather than approximated
 * from a design that does not exist.
 */
function MenuItem({
  onClick,
  label,
  danger = false,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex h-[40px] w-full items-center gap-[11px] px-[14px] text-15 font-medium transition-colors hover:bg-[rgba(131,131,131,0.08)]"
      style={{ color: danger ? '#F35525' : '#0C0C0C' }}
    >
      <svg width="16" height="17" viewBox="0 0 17 17" fill="none" aria-hidden className="shrink-0">
        {children}
      </svg>
      {label}
    </button>
  );
}

export function FolderCard({
  folder,
  checked,
  onCheck,
  onOpen,
  menuOpen,
  onMenu,
  onRename,
  onShare,
  onMembers,
  onDelete,
}: {
  folder: Folder;
  checked: boolean;
  onCheck: () => void;
  onOpen: () => void;
  menuOpen: boolean;
  onMenu: () => void;
  onRename: () => void;
  onShare: () => void;
  onMembers: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="relative h-lib-folder-h w-lib-folder shrink-0 rounded-[18px] bg-white"
      style={{ boxShadow: '0 16px 40px -32px rgba(12,12,12,0.35)' }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${folder.name}`}
        className="absolute left-[12px] top-[12px] flex h-lib-folder-thumb w-[224px] items-center justify-center rounded-xl bg-lib-thumb transition-colors hover:bg-[#EDF6F8]"
      >
        <span aria-hidden className="relative block h-[76px] w-[96px]">
          <span className="absolute left-0 top-0 block h-[18px] w-[42px] rounded-t-[6px]" style={{ background: '#8FE3F2' }} />
          <span className="absolute left-0 top-[8px] block h-[68px] w-[96px] rounded-lg bg-lib-folder-back" />
          <span
            className="absolute left-0 top-[20px] block h-[56px] w-[96px] rounded-lg bg-lib-folder-front"
            style={{ boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.8)' }}
          />
        </span>
      </button>

      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`Select ${folder.name}`}
        onClick={onCheck}
        className="absolute left-[22px] top-[22px] flex h-[24px] w-[24px] items-center justify-center rounded-[7px] transition-colors duration-150 motion-reduce:transition-none"
        style={{
          background: checked ? '#0C0C0C' : '#FFFFFF',
          boxShadow: checked ? 'none' : 'inset 0 0 0 1.3px rgba(12,12,12,0.25)',
        }}
      >
        {checked ? (
          <svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden>
            <path d="m1 4.5 3 3L10 1" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </button>

      <button
        type="button"
        onClick={onMenu}
        aria-label={`Options for ${folder.name}`}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="absolute right-[16px] top-[18px] flex h-[30px] w-[30px] items-center justify-center rounded-lg transition-colors hover:bg-[rgba(131,131,131,0.1)]"
        style={menuOpen ? { background: 'rgba(131,131,131,0.12)' } : undefined}
      >
        <svg width="5" height="19" viewBox="0 0 5 20" fill="#0C0C0C" aria-hidden>
          <circle cx="2.5" cy="2.5" r="2.2" />
          <circle cx="2.5" cy="10" r="2.2" />
          <circle cx="2.5" cy="17.5" r="2.2" />
        </svg>
      </button>

      {menuOpen ? (
        <div
          role="menu"
          aria-label={`${folder.name} options`}
          className="absolute right-[14px] top-[52px] z-30 w-[186px] overflow-hidden rounded-[12px] bg-white py-[6px] animate-menu-in motion-reduce:animate-none"
          style={{ boxShadow: '0 18px 44px -20px rgba(12,12,12,0.35), inset 0 0 0 1px rgba(131,131,131,0.14)' }}
        >
          <MenuItem onClick={onRename} label="Rename">
            <path d="M2 12.4V15h2.6l7.7-7.7-2.6-2.6L2 12.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="m11.6 3.1 1.3-1.3a1.1 1.1 0 0 1 1.6 0l1 1a1.1 1.1 0 0 1 0 1.6l-1.3 1.3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </MenuItem>
          <MenuItem onClick={onMembers} label="Members">
            <circle cx="6.4" cy="5.6" r="2.6" stroke="currentColor" strokeWidth="1.4" />
            <path d="M1.8 14.4c0-2.4 2-4 4.6-4s4.6 1.6 4.6 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M12 3.4a2.4 2.4 0 0 1 0 4.6M13.4 14.4c0-1.7-.6-2.9-1.6-3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </MenuItem>
          <MenuItem onClick={onShare} label="Share">
            <circle cx="13" cy="3.4" r="2.2" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="3.6" cy="8.5" r="2.2" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="13" cy="13.6" r="2.2" stroke="currentColor" strokeWidth="1.4" />
            <path d="m5.6 7.4 5.4-2.9M5.6 9.6l5.4 2.9" stroke="currentColor" strokeWidth="1.4" />
          </MenuItem>
          <div className="my-[5px] h-px" style={{ background: 'rgba(131,131,131,0.16)' }} />
          <MenuItem onClick={onDelete} label="Delete" danger>
            <path d="M2 4.3h13M6 4V2.9c0-.6.5-1.1 1.1-1.1h2.8c.6 0 1.1.5 1.1 1.1V4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="m3.5 4.3.8 9.8c.05.8.7 1.4 1.5 1.4h5.4c.8 0 1.45-.6 1.5-1.4l.8-9.8" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </MenuItem>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        className="absolute left-0 top-[158px] w-full truncate px-3 text-center text-[16.5px] font-bold text-ink"
        title={folder.name}
      >
        {folder.name}
      </button>

      <div className="absolute left-0 top-[190px] flex w-full items-center justify-center gap-[11px]">
        <span className="text-14 font-medium" style={{ color: '#5B5B5B' }}>
          {folder.assetCount} {folder.assetCount === 1 ? 'File' : 'Files'}
        </span>
      </div>

      <p className="absolute left-0 top-[220px] w-full text-center text-14 font-normal text-ink-muted">
        Created: {longDate(folder.createdAt)}
      </p>
    </div>
  );
}

/**
 * The last cell: the same 248x266 box at 55% white, with a 1.8px dashed inner
 * frame inset 10 at radius 14 and a floating white pill at its centre.
 */
/**
 * The unfiled shelf, shown only when something is on it.
 *
 * A folder delete unfiles its assets rather than destroying them
 * (`asset.folder.delete`), and the WhatsApp capture loop ingests without a
 * folder at all. Both used to land somewhere the Library could not render, so
 * the honest claim "your files are not deleted" had nowhere to point.
 */
export function UnfiledCard({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative h-lib-folder-h w-lib-folder shrink-0 rounded-[18px] bg-white text-left transition-shadow hover:shadow-[0_18px_46px_-28px_rgba(12,12,12,0.5)]"
      style={{ boxShadow: '0 16px 40px -32px rgba(12,12,12,0.35)', outline: '1.4px dashed rgba(131,131,131,0.4)', outlineOffset: '-6px' }}
    >
      <span className="absolute left-[12px] top-[12px] flex h-lib-folder-thumb w-[224px] items-center justify-center rounded-xl" style={{ background: '#F6F6F7' }}>
        <span aria-hidden className="relative block h-[76px] w-[96px] opacity-70">
          <span className="absolute left-0 top-0 block h-[18px] w-[42px] rounded-t-[6px]" style={{ background: '#D9DDE0' }} />
          <span className="absolute left-0 top-[8px] block h-[68px] w-[96px] rounded-lg" style={{ background: '#E4E7EA' }} />
          <span className="absolute left-0 top-[20px] block h-[56px] w-[96px] rounded-lg" style={{ background: '#EFF1F3' }} />
        </span>
      </span>
      <span className="absolute left-0 top-[158px] block w-full truncate px-3 text-center text-[16.5px] font-bold text-ink">Unfiled</span>
      <span className="absolute left-0 top-[190px] block w-full text-center text-[14.5px] font-medium" style={{ color: '#5B5B5B' }}>
        {count} {count === 1 ? 'File' : 'Files'}
      </span>
      <span className="absolute left-0 top-[220px] block w-full text-center text-[13.5px]" style={{ color: '#838383' }}>
        In no folder
      </span>
    </button>
  );
}

export function CreateFolderCard({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="h-lib-folder-h w-lib-folder shrink-0 rounded-[18px]"
      style={{ background: 'rgba(255,255,255,0.55)' }}
    >
      <div
        className="m-[10px] flex h-[calc(100%-20px)] items-center justify-center rounded-[14px]"
        style={{ border: '1.8px dashed rgba(131,131,131,0.45)' }}
      >
        <button
          type="button"
          onClick={onCreate}
          className="flex h-[44px] items-center gap-[8px] rounded-[10px] bg-white px-[14px] transition-shadow"
          style={{ boxShadow: '0 10px 26px -16px rgba(12,12,12,0.4)' }}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M7 1v12M1 7h12" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="whitespace-nowrap text-14 font-semibold text-ink">Create A New Folder</span>
        </button>
      </div>
    </div>
  );
}

/**
 * `Assets Empty State` — a blurred ghost of the library behind a white card
 * whose notch points up at a 170px disc with two eyes.
 *
 * The ghost is at 750,190 (530x560 r20, `rgba(131,131,131,.06)`, `blur(2px)`),
 * the disc at 930,330 (170px, `rgba(255,255,255,.75)`, `blur(1px)`) with 12x5
 * pills at 975 and 1043,392, and the card at 765,520 — 500x210 r20 under
 * `0 30px 70px -40px rgba(12,12,12,.3)`, its 22x22 notch rotated 45° at the top
 * centre. Laid out relative here rather than at those absolute x's, because the
 * group is centred in the card and the card is fluid.
 */
export function FoldersEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="relative flex justify-center px-lib-inset pt-[40px]">
      <div className="relative h-[560px] w-full max-w-[530px]">
        <div
          aria-hidden
          className="absolute inset-0 rounded-[20px]"
          style={{ background: 'rgba(131,131,131,0.06)', filter: 'blur(2px)' }}
        />

        <div
          aria-hidden
          className="absolute left-1/2 top-[140px] h-[170px] w-[170px] -translate-x-1/2 rounded-full"
          style={{ background: 'rgba(255,255,255,0.75)', filter: 'blur(1px)' }}
        />
        <span
          aria-hidden
          className="absolute left-[225px] top-[202px] block h-[5px] w-[12px] rounded-[3px] bg-white"
          style={{ boxShadow: '0 0 0 1px rgba(131,131,131,0.2)' }}
        />
        <span
          aria-hidden
          className="absolute left-[293px] top-[202px] block h-[5px] w-[12px] rounded-[3px] bg-white"
          style={{ boxShadow: '0 0 0 1px rgba(131,131,131,0.2)' }}
        />

        <div
          className="absolute left-1/2 top-[330px] h-[210px] w-[500px] max-w-full -translate-x-1/2 rounded-[20px] bg-white"
          style={{ boxShadow: '0 30px 70px -40px rgba(12,12,12,0.3)' }}
        >
          <span
            aria-hidden
            className="absolute left-1/2 top-[-11px] block h-[22px] w-[22px] -translate-x-1/2 rotate-45 rounded-[4px] bg-white"
          />
          <p className="absolute left-0 top-[40px] w-full text-center text-[24px] font-bold leading-[1.35] text-ink">
            Opps!, You don&rsquo;t have
            <br />
            any folder currently.
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="absolute left-1/2 top-[132px] flex h-[48px] -translate-x-1/2 items-center gap-[9px] rounded-[10px] bg-white px-[20px] transition-shadow hover:shadow-[inset_0_0_0_1.5px_#838383]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.4)' }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 1v12M1 7h12" stroke="#5B5B5B" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="whitespace-nowrap text-16 font-semibold" style={{ color: '#5B5B5B' }}>
              Create A New Folder
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
