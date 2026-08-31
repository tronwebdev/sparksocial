'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { invoke } from '@/lib/tools';

/**
 * EVERY CAMPAIGN THIS BRAND HAS, WITH ITS NAME AND ITS STATE.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * `CalendarBoard` read `campaign.list` and used `campaigns[0]`. Nothing was
 * wrong with the tool, the table, or `campaign.create`: a brand could always
 * have as many campaigns as it liked, and the second one silently replaced the
 * first on screen. From the outside that is indistinguishable from a
 * one-campaign product.
 *
 * ── Names, and why they needed a tool ────────────────────────────────────
 *
 * The wizard auto-named campaigns from the month — `"August campaign"` — so two
 * started in the same month were the same string in any list. A picker does not
 * fix that; a name does. The wizard now asks, and `campaign.rename` edits it
 * afterwards, which is the only field of a live campaign that may be edited:
 * everything else is either a term the owner approved or the plan snapshot taken
 * under those terms.
 *
 * ── Activate, next to the thing it changes ────────────────────────────────
 *
 * A campaign is created `draft`. The one control that moves it to `active` lived
 * on the cockpit's focus card and nowhere else, so the Draft badge on the
 * calendar had no control beside it and no explanation. Draft is not inert — the
 * scheduler works off due content items, not campaign status — which makes a
 * label with no control worse than usual: it implies a gate that is not there.
 * The row says what the state means and offers the change.
 */

export interface CampaignRow {
  campaignId: string;
  name: string;
  status: string;
  objective: string;
  windowDays: number;
  startAt: string;
}

/** What each status means for what SPARK will actually do. */
const STATUS_NOTE: Record<string, string> = {
  draft: 'Planned. SPARK still posts anything already scheduled — activating makes it the outcome it plans against.',
  active: 'The outcome SPARK is planning against.',
  paused: 'Not being planned against. Anything already scheduled still goes out.',
  completed: 'Its window has closed.',
};

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-warn/10 text-ink',
  active: 'bg-ok/10 text-ink',
  paused: 'bg-surface-muted text-ink-muted',
  completed: 'bg-surface-muted text-ink-muted',
};

export function CampaignList({
  campaigns,
  selectedId,
  onSelect,
  onChanged,
  onNew,
  busy,
}: {
  campaigns: CampaignRow[];
  selectedId: string | undefined;
  onSelect: (campaignId: string) => void;
  /** Called after a rename or a status change, so the caller can re-read the list. */
  onChanged: () => void;
  onNew: () => void;
  busy?: boolean;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rename(campaignId: string) {
    const name = draftName.trim();
    // Nothing to send, and the tool would refuse a blank anyway — so this closes
    // the editor rather than showing an error for a non-action.
    if (!name) {
      setRenaming(null);
      return;
    }
    setWorking(campaignId);
    setError(null);
    const res = await invoke<{ name: string }>(
      'campaign.rename',
      { campaignId, name },
      // Stable: renaming to the same name twice is one outcome, and a stable key
      // makes a double-submit collapse into the first.
      `campaign.rename:${campaignId}:${name}`,
    );
    setWorking(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That rename needs approval.');
      return;
    }
    setRenaming(null);
    onChanged();
  }

  async function setStatus(campaignId: string, to: 'active' | 'paused') {
    setWorking(campaignId);
    setError(null);
    /**
     * One tool for both transitions into `active`. Draft → active and paused →
     * active are the same write, so `campaign.resume` covers both — see its own
     * summary, which used to say "paused" and so read as forbidding the draft
     * case it had always handled.
     */
    const res = await invoke(
      to === 'active' ? 'campaign.resume' : 'campaign.pause',
      { campaignId },
      `campaign.${to}:${campaignId}`,
    );
    setWorking(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That change needs approval.');
      return;
    }
    onChanged();
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-medium text-ink">Campaigns</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {campaigns.length === 1 ? 'One campaign.' : `${campaigns.length} campaigns.`} Each is an outcome
            over a window &mdash; you can run more than one at a time.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={onNew}>
          New campaign
        </Button>
      </div>

      {/* `campaign.list` caps at 50. Saying so beats a list that silently ends —
          the heading above states a count, and a truncated count is a wrong one. */}
      {campaigns.length >= 50 ? (
        <p className="mt-2 text-[12px] text-ink-muted">
          Showing the 50 most recent. Older campaigns are still there; this screen cannot page through them
          yet.
        </p>
      ) : null}

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

      <ul className="mt-4 grid grid-cols-1 gap-2">
        {campaigns.map((c) => {
          const selected = c.campaignId === selectedId;
          const editing = renaming === c.campaignId;
          const isWorking = working === c.campaignId;

          return (
            <li
              key={c.campaignId}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                selected ? 'border-primary bg-primary/5' : 'border-border',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        autoFocus
                        value={draftName}
                        maxLength={120}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void rename(c.campaignId);
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        className="max-w-[280px]"
                        aria-label={`Rename ${c.name}`}
                      />
                      <Button size="sm" disabled={isWorking} onClick={() => void rename(c.campaignId)}>
                        {isWorking ? 'Saving…' : 'Save'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(c.campaignId)}
                      className="block max-w-full truncate text-left text-[14px] font-medium text-ink hover:underline"
                    >
                      {c.name}
                    </button>
                  )}

                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    for {c.objective} &middot; {c.windowDays} days from{' '}
                    {new Date(c.startAt).toLocaleDateString('en', { day: 'numeric', month: 'short' })}
                  </p>
                  {/* What the status means for behaviour, not just its name. */}
                  <p className="mt-1 text-[12px] text-ink-muted">
                    {STATUS_NOTE[c.status] ?? c.status}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn('capitalize', STATUS_TONE[c.status] ?? 'bg-surface-muted text-ink-muted')}>
                    {c.status}
                  </Badge>

                  {c.status === 'active' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isWorking || busy}
                      onClick={() => void setStatus(c.campaignId, 'paused')}
                    >
                      Pause
                    </Button>
                  ) : c.status === 'completed' ? null : (
                    <Button
                      size="sm"
                      disabled={isWorking || busy}
                      onClick={() => void setStatus(c.campaignId, 'active')}
                    >
                      {/* Two words for one write, because they are two different
                          moments to the person reading them: a draft has never
                          run, a paused campaign has. */}
                      {c.status === 'draft' ? 'Activate' : 'Resume'}
                    </Button>
                  )}

                  {!editing ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isWorking || busy}
                      onClick={() => {
                        setRenaming(c.campaignId);
                        setDraftName(c.name);
                      }}
                    >
                      Rename
                    </Button>
                  ) : null}

                  {!selected && !editing ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSelect(c.campaignId)}>
                      Open
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
