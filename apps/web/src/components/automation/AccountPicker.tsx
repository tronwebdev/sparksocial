'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { PlatformIcon } from '@/components/common/PlatformIcon';
import { invoke } from '@/lib/tools';
import { platformLabel } from '@/lib/platforms';
import { writeSelectedGenome } from '@/lib/selectedGenome';

/**
 * "Target account(s)" — connecting *and* choosing, on the wizard step itself.
 *
 * This was a disabled row that told you to go to Settings → Connections. Being
 * sent to another screen mid-wizard to do the one thing the step is named after
 * is the worst version of it, so both halves happen here:
 *
 *   **Connect**  `integration.connect` mints the platform's own authorize URL
 *                and it opens in a new tab, so the wizard keeps its state. The
 *                tool is `human_only` and `owner`/`admin` only — a browser
 *                consent screen is not something SPARK can click — and it
 *                answers `"<platform> isn't configured for native publishing
 *                yet"` for a platform with no client id. That answer is shown
 *                on the row rather than in a toast, because it is a fact about
 *                that platform, not about the click.
 *
 *   **Select**   the connected ones are checkboxes, stored on the recipe as
 *                `config.targetPlatforms`.
 *
 * ── The one thing this cannot promise ─────────────────────────────────────
 *
 * The engine stores `targetPlatforms` and does not yet read it. That is its
 * own documented state — `NOT_APPLIED` in `packages/recipes/src/tool.ts`:
 * *"An output becomes a post via recipe.output.decide and then content.draft,
 * and neither step carries a platform, so the choice does not survive the
 * handover yet."* So the step says exactly that under the picker. A screen that
 * let somebody tick four accounts and implied the posts would go there would be
 * making a promise the handover breaks.
 *
 * ── Coming back from the consent screen ───────────────────────────────────
 *
 * The platform redirects to the API, not here, so nothing tells this component
 * the handshake finished. It re-reads `integration.health` when the window
 * regains focus after a connect was started — which is exactly the moment the
 * person comes back from the other tab.
 */

export interface PlatformRow {
  platform: string;
  connected: boolean;
  status: 'not_connected' | 'ok' | 'expiring' | 'expired';
  accountLabel?: string;
  hoursUntilExpiry: number | null;
  supported: boolean;
}

const STATUS_NOTE: Record<PlatformRow['status'], string | null> = {
  ok: null,
  expiring: 'Token expiring soon — reconnect to keep it posting',
  expired: 'Token expired — reconnect before this can post',
  not_connected: null,
};

