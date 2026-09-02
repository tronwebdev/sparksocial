'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';

/**
 * APPROVAL FLOWS (`SET-WS-TEAM-GROUPS`) — the second half of the Team Roles
 * screen.
 *
 * ── Why this is not a fifth checkbox on a team group ──────────────────────
 *
 * `TeamGroupsPanel` sits directly above and its whole copy problem is that
 * groups **only widen** — every unticked box means "nothing added", not
 * "denied". These rules do the opposite: they take something away.
 *
 * Putting them in the same list would have been one more checkbox and would have
 * made that sentence false. So they are a separate section with the opposite
 * framing said out loud, because the two are adjacent on one screen and a reader
 * who conflates them will misconfigure both.
 *
 * ── What a rule can actually do ───────────────────────────────────────────
 *
 * Only send something to the review queue. `policy.ts` evaluates these after
 * every refusal, so a misconfigured flow cannot grant anything — the worst it
 * does is ask a person. That is worth stating on the screen: an admin adding a
 * rule wants to know the blast radius before they save it.
 */

interface Rule {
  id: string;
  trigger: 'publish' | 'spend_over';
  thresholdCents?: number;
  requiresRole: 'owner' | 'admin' | 'editor' | 'approver';
  groupIds: string[];
  groupNames: string[];
  enabled: boolean;
  label: string;
  appliesTo: string;
}

interface Group {
  id: string;
  name: string;
}

const REVIEWER_ROLES = [
  { value: 'approver', label: 'An approver' },
  { value: 'admin', label: 'An admin' },
  { value: 'owner', label: 'The owner' },
  { value: 'editor', label: 'Any editor' },
] as const;

