'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * `ONB-04` — *"Connect Social Accounts (connected profiles list + OAuth popup)"*.
 *
 * `integration.connect` has worked for a while and lived only in settings.
 * Connecting later is supported and is not the same as the flow §8.2 describes,
 * which puts this *before* the first campaign — and the difference is not
 * cosmetic: a campaign created with nothing connected plans a month, drafts it,
 * and holds every post, so the product looks like it is working and nothing goes
 * out. Asking here is what stops that.
 *
 * ── Why a popup, and not a redirect ──────────────────────────────────────
 *
 * `integration.connect` returns an authorize URL, and the platform's callback
 * lands on `/settings?social=…` — a hardcoded path in `social-oauth.ts`. Sending
 * the browser there mid-onboarding would drop the person out of the flow and
 * lose their unsaved answers.
 *
 * So the authorize URL opens in a second window and this tab stays put, which is
 * what §ONB-04's own words ask for. The alternative was threading a return path
 * through the signed OAuth state and honouring it in the callback — more moving
 * parts, and it adds an open-redirect surface to a security-sensitive handler for
 * no gain the popup does not already give.
 *
 * Confirmation comes from re-reading `integration.health`, not from the popup.
 * A window that was closed tells us nothing about whether the user pressed
 * Allow, and a `?social=connected` param would be reporting what the *callback*
 * thought rather than what the database says.
 *
 * ── Skippable, on purpose ─────────────────────────────────────────────────
 *
 * A platform with no configured developer app refuses by name — most of them, in
 * most environments. A step that could not be skipped would make onboarding
 * impossible to finish for exactly the reason CLAUDE.md's scope note gives:
 * platform approvals are a multi-week clock, not a code path.
 */

type ConnectionStatus = 'not_connected' | 'ok' | 'expiring' | 'expired';

interface PlatformStatus {
  platform: string;
  connected: boolean;
  status: ConnectionStatus;
  accountLabel?: string;
  supported: boolean;
}

/** The five with a native OAuth flow. Others publish through the aggregator and have nothing to connect here. */
const NATIVE = ['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts'] as const;

const LABEL: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube_shorts: 'YouTube Shorts',
};

export function ConnectAccountsStep({
  genomeId,
  onConnectedCountChange,
}: {
  genomeId: string;
  /** Lifted so the step's footer can say "Continue" versus "Skip for now" without duplicating the read. */
  onConnectedCountChange?: (n: number) => void;
}) {
  const [platforms, setPlatforms] = useState<PlatformStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    const res = await invoke<{ platforms: PlatformStatus[] }>('integration.health', {});
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    const native = res.output.platforms.filter((p) => (NATIVE as readonly string[]).includes(p.platform));
    setPlatforms(native);
    setError(null);
    onConnectedCountChange?.(native.filter((p) => p.connected).length);
  }, [onConnectedCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(platform: string) {
    setBusy(platform);
    setError(null);
    const res = await invoke<{ authorizeUrl: string }>('integration.connect', { genomeId, provider: platform });
    setBusy(null);
    if (res.status !== 'succeeded') {
      // The common case here is "not configured for native publishing yet",
      // which the tool refuses by name. Shown verbatim — it is a better
      // explanation than anything this component could paraphrase.
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    const win = window.open(res.output.authorizeUrl, 'spark-oauth', 'width=600,height=760');
    if (!win) {
      setError('Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.');
    }
  }

  async function recheck() {
    setChecking(true);
    await load();
    setChecking(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-[16px] text-ink-muted">
        SPARK can plan and write without these. It cannot post without them — so a campaign started now would
        fill up and then hold everything. You can also do this later in Settings.
      </p>

      {error ? <p className="text-[14px] text-[var(--ss-danger)]">{error}</p> : null}

      {platforms === null && !error ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(platforms ?? []).map((p) => (
            <li
              key={p.platform}
              className="flex items-center justify-between gap-3 rounded-xl border border-border p-4"
            >
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink">{LABEL[p.platform] ?? p.platform}</p>
                <p className="text-[13px] text-ink-muted">
                  {p.connected ? (p.accountLabel ?? 'Connected') : 'Not connected'}
                </p>
              </div>
              {p.connected ? (
                <Badge variant={p.status === 'ok' ? 'success' : 'warn'}>
                  {p.status === 'ok' ? 'connected' : p.status}
                </Badge>
              ) : (
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void connect(p.platform)}>
                  {busy === p.platform ? 'Opening…' : 'Connect'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button size="sm" variant="ghost" disabled={checking} onClick={() => void recheck()}>
          {checking ? 'Checking…' : 'I finished in the other window — check again'}
        </Button>
      </div>
    </div>
  );
}
