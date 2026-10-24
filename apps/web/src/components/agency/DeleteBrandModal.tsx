'use client';

import { useEffect, useState } from 'react';
import { ModalShell } from '@/components/common/ModalShell';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';

/**
 * DELETE A BRAND — the only irreversible button in the product.
 *
 * ── No design source, and saying so ──────────────────────────────────────
 *
 * There is no `.dc.html` for this. The prototype has `Settings WS Add Client`
 * and no counterpart for removing one, so this panel is built to the Assets
 * Library's own confirmation frame — the same `ModalShell`, radius 28, and the
 * Cancel/danger footer pair that `FolderActionModals.tsx` already measured off
 * `SparkSocial Assets Library.dc.html`. Borrowed rather than invented, but not
 * diffed against a design, because there is nothing to diff it against.
 *
 * ── Three steps, and why it is not one ───────────────────────────────────
 *
 *   1. `brand.deletion.preview` runs on open, so the panel can say what will
 *      be destroyed before anyone commits to it. "Delete this brand" and
 *      "delete 148 assets and 32 posts" are the same action and a different
 *      decision; this screen's whole job is to make the second one the one
 *      being taken.
 *   2. The name must be typed. Not a checkbox: a checkbox confirms that a
 *      dialog appeared, and a typed name confirms *which brand*. Picking the
 *      wrong client out of a roster of forty is the failure that actually
 *      happens here, and only the name catches it.
 *   3. `brand.delete` is `effect: 'destructive'`, which policy routes to an
 *      approval for everyone including an owner — so the call comes back
 *      `gated`, and this panel releases it with `approval.decide`. That round
 *      trip is not ceremony: it leaves two attributable rows in `tool_calls`,
 *      held and then released, where a one-step delete would leave one. The
 *      person has already given their answer by typing the name, so the panel
 *      does not make them find the review queue to repeat it.
 */

interface Counts {
  assets: number;
  contentItems: number;
  campaigns: number;
  recipes: number;
  genomes: number;
}

interface Preview {
  brandId: string;
  name: string;
  counts: Counts;
}

/** Only the lines with something in them — "0 campaigns" is noise in a warning. */
function lines(counts: Counts): string[] {
  const out: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) out.push(`${n.toLocaleString('en')} ${n === 1 ? one : many}`);
  };
  add(counts.assets, 'asset', 'assets');
  add(counts.contentItems, 'post', 'posts');
  add(counts.campaigns, 'campaign', 'campaigns');
  add(counts.recipes, 'automation', 'automations');
  return out;
}

export function DeleteBrandModal({
  brandId,
  onClose,
  onDeleted,
}: {
  brandId: string;
  onClose: () => void;
  onDeleted: (name: string) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await invoke<Preview>('brand.deletion.preview', { brandId });
      if (!live) return;
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? userMessage(res.error) : 'That request was gated.');
        return;
      }
      setPreview(res.output);
    })();
    return () => {
      live = false;
    };
  }, [brandId]);

  /*
   * Mirrors `nameMatches` in `packages/agency/src/brand.ts`. Duplicated
   * deliberately and kept forgiving in the same way: this one only decides
   * whether the button is enabled, and the tool re-checks the name itself, so
   * the two disagreeing produces a refusal rather than a wrong deletion.
   */
  const matches =
    preview !== null && typed.trim().toLocaleLowerCase() === preview.name.trim().toLocaleLowerCase();

  async function remove() {
    if (busy || !preview || !matches) return;
    setBusy(true);
    setError(null);

    const held = await invoke<unknown>('brand.delete', { brandId, confirmName: typed });

    if (held.status === 'failed') {
      setBusy(false);
      setError(userMessage(held.error));
      return;
    }

    /*
     * The expected path. `succeeded` is handled too rather than assumed
     * impossible: if the policy ever stops gating this, the panel should
     * finish the job instead of hanging on an approval that never queued.
     */
    if (held.status === 'gated') {
      const released = await invoke<unknown>(
        'approval.decide',
        { callId: held.callId, decision: 'approve' },
        `brand-delete:${brandId}`,
      );
      setBusy(false);
      if (released.status !== 'succeeded') {
        setError(
          released.status === 'failed'
            ? userMessage(released.error)
            : 'The deletion is waiting for approval in the Command Center.',
        );
        return;
      }
      onDeleted(preview.name);
      return;
    }

    setBusy(false);
    onDeleted(preview.name);
  }

  const destroyed = preview ? lines(preview.counts) : [];

  return (
    <ModalShell
      top={250}
      height={destroyed.length >= 3 ? 470 : 440}
      width={620}
      radius={28}
      background="var(--ss-grad-lib-create)"
      label="Delete brand"
      onClose={onClose}
    >
      <p className="pt-[46px] text-center text-26 font-bold text-ink">
        {preview ? `Delete “${preview.name}”?` : 'Delete brand'}
      </p>

      <div className="px-[64px] pt-[18px]">
        {preview === null ? (
          <p className="text-center text-16 text-ink-muted">
            {error ?? 'Counting what this would remove…'}
          </p>
        ) : (
          <>
            <p className="text-center text-16 leading-[1.55] text-ink">
              {destroyed.length === 0
                ? 'Nothing has been made for this brand yet.'
                : `This permanently deletes ${destroyed.join(', ')}, together with everything SPARK has learned about this brand.`}{' '}
              <span className="text-ink-muted">
                It cannot be undone. The billing history and the audit trail are kept.
              </span>
            </p>

            <label className="mt-[22px] block text-center text-15 text-ink-muted" htmlFor="confirm-brand-name">
              Type <span className="font-semibold text-ink">{preview.name}</span> to confirm
            </label>
            <input
              id="confirm-brand-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-[10px] h-[52px] w-full rounded-[11px] bg-white px-[18px] text-17 text-ink outline-none"
              style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}
            />

            {error ? <p className="mt-[12px] text-center text-15 text-destructive">{error}</p> : null}
          </>
        )}
      </div>

      <div className="mt-[26px] flex items-center justify-center gap-[26px]">
        <button
          type="button"
          onClick={onClose}
          className="flex h-[52px] items-center gap-[11px] rounded-[11px] px-[22px] transition-colors hover:bg-white"
          style={{ background: 'rgba(255,255,255,0.6)', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}
        >
          <span className="text-17 font-medium" style={{ color: '#838383' }}>
            Cancel
          </span>
        </button>

        <button
          type="button"
          onClick={remove}
          disabled={busy || !matches}
          className="flex h-[52px] items-center rounded-[11px] px-[20px] text-18 font-semibold text-white transition-opacity hover:opacity-90 active:scale-[0.985] disabled:opacity-40"
          style={{ background: '#F35525' }}
        >
          {busy ? 'Deleting…' : 'Delete brand'}
        </button>
      </div>
    </ModalShell>
  );
}