export function AccountPicker({
  genomeId,
  selected,
  onSelected,
}: {
  genomeId: string;
  selected: string[];
  onSelected: (next: string[]) => void;
}) {
  const [rows, setRows] = useState<PlatformRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Per-platform message from `integration.connect` — usually "not configured". */
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [awaiting, setAwaiting] = useState(false);
  const { orgId } = useAuth();

  const load = useCallback(async () => {
    const res = await invoke<{ platforms: PlatformRow[] }>('integration.health', {});
    if (res.status !== 'succeeded') {
      /* Not the same as "nothing is connected", and it must not read as it.
         `integration.health` takes no input and resolves the brand from the
         `spark_genome` cookie the proxy forwards; a session that has never
         used the brand switcher has no such cookie, and the API answers "A
         brand must be selected." Saying that — with the fix — beats an empty
         list that blames the person for not having connected anything. */
      setRows([]);
      setLoadError(res.status === 'failed' ? res.error.message : 'That read was gated.');
      return;
    }
    setLoadError(null);
    setRows(res.output.platforms.filter((p) => p.supported));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Back from the consent tab — the redirect lands on the API, so this is the
     only signal this component gets that anything changed. */
  useEffect(() => {
    if (!awaiting) return;
    const onFocus = () => {
      setAwaiting(false);
      void load();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [awaiting, load]);

  async function connect(platform: string) {
    if (busy) return;
    setBusy(platform);
    setNotes((n) => {
      const next = { ...n };
      delete next[platform];
      return next;
    });

    const res = await invoke<{ authorizeUrl: string }>('integration.connect', { genomeId, provider: platform });
    setBusy(null);

    if (res.status !== 'succeeded') {
      setNotes((n) => ({
        ...n,
        [platform]:
          res.status === 'failed'
            ? res.error.message
            : (res.decision?.reason ?? 'Connecting an account needs an owner or admin.'),
      }));
      return;
    }

    /* A new tab, not this one: the wizard is mid-flight and a redirect would
       throw away every step already filled in. */
    setAwaiting(true);
    window.open(res.output.authorizeUrl, '_blank', 'noopener,noreferrer');
  }

  const toggle = (platform: string) =>
    onSelected(selected.includes(platform) ? selected.filter((p) => p !== platform) : [...selected, platform]);

  if (rows === null) return <p className="mt-[10px] text-15 text-ink-muted">Loading your accounts…</p>;

  if (loadError) {
    const brandMissing = /brand must be selected/i.test(loadError);
    return (
      <div className="mt-[10px] rounded-[13px] px-[18px] py-[14px]" style={{ background: 'var(--ss-auto-review-bg)', boxShadow: 'inset 0 0 0 1px var(--ss-auto-review-ring)' }}>
        <p className="text-15 font-medium text-ink">{loadError}</p>
        {brandMissing ? (
          <>
            <p className="mt-[4px] text-[13.5px]" style={{ color: '#5B5B5B' }}>
              Your accounts are held per brand, and this session has not recorded which brand it is
              working on yet.
            </p>
            <button
              type="button"
              onClick={() => {
                if (orgId) writeSelectedGenome(orgId, genomeId);
                setLoadError(null);
                setRows(null);
                void load();
              }}
              className="mt-[12px] h-[40px] rounded-[11px] bg-white px-[16px] text-15 font-semibold text-ink transition-shadow hover:shadow-[inset_0_0_0_1.4px_#838383]"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.4)' }}
            >
              Use the brand I&rsquo;m in
            </button>
          </>
        ) : null}
      </div>
    );
  }

  const connected = rows.filter((r) => r.connected);
  const rest = rows.filter((r) => !r.connected);

  return (
    <div className="mt-[10px]">
      {connected.length === 0 ? (
        <p className="text-15" style={{ color: '#838383' }}>
          No account is connected yet. Connect one below and it becomes selectable here.
        </p>
      ) : (
        <div className="flex flex-wrap gap-[13px]">
          {connected.map((r) => {
            const on = selected.includes(r.platform);
            const note = STATUS_NOTE[r.status];
            return (
              <button
                key={r.platform}
                type="button"
                onClick={() => toggle(r.platform)}
                aria-pressed={on}
                title={note ?? undefined}
                className="flex h-[58px] items-center gap-[11px] rounded-[13px] bg-white pl-[9px] pr-[18px] transition-shadow"
                style={{ boxShadow: on ? 'inset 0 0 0 1.4px #0C0C0C' : 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}
              >
                <span aria-hidden className="flex h-[41px] w-[41px] shrink-0 items-center justify-center rounded-full" style={{ background: '#F1F4F8' }}>
                  <PlatformIcon platform={r.platform} size={22} />
                </span>
                <span className="text-left">
                  <span className="block whitespace-nowrap text-16 font-semibold text-ink">
                    {r.accountLabel ?? platformLabel(r.platform)}
                  </span>
                  {note ? (
                    <span className="block whitespace-nowrap text-[12.5px]" style={{ color: r.status === 'expired' ? 'var(--ss-auto-failed)' : 'var(--ss-amber-500)' }}>
                      {r.status === 'expired' ? 'Expired' : 'Expiring soon'}
                    </span>
                  ) : null}
                </span>
                <span
                  aria-hidden
                  className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full transition-colors"
                  style={{ background: on ? '#0C0C0C' : '#FFFFFF', boxShadow: on ? 'none' : 'inset 0 0 0 1.3px rgba(12,12,12,0.3)' }}
                >
                  {on ? (
                    <svg width="8" height="7" viewBox="0 0 9 8" fill="none">
                      <path d="m1 4 2.2 2.2L8 1" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── connect the rest, here ────────────────────────────────────────── */}
      {rest.length > 0 ? (
        <details className="mt-[14px] group">
          <summary className="flex h-[46px] w-fit cursor-pointer list-none items-center gap-[10px] rounded-[12px] bg-white px-[18px] text-15 font-semibold text-ink transition-shadow hover:shadow-[inset_0_0_0_1.5px_#838383]" style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 1v12M1 7h12" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Connect another account
          </summary>

          <ul className="mt-[12px] flex flex-col gap-[8px]">
            {rest.map((r) => (
              <li
                key={r.platform}
                className="flex flex-wrap items-center gap-[12px] rounded-[13px] bg-white px-[16px] py-[12px]"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.22)' }}
              >
                <span aria-hidden className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full" style={{ background: '#F1F4F8' }}>
                  <PlatformIcon platform={r.platform} size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-16 font-semibold text-ink">{platformLabel(r.platform)}</span>
                  {notes[r.platform] ? (
                    <span className="mt-[2px] block text-[13px]" style={{ color: '#5B5B5B' }}>
                      {notes[r.platform]}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => void connect(r.platform)}
                  disabled={busy !== null}
                  className="h-[40px] shrink-0 rounded-[11px] px-[18px] text-15 font-semibold text-white transition-opacity hover:opacity-92 disabled:opacity-60"
                  style={{ background: 'var(--ss-grad-auto-connect)' }}
                >
                  {busy === r.platform ? 'Opening…' : 'Connect'}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {awaiting ? (
        <p className="mt-[12px] text-[13.5px]" style={{ color: '#5B5B5B' }}>
          Finish on the platform&rsquo;s tab, then come back — this list refreshes itself.
        </p>
      ) : null}

      {/* The engine's own words about what it does with this, so nobody ticks
          four accounts believing the posts route there today. */}
      <p className="mt-[14px] text-15 font-normal" style={{ color: '#838383' }}>
        {selected.length > 0
          ? `Saved on the recipe. The draft handover does not carry a platform yet, so SPARK still decides where each post goes when it drafts it — this is recorded for when it does.`
          : 'Pick the accounts this recipe is for. Posts publish to the accounts connected here.'}
      </p>
    </div>
  );
}
