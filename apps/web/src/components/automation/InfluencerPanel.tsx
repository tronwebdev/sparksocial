'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';

/**
 * The Influencers half of the query step's toggle — a real tab, not a label.
 *
 * ── Why it manages a watchlist rather than a recipe field ─────────────────
 *
 * `AutoTrendConfig` has `keywords` and `excludeKeywords` and no influencer
 * field, so "influencers on this recipe" is not a thing that could be stored.
 * What *does* exist is `trend.influencer.watch` — a per-brand watchlist of
 * accounts, with `add` / `remove` / `list` — and what those accounts post is
 * one of the things the trend sources surface. So this tab edits that list.
 *
 * Which makes the toggle honest in both directions: Keywords narrows *this
 * recipe*, Influencers changes *what this brand watches*, and the panel says
 * which is which instead of implying the second is stored on the recipe.
 */

/** `InfluencerPlatform` — the five the tool accepts, no more. */
const PLATFORMS = ['x', 'tiktok', 'instagram', 'linkedin', 'youtube_shorts'] as const;

interface Watch {
  platform: string;
  handle: string;
  note?: string;
}

export function InfluencerPanel({ genomeId }: { genomeId: string }) {
  const [list, setList] = useState<Watch[] | null>(null);
  const [platform, setPlatform] = useState<string>('x');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await invoke<{ watchlist: Watch[] }>('trend.influencer.watch', { genomeId, action: 'list' });
    if (res.status !== 'succeeded') {
      setList([]);
      setError(res.status === 'failed' ? res.error.message : 'That read was gated.');
      return;
    }
    setError(null);
    setList(res.output.watchlist ?? []);
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(action: 'add' | 'remove', p: string, h: string) {
    if (busy || !h.trim()) return;
    setBusy(true);
    setError(null);
    /* `effect: 'write'` and idempotent — adding the same handle twice is the
       same watchlist, so no key is minted. */
    const res = await invoke('trend.influencer.watch', {
      genomeId,
      action,
      platform: p,
      handle: h.trim(),
    });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    if (action === 'add') setHandle('');
    void load();
  }

  return (
    <div className="mt-[16px]">
      <div className="flex flex-wrap items-center gap-[12px]">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          aria-label="Platform"
          className="h-[60px] w-[170px] appearance-none rounded-[13px] bg-white px-[18px] text-[16.5px] font-medium text-ink outline-none"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.28)' }}
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p === 'x' ? 'X' : p === 'youtube_shorts' ? 'YouTube Shorts' : p[0]!.toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>

        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void change('add', platform, handle);
            }
          }}
          placeholder="@handle"
          aria-label="Account handle"
          className="h-[60px] min-w-[200px] flex-1 rounded-[13px] bg-white px-[22px] text-[16.5px] font-medium text-ink outline-none placeholder:text-[#B0B0B0]"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.28)' }}
        />

        <button
          type="button"
          onClick={() => void change('add', platform, handle)}
          disabled={busy || !handle.trim()}
          className="h-[60px] shrink-0 rounded-[13px] px-[22px] text-16 font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: 'var(--ss-cyan-200)' }}
        >
          {busy ? 'Saving…' : 'Watch'}
        </button>
      </div>

      {list === null ? (
        <p className="mt-[14px] text-15 text-ink-muted">Loading the watchlist…</p>
      ) : list.length === 0 ? (
        <p className="mt-[14px] text-15" style={{ color: '#838383' }}>
          Nobody is being watched yet. Add an account and what it posts starts feeding the trend sources.
        </p>
      ) : (
        <div className="mt-[14px] flex flex-wrap gap-[11px]">
          {list.map((w) => (
            <span
              key={`${w.platform}:${w.handle}`}
              className="inline-flex h-[44px] items-center gap-[12px] rounded-[10px] px-[15px] text-[15.5px] font-semibold text-ink"
              style={{ background: 'var(--ss-auto-kw-chip)' }}
            >
              @{w.handle}
              <span className="text-[12.5px] font-medium" style={{ color: '#5B5B5B' }}>
                {w.platform === 'x' ? 'X' : w.platform === 'youtube_shorts' ? 'Shorts' : w.platform}
              </span>
              <button
                type="button"
                onClick={() => void change('remove', w.platform, w.handle)}
                aria-label={`Stop watching ${w.handle}`}
                className="text-[15px] leading-none transition-opacity hover:opacity-60"
                style={{ color: '#5B5B5B' }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {error ? <p className="mt-[12px] text-15 text-destructive">{error}</p> : null}

      <p className="mt-[14px] text-15" style={{ color: '#838383' }}>
        The watchlist belongs to this brand, not to this recipe — every AutoTrend recipe sees what these
        accounts post. Keywords, on the other tab, narrow this recipe alone.
      </p>
    </div>
  );
}
