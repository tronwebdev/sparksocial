'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';
import { CampaignList, type CampaignRow } from '@/components/calendar/CampaignList';

/**
 * "Edit Campaign" — every campaign this brand has, and what can be done to it.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Pause, resume, rename, duplicate and activate were all registered tools that
 * no screen reached. `CampaignList` held them, and it was switched off on the
 * calendar (`SHOW_CAMPAIGN_LIST`) because that screen's grids already showed
 * the dates; the Command Center's card had its own buttons removed because the
 * design does not draw them, on the understanding the list still had them.
 * Both were reasonable alone, and together they left a campaign with no way to
 * be paused. The wizard's failure message still told people to "activate it
 * from the calendar".
 *
 * The design does draw an **Edit Campaign** button on the card, which only
 * linked to the calendar. It opens this instead.
 */
export function CampaignManageModal({
  genomeId,
  currentId,
  onClose,
  onChanged,
}: {
  genomeId: string;
  /** The campaign the card is showing, highlighted in the list. */
  currentId?: string;
  onClose: () => void;
  /** After any change, so the card behind can re-read its campaign. */
  onChanged: () => void;
}) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await invoke<{ campaigns: CampaignRow[] }>('campaign.list', { genomeId, limit: 50 });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? userMessage(res.error) : 'Reading campaigns needs approval.');
      setCampaigns([]);
      return;
    }
    setCampaigns(res.output.campaigns);
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto" role="dialog" aria-modal="true" aria-label="Edit campaigns">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 animate-fade-in cursor-default border-0 bg-[rgba(40,40,40,0.45)] motion-reduce:animate-none"
      />
      <div className="relative mx-auto my-[8vh] w-[760px] max-w-[calc(100%-32px)] animate-modal-in motion-reduce:animate-none">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-[14px] top-[14px] z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white transition-colors hover:bg-[#F1F1F1]"
        >
          <svg width="12" height="12" viewBox="0 0 11 11" fill="none" aria-hidden>
            <path d="m1 1 9 9m0-9-9 9" stroke="#838383" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        {error ? <p className="mb-3 rounded-lg bg-white p-4 text-14 text-destructive">{error}</p> : null}

        {campaigns === null ? (
          <div className="rounded-xl bg-white p-6 text-14 text-ink-muted">Reading campaigns…</div>
        ) : campaigns.length === 0 ? (
          <div className="rounded-xl bg-white p-6 text-14 text-ink-muted">
            This brand has no campaigns yet.{' '}
            <button type="button" className="font-medium text-ink underline" onClick={() => router.push('/home?new=1')}>
              Create one
            </button>
          </div>
        ) : (
          <CampaignList
            campaigns={campaigns}
            selectedId={currentId}
            genomeId={genomeId}
            onChanged={() => {
              void load();
              onChanged();
            }}
            onNew={() => router.push('/home?new=1')}
          />
        )}
      </div>
    </div>
  );
}
