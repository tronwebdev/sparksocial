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

/** The slice of `team.list` this screen needs to show a person rather than an id. */
interface Member {
  userId: string;
  name?: string;
  email?: string;
  orgRole: string;
}

/** What to call somebody when Clerk has a name, an email, or neither. */
function memberLabel(m: Member | undefined, userId: string): string {
  if (!m) return userId;
  return m.name ?? m.email ?? userId;
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
  /**
   * The workspace roster, or null when it could not be read.
   *
   * Null is a real state rather than an empty list: `team.list` is registered
   * only when Clerk is configured, and it is `owner`/`admin` only, so an editor
   * opening this screen gets a policy denial rather than a roster. Both cases
   * fall back to entering an id by hand, which is what this task replaces —
   * degrading to it beats a screen with no way to add anybody at all.
   */
  const [roster, setRoster] = useState<Member[] | null>(null);

  useEffect(() => {
    void refresh();
    void (async () => {
      const res = await invoke<{ members: Member[] }>('team.list', { limit: 200 });
      setRoster(res.status === 'succeeded' ? res.output.members : null);
    })();
  }, []);

  async function refresh() {
    const res = await invoke<{ groups: Group[] }>('team.group.list', {});
    setGroups(res.status === 'succeeded' ? res.output.groups : []);
  }

  /** Everyone not already in this group — the only useful thing to offer. */
  function addable(group: Group): Member[] {
    if (!roster) return [];
    return roster.filter((m) => m.userId && !group.members.includes(m.userId));
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
                    {group.members.map((userId) => {
                      const person = roster?.find((m) => m.userId === userId);
                      const label = memberLabel(person, userId);
                      return (
                        <Badge key={userId} variant="neutral">
                          {/* A name when we have one, and the id in monospace when
                              we do not — an id is still the truth, it is just not
                              a person's name. */}
                          <span className={person ? 'text-[12px]' : 'font-mono text-[11px]'}>{label}</span>
                          <button
                            type="button"
                            aria-label={`Remove ${label}`}
                            disabled={busy === group.id}
                            onClick={() => void setMember(group, userId, false)}
                            className="ml-1.5 text-ink-muted hover:text-ink disabled:opacity-50"
                          >
                            ×
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[12px] text-ink-muted">Nobody in this group.</p>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {roster ? (
                    /* A select rather than a search box: a workspace roster is
                       tens of people, not thousands, so the whole list fits and
                       typeahead would be ceremony. `team.list` caps at 200. */
                    <select
                      value={memberDrafts[group.id] ?? ''}
                      onChange={(e) => setMemberDrafts((prev) => ({ ...prev, [group.id]: e.target.value }))}
                      aria-label={`Add somebody to ${group.name}`}
                      disabled={busy === group.id || addable(group).length === 0}
                      className="max-w-[260px] rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink disabled:opacity-50"
                    >
                      <option value="">
                        {addable(group).length === 0 ? 'Everyone is already in this group' : 'Add somebody…'}
                      </option>
                      {addable(group).map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {memberLabel(m, m.userId)}
                          {m.email && m.name ? ` · ${m.email}` : ''} · {m.orgRole}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={memberDrafts[group.id] ?? ''}
                      onChange={(e) => setMemberDrafts((prev) => ({ ...prev, [group.id]: e.target.value }))}
                      placeholder="User id"
                      aria-label={`Add somebody to ${group.name}`}
                      className="max-w-[220px]"
                    />
                  )}
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

      {roster === null && groups !== null && (
        <p className="mt-4 text-[13px] text-ink-muted">
          The workspace roster could not be read, so members are added by user id. That read needs an owner
          or admin role and a configured identity provider.
        </p>
      )}

      {message && (
        <p className={cn('mt-4 text-[13px]', message.kind === 'ok' ? 'text-ink-muted' : 'text-destructive')}>
          {message.text}
        </p>
      )}
    </section>
  );
}