export function ApprovalFlowsPanel() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ruleRes, groupRes] = await Promise.all([
      invoke<{ rules: Rule[] }>('approval.rule.list', {}),
      invoke<{ groups: Group[] }>('team.group.list', {}),
    ]);

    if (ruleRes.status !== 'succeeded') {
      setError(
        ruleRes.status === 'failed' ? ruleRes.error.message : 'Approval flows are not visible to your role.',
      );
      return;
    }
    setRules(ruleRes.output.rules);
    setError(null);
    // A missing group list is not fatal — the rules still render, they just show
    // ids rather than names in the picker. Failing the whole panel over it would
    // hide the rules that are in force.
    if (groupRes.status === 'succeeded') setGroups(groupRes.output.groups);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (rule: Rule) => {
    setBusyId(rule.id);
    const res = await invoke<unknown>(
      'approval.rule.set',
      {
        id: rule.id,
        trigger: rule.trigger,
        ...(rule.thresholdCents === undefined ? {} : { thresholdCents: rule.thresholdCents }),
        requiresRole: rule.requiresRole,
        groupIds: rule.groupIds,
        enabled: !rule.enabled,
      },
      // A fresh key per press. A stable one would make the second press replay
      // the first result, so switching a rule off and on again would leave it
      // off — the bug `CampaignList` shipped with.
      crypto.randomUUID(),
    );
    setBusyId(null);
    if (res.status === 'succeeded') await load();
    else setError(res.status === 'failed' ? res.error.message : 'Only owners and admins can change approval flows.');
  };

  const remove = async (rule: Rule) => {
    setBusyId(rule.id);
    const res = await invoke<unknown>('approval.rule.delete', { id: rule.id }, crypto.randomUUID());
    setBusyId(null);
    if (res.status === 'succeeded') await load();
    else setError(res.status === 'failed' ? res.error.message : 'Only owners and admins can change approval flows.');
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">Approval flows</h2>
          {/* The opposite framing to the panel above, said out loud, because the
              two sit together and a reader who conflates them misconfigures both. */}
          <p className="mt-1 max-w-[62ch] text-[13px] text-ink-muted">
            Groups above <em>add</em> what people can do. These rules <em>hold things back</em>: an action
            that matches one waits in the review queue until the right person signs it off. A rule can only
            ever ask a person — it never grants anything, and it cannot let something through that a role or
            a spending limit already refused.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'Add a rule'}
        </Button>
      </div>

      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}

      {adding && (
        <RuleForm
          groups={groups}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
          onError={setError}
        />
      )}

      {rules === null ? (
        <Skeleton className="mt-4 h-24 w-full rounded-lg" />
      ) : rules.length === 0 ? (
        <p className="mt-4 text-[13px] text-ink-muted">
          No rules yet. Everything follows each campaign&rsquo;s own approval setting.
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3',
                // A switched-off rule is kept visible but visibly inert. Hiding it
                // would lose the answer to "we turned that off in March".
                !rule.enabled && 'opacity-60',
              )}
            >
              <div className="min-w-0">
                <p className="text-[13px] text-ink">{rule.label}</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">Applies to: {rule.appliesTo}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={rule.enabled ? 'success' : 'neutral'}>{rule.enabled ? 'On' : 'Off'}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === rule.id}
                  onClick={() => void toggle(rule)}
                >
                  {rule.enabled ? 'Switch off' : 'Switch on'}
                </Button>
                <Button variant="ghost" size="sm" disabled={busyId === rule.id} onClick={() => void remove(rule)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The add form.
 *
 * The threshold is typed in whole currency and converted at the edge, because
 * nobody types a spending limit in cents and the one who tries will type 100
 * meaning a hundred pounds.
 */
function RuleForm({
  groups,
  onSaved,
  onError,
}: {
  groups: Group[];
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [trigger, setTrigger] = useState<'publish' | 'spend_over'>('publish');
  const [amount, setAmount] = useState('100');
  const [requiresRole, setRequiresRole] = useState<Rule['requiresRole']>('approver');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await invoke<unknown>(
      'approval.rule.set',
      {
        trigger,
        ...(trigger === 'spend_over' ? { thresholdCents: Math.round((Number(amount) || 0) * 100) } : {}),
        requiresRole,
        groupIds,
        enabled: true,
      },
      crypto.randomUUID(),
    );
    setSaving(false);
    if (res.status === 'succeeded') {
      await onSaved();
      return;
    }
    onError(res.status === 'failed' ? res.error.message : 'Only owners and admins can add approval flows.');
  };

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface-muted p-4">
      <div className="grid gap-1">
        <span className="text-[12px] font-medium text-ink">What should wait for sign-off?</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {(
            [
              { value: 'publish', label: 'Every publish' },
              { value: 'spend_over', label: 'Spending over an amount' },
            ] as const
          ).map((option) => (
            <Button
              key={option.value}
              variant={trigger === option.value ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setTrigger(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {trigger === 'spend_over' && (
        <label className="grid gap-1">
          <span className="text-[12px] font-medium text-ink">Amount</span>
          <span className="text-[11px] text-ink-muted">
            Anything estimated above this waits. Exactly this amount goes through.
          </span>
          <Input
            type="number"
            min={0}
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-32 tabular-nums"
            aria-label="Amount in dollars"
          />
        </label>
      )}

      <div className="grid gap-1">
        <span className="text-[12px] font-medium text-ink">Who can sign it off?</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {REVIEWER_ROLES.map((option) => (
            <Button
              key={option.value}
              variant={requiresRole === option.value ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setRequiresRole(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {/* Stated because it is surprising, and because the alternative is
            somebody discovering it by having a post sit in a queue. */}
        <p className="mt-1 text-[11px] text-ink-muted">
          Owners and admins can always sign off, whichever you pick.
        </p>
      </div>

      <div className="grid gap-1">
        <span className="text-[12px] font-medium text-ink">Who does it apply to?</span>
        <p className="text-[11px] text-ink-muted">
          Pick no teams to apply it to everyone, including SPARK working on its own. Pick teams and it
          applies only to those people — SPARK is in no team, so its work goes through.
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {groups.length === 0 ? (
            <span className="text-[12px] text-ink-muted">No teams yet — this rule will apply to everyone.</span>
          ) : (
            groups.map((g) => {
              const on = groupIds.includes(g.id);
              return (
                <Button
                  key={g.id}
                  variant={on ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() =>
                    setGroupIds((prev) => (on ? prev.filter((id) => id !== g.id) : [...prev, g.id]))
                  }
                >
                  {g.name}
                </Button>
              );
            })
          )}
        </div>
      </div>

      <div>
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Add rule'}
        </Button>
      </div>
    </div>
  );
}
