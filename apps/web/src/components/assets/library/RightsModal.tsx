'use client';

import { useState } from 'react';
import { ModalShell } from '@/components/common/ModalShell';
import { invoke } from '@/lib/tools';
import { Thumb } from './AssetViews';
import { assetKind, assetName, assetStamp, type Asset } from './types';

/**
 * `Rights clearance` — the list behind "N awaiting rights clearance".
 *
 * ── Why an asset needs clearing at all ─────────────────────────────────────
 *
 * `rightsStatus` is the answer to "are we allowed to publish this?", and it is
 * the *upload* that has to answer it, because nothing downstream can. A photo
 * shot by a hired photographer, a track under a reel, a customer's face, a
 * stock image on a licence that does not cover paid social — all of them look
 * identical to the Asset Graph. So an upload is `'pending'` unless the person
 * uploading says otherwise, and `retrieveAssets` (`packages/db/src/scoped.ts`)
 * only ever returns `'cleared'` rows. That single filter is what stops
 * `assemble.plan` from quietly building a post around a file the business does
 * not have the right to publish — a takedown, or worse, that nobody chose.
 *
 * The cost of that filter is what this modal exists to pay: a pending asset was
 * invisible in the product while still counting toward its folder, with no way
 * back in. `asset.rights.pending` lists them; `asset.rights.set` clears them.
 *
 * Clearing is `human_only` by the tool's own autonomy — SPARK deciding it has
 * the rights to its own uploads would be exactly backwards — so every row here
 * is a person's call, made one at a time.
 *
 * There is no `.dc.html` for this panel: the prototype has no rights concept at
 * all (its fixtures are all cleared). It is built to the Create Folder modal's
 * frame — 710 wide, radius 28, the same gradient and the same footer — so it
 * reads as part of the same screen.
 */

const STATUS_COPY: Record<string, { label: string; detail: string; colour: string }> = {
  pending: {
    label: 'Pending',
    detail: 'Uploaded without confirming rights. Not available to SPARK until cleared.',
    colour: '#B4762A',
  },
  restricted: {
    label: 'Restricted',
    detail: 'Deliberately pulled out of rotation. Clearing it puts it back in.',
    colour: '#C23E14',
  },
};

export function RightsModal({
  genomeId,
  assets,
  onClose,
  onChanged,
}: {
  genomeId: string;
  assets: Asset[];
  onClose: () => void;
  /** Reload both the folder and the pending list — one asset moved between them. */
  onChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function clear(a: Asset) {
    if (busy) return;
    setBusy(a.assetId);
    setError(null);
    /* `idempotent: true` — setting the same status twice is the same state, so
       no key is needed (unlike ingest, where a second call is a second asset). */
    const res = await invoke('asset.rights.set', {
      genomeId,
      assetId: a.assetId,
      rightsStatus: 'cleared',
    });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    onChanged(`${assetName(a)} cleared`);
  }

  return (
    <ModalShell
      top={190}
      height={620}
      width={710}
      radius={28}
      background="var(--ss-grad-lib-create)"
      label="Rights clearance"
      onClose={onClose}
    >
      <p className="pt-[46px] text-center text-[26px] font-bold text-ink">Rights clearance</p>
      <p className="mx-auto mt-[10px] max-w-[520px] text-center text-15 font-normal leading-[1.5] text-ink-muted">
        SPARK will not build a post around a file until someone confirms the business is allowed to
        publish it. These are held back until you do.
      </p>

      <div className="mt-[22px] max-h-[356px] overflow-y-auto px-[40px]">
        {assets.length === 0 ? (
          <p className="py-[40px] text-center text-16 text-ink-muted">Nothing is waiting on rights.</p>
        ) : (
          <ul className="flex flex-col gap-[10px]">
            {assets.map((a) => {
              const status = STATUS_COPY[a.rightsStatus] ?? {
                label: a.rightsStatus,
                detail: 'Not available to SPARK.',
                colour: '#5B5B5B',
              };
              return (
                <li
                  key={a.assetId}
                  className="flex items-center gap-[14px] rounded-[14px] bg-white px-[18px] py-[14px]"
                  style={{ boxShadow: '0 10px 30px -22px rgba(12,12,12,0.35), inset 0 0 0 1px rgba(131,131,131,0.12)' }}
                >
                  {/* The same thumbnail the grid draws — a filename is a poor
                      way to decide whether you have the rights to something you
                      can look at instead. */}
                  <span className="relative block h-[54px] w-[72px] shrink-0 overflow-hidden rounded-[10px] bg-lib-list-thumb">
                    <Thumb asset={a} rounded="rounded-[10px]" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-16 font-semibold text-ink" title={assetName(a)}>
                      {assetName(a)}
                    </p>
                    <p className="mt-[3px] text-14 font-medium" style={{ color: status.colour }}>
                      {status.label} · {assetKind(a.mediaType)} · {assetStamp(a.createdAt)}
                    </p>
                    <p className="mt-[2px] text-13 text-ink-muted">{status.detail}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void clear(a)}
                    disabled={busy !== null}
                    className="h-[40px] shrink-0 rounded-[10px] px-[16px] text-15 font-semibold text-ink transition-colors hover:bg-white disabled:opacity-50"
                    style={{ background: 'var(--ss-lib-toggle)' }}
                  >
                    {busy === a.assetId ? 'Clearing…' : 'I have the rights'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error ? <p className="mt-[14px] text-15 text-destructive">{error}</p> : null}
      </div>

      <div className="mt-[24px] flex items-center justify-center">
        <button
          type="button"
          onClick={onClose}
          className="flex h-[52px] items-center gap-[11px] rounded-[11px] px-[22px] transition-colors hover:bg-white"
          style={{ background: 'rgba(255,255,255,0.6)', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}
        >
          <span className="text-17 font-medium" style={{ color: '#838383' }}>
            Done
          </span>
        </button>
      </div>
    </ModalShell>
  );
}
