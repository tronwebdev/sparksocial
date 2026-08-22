'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { invoke } from '@/lib/tools';

/**
 * TEAM GROUPS (`SET-WS-TEAM-GROUPS`) — the Groups tab.
 *
 * `team.permission.set` scopes a person to a client's brand and `team.role.set`
 * puts them on the org ladder. Neither answers the question this screen asks:
 * *"these four people may publish and approve, whatever their role says."*
 *
 * The one thing the copy here has to get across is that groups **only widen**.
 * Everything else called "permissions" in a product like this takes access away,
 * so the natural reading of an unticked box is "denied" — and it is not; it is
 * "nothing added". Getting that wrong means somebody unticks a box expecting to
 * revoke publishing and revokes nothing.
 */

interface Group {
  id: string;
  name: string;
  capabilities: string[];
  memberCount: number;
  members: string[];
}

/**
 * The four the design names. Labels say what the capability *does to a
 * restriction*, because that is the only thing that makes the "widens only"
 * point concrete: "Publish" alone reads like a permission that could be taken
 * away.
 */
const CAPABILITIES = [
  { value: 'publish', label: 'Publish', hint: 'Even if publishing is restricted by role.' },
  { value: 'spend_credits', label: 'Spend credits', hint: 'Even where spending is switched off.' },
  { value: 'manage_brand', label: 'Manage brand', hint: 'Brand and genome settings.' },
  { value: 'approve', label: 'Approve', hint: 'Including media that would otherwise wait.' },
] as const;

export function TeamGroupsPanel() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCapabilities, setNewCapabilities] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [memberDrafts, setMemberDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const res = await invoke<{ groups: Group[] }>('team.group.list', {});
    setGroups(res.status === 'succeeded' ? res.output.groups : []);
  }

  /** Every write goes through the same reporting, so no path fails silently. */
  async function run(key: string, work: () => Promise<{ ok: boolean; text: string }>) {
    setBusy(key);
    setMessage(null);
    const { ok, text } = await work();
    await refresh();
    setBusy(null);
    setMessage({ kind: ok ? 'ok' : 'err', text });
  }

  async function create() {
    await run('create', async () => {
      const res = await invoke<{ name: string }>('team.group.create', {
        name: newName,
        capabilities: newCapabilities,
        members: [],
      });
      if (res.status === 'succeeded') {
        setNewName('');
        setNewCapabilities([]);
        setCreating(false);
        return { ok: true, text: `Created ${res.output.name}.` };
      }
      return { ok: false, text: res.status === 'failed' ? res.error.message : 'That change needs approval.' };
    });
  }

  async function toggleCapability(group: Group, capability: string) {
    const next = group.capabilities.includes(capability)
      ? group.capabilities.filter((c) => c !== capability)
      : [...group.capabilities, capability];

    await run(group.id, async () => {
      const res = await invoke('team.group.update', { groupId: group.id, capabilities: next });
      return res.status === 'succeeded'
        ? { ok: true, text: `Updated ${group.name}.` }
        : { ok: false, text: res.status === 'failed' ? res.error.message : 'That change needs approval.' };
    });
  }

  async function setMember(group: Group, userId: string, member: boolean) {
    await run(group.id, async () => {
      const res = await invoke('team.group.member.set', { groupId: group.id, userId, member });
      if (res.status === 'succeeded') {
        setMemberDrafts((prev) => ({ ...prev, [group.id]: '' }));
        return { ok: true, text: member ? `Added to ${group.name}.` : `Removed from ${group.name}.` };
      }
      return { ok: false, text: res.status === 'failed' ? res.error.message : 'That change needs approval.' };
    });
  }

  async function remove(group: Group) {
    await run(group.id, async () => {
      const res = await invoke('team.group.delete', { groupId: group.id });
      return res.status === 'succeeded'
        ? { ok: true, text: `Deleted ${group.name}.` }
        : { ok: false, text: res.status === 'failed' ? res.error.message : 'That change needs approval.' };
    });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">Team groups</h2>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
            A group gives its members abilities their role does not include — nothing more. It cannot take
            anything away, so to restrict somebody, change their role instead.
          </p>
        </div>
        {!creating && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            Create group
          </Button>
        )}
      </div>

      {creating && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <label className="block text-[12px] font-medium text-ink-muted" htmlFor="group-name">
            Group name
          </label>
          <Input
            id="group-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Video Production"
            className="mt-1.5 max-w-sm"
          />

          <p className="mt-3 text-[12px] font-medium text-ink-muted">What it adds</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CAPABILITIES.map((c) => {
              const on = newCapabilities.includes(c.value);
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={on}
                  title={c.hint}
                  onClick={() =>
                    setNewCapabilities((prev) =>
                      prev.includes(c.value) ? prev.filter((x) => x !== c.value) : [...prev, c.value],
                    )
                  }
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                    on
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-ink-muted hover:bg-surface-muted',
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy === 'create' || !newName.trim()} onClick={() => void create()}>
              {busy === 'create' ? 'Creating…' : 'Create'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === 'create'}
              onClick={() => {
                setCreating(false);
                setNewName('');
                setNewCapabilities([]);
              }}
            >
              Cancel
            </Button>
            <span className="text-[12px] text-ink-muted">Add people once it exists.</span>
          </div>
        </div>
      )}

      {groups === null ? (
        <p className="mt-4 text-[13px] text-ink-muted">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="mt-4 text-[13px] text-ink-muted">
          No groups yet. Everyone has exactly what their role gives them.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {groups.map((group) => (
            <li key={group.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[14px] font-medium text-ink">{group.name}</span>
                <span className="text-[12px] text-ink-muted">
                  {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
                </span>
              </div>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {CAPABILITIES.map((c) => {
                  const on = group.capabilities.includes(c.value);
                  return (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={on}
                      title={c.hint}
                      disabled={busy === group.id}
                      onClick={() => void toggleCapability(group, c.value)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-50',
                        on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-ink-muted hover:bg-surface-muted',
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              {group.capabilities.length === 0 && (
                <p className="mt-2 text-[12px] text-ink-muted">
                  Adds nothing yet — this is just a list of people.
                </p>
              )}

              <div className="mt-3 border-t border-border pt-3">
                {group.members.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {group.members.map((userId) => (
                      <Badge key={userId} variant="neutral">
                        <span className="font-mono text-[11px]">{userId}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${userId}`}
                          disabled={busy === group.id}
                          onClick={() => void setMember(group, userId, false)}
                          className="ml-1.5 text-ink-muted hover:text-ink disabled:opacity-50"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-ink-muted">Nobody in this group.</p>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Input
                    value={memberDrafts[group.id] ?? ''}
                    onChange={(e) => setMemberDrafts((prev) => ({ ...prev, [group.id]: e.target.value }))}
                    placeholder="User id"
                    aria-label={`Add somebody to ${group.name}`}
                    className="max-w-[220px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === group.id || !(memberDrafts[group.id] ?? '').trim()}
                    onClick={() => void setMember(group, (memberDrafts[group.id] ?? '').trim(), true)}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === group.id}
                    onClick={() => void remove(group)}
                    className="ml-auto text-destructive"
                  >
                    Delete group
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p className={cn('mt-4 text-[13px]', message.kind === 'ok' ? 'text-ink-muted' : 'text-destructive')}>
          {message.text}
        </p>
      )}
    </section>
  );
}
