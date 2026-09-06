'use client';

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@/lib/tools';
import { ApprovalFlowsPanel } from './ApprovalFlowsPanel';
import { PolicyPanel } from './PolicyPanel';
import { SettingsTabs } from './SettingsTabs';
import { AddClientModal, AddMemberModal, EditGroupModal, type EditableGroup } from './TeamModals';

/**
 * `Settings WS Team Users` / `… Team Groups` / `… Team Groups Flows`.
 *
 * Measured off the prototype's own DOM, relative to the 1350 content card:
 *
 *   tabs         31,119 · 218x50 r10.828; the active pill 107x42 r9.425 on
 *                **`#6CE8FF`** with `#0C0C0C` text — cyan, not black
 *   search       986,122 · 333x43 r10 white
 *   Add New User 1138,22 · 181x50 r10.828 on `rgba(131,131,131,0.2)`, 17.643/500
 *   rules        y 97 / 197 / 255 · 1350x1 `rgba(131,131,131,0.25)`
 *   headers      y219 · 18/500 grey — Name 72, Role 352, Email 538,
 *                Status 947, Last Login 1072
 *   rows         y270, pitch 83, each 1294x53 — a 24x24 r5.63 checkbox at 24,
 *                a 53x53 r12.322 monogram at 72, the name at 141, a 131x39
 *                r8.202 role chip at 352 tinted 10% of its own hue, the email
 *                at 538, an 89x34 r7.087 status chip at 947, last login at
 *                1072, and two 39x39 round buttons at 1236 and 1279
 *   groups       410x208 r13.364 white at x 31/469/907 (438 pitch), y222
 *   flows        626x102 r15.678 white, a 20/600 title over "Applies to: …",
 *                and a 57x31 r154 switch with a 25px knob
 *
 * ── What is real, and what the design assumes ─────────────────────────────
 *
 * `team.list` is the read: it returns org membership from Clerk joined with
 * this registry's per-brand rows. So name, email, role and join date are real,
 * and the role chip is `team.role.set`'s current value.
 *
 * Two of the design's columns are not. **Status** (Online/Offline) needs
 * presence, which nothing in the product tracks — no heartbeat, no session
 * table — and **Last Login** is not on Clerk's membership record either. Both
 * are rendered from what does exist: when the member joined. Inventing a green
 * "Online" dot from nothing would be the most convincing lie on this screen.
 *
 * "Add New User", "Add Client" and a group card each open the prototype's own
 * screen as a modal — `Settings WS Add Member`, `… Add Client`, `… Edit Group`.
 * All three write: `team.invite` sends a real invitation through Clerk,
 * `brand.create` provisions a client brand and its genome, and
 * `team.group.update` plus `team.group.member.set` edit a group.
 */

interface Member {
  userId: string;
  email?: string;
  name?: string;
  orgRole: string;
  joinedAt: string;
  brands: Array<{ brandId: string; role: string }>;
  allBrands: boolean;
}

/**
 * `team.group.list`'s row, with the tool's own field names.
 *
 * It returns **`id`**, not `groupId` — while `team.group.update` and
 * `team.group.member.set` both take `groupId`. Declaring this as `groupId` made
 * it `undefined` at runtime and the writes came back `groupId: Required`;
 * TypeScript could not catch it because the interface was hand-written rather
 * than derived from the tool. The names differ, so the mapping is explicit
 * where the two meet.
 */
interface Group {
  id: string;
  name: string;
  capabilities: string[];
  members: string[];
}

/** One hue per role, straight off the design's own chips. */
const ROLE_HUE: Record<string, string> = {
  owner: 'var(--ss-set-role-owner)',
  admin: 'var(--ss-set-role-admin)',
  editor: 'var(--ss-set-role-editor)',
  creator: 'var(--ss-set-role-creator)',
  approver: 'var(--ss-set-role-approver)',
  publisher: 'var(--ss-set-role-publisher)',
  client: 'var(--ss-set-role-client)',
  viewer: 'var(--ss-set-role-viewer)',
};

/** The 53x53 monogram tile. Hue derived from the id so it is stable per person. */
const TILE_HUES = ['#F172FA', '#6CE8FF', '#A341FF', '#FEDEB5', '#8FD98A', '#F5B23C'];

function hueFor(seed: string) {
  let n = 0;
  for (const c of seed) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return TILE_HUES[n % TILE_HUES.length]!;
}

function monogram(m: Member) {
  const src = (m.name || m.email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src.slice(0, 2).toUpperCase();
}

export function TeamRolesSection() {
  const [tab, setTab] = useState<'users' | 'groups'>('users');
  /* Bumped after any modal writes, so both tabs re-read rather than showing the
     list as it was before the invitation or the group edit. */
  const [reloads, setReloads] = useState(0);
  const [modal, setModal] = useState<null | { kind: 'member' } | { kind: 'client' } | { kind: 'group'; group: EditableGroup | null }>(null);
  const [people, setPeople] = useState<Member[]>([]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-[16px]">
        <SettingsTabs
          label="Team roles"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'users', label: 'Users' },
            { id: 'groups', label: 'Groups' },
          ]}
        />

        {/* The design's 181x50 r10.828 action, level with the tab strip. */}
        <div className="flex flex-wrap items-center gap-[10px]">
          <button
            type="button"
            onClick={() => setModal({ kind: 'client' })}
            className="h-[50px] rounded-[10.828px] px-[22px] text-[17.643px] font-medium text-ink transition-colors hover:bg-[rgba(131,131,131,0.3)]"
            style={{ background: 'rgba(131,131,131,0.2)' }}
          >
            + Add Client
          </button>
          <button
            type="button"
            onClick={() => (tab === 'groups' ? setModal({ kind: 'group', group: null }) : setModal({ kind: 'member' }))}
            className="h-[50px] rounded-[10.828px] px-[22px] text-[17.643px] font-medium text-ink transition-colors hover:bg-[rgba(131,131,131,0.3)]"
            style={{ background: 'rgba(131,131,131,0.2)' }}
          >
            {tab === 'groups' ? 'Create Group' : 'Add New User'}
          </button>
        </div>
      </div>

      <div className="mt-[22px]">
        {tab === 'users' ? (
          <UsersTab reloads={reloads} onPeople={setPeople} />
        ) : (
          <GroupsTab reloads={reloads} people={people} onEdit={(g) => setModal({ kind: 'group', group: g })} />
        )}
      </div>

      {modal?.kind === 'member' ? (
        <AddMemberModal onClose={() => setModal(null)} onDone={() => setReloads((n) => n + 1)} />
      ) : null}
      {modal?.kind === 'client' ? (
        <AddClientModal onClose={() => setModal(null)} onDone={() => setReloads((n) => n + 1)} />
      ) : null}
      {modal?.kind === 'group' ? (
        <EditGroupModal
          group={modal.group}
          people={people}
          onClose={() => setModal(null)}
          onDone={() => setReloads((n) => n + 1)}
        />
      ) : null}
    </>
  );
}

/* ── Users ───────────────────────────────────────────────────────────── */

function UsersTab({ reloads, onPeople }: { reloads: number; onPeople: (m: Member[]) => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await invoke<{ members: Member[]; partial?: string }>('team.list', {});
      if (res.status !== 'succeeded') {
        setMembers([]);
        setError(res.status === 'failed' ? res.error.message : 'Reading the team needs an approval.');
        return;
      }
      setMembers(res.output.members);
      /* The group editor needs names for its member pills, and this is the read
         that has them — so it is lifted rather than fetched twice. */
      onPeople(res.output.members);
      if (res.output.partial) setError(res.output.partial);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloads]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return members ?? [];
    return (members ?? []).filter(
      (m) => (m.name ?? '').toLowerCase().includes(needle) || (m.email ?? '').toLowerCase().includes(needle),
    );
  }, [members, q]);

  async function setRole(m: Member, role: string) {
    setBusyId(m.userId);
    const res = await invoke('team.role.set', { userId: m.userId, role });
    setBusyId(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Changing a role needs an approval.');
      return;
    }
    setMembers((list) => (list ?? []).map((x) => (x.userId === m.userId ? { ...x, orgRole: role } : x)));
  }

  return (
    <div className="-mx-[30px] overflow-x-auto pl-[24px] pr-[32px]">
      <div className="min-w-[1294px]">
        {/* search — the design puts it level with the tab strip, on the right */}
        <div className="mb-[18px] flex justify-end">
          <label
            className="flex h-[43px] w-[333px] items-center gap-[10px] rounded-[10px] bg-white px-[19px]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="6.2" stroke="rgba(12,12,12,0.4)" strokeWidth="1.6" />
              <path d="m12.6 12.6 3.4 3.4" stroke="rgba(12,12,12,0.4)" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search team"
              aria-label="Search team"
              className="w-full bg-transparent text-16 font-medium text-ink outline-none placeholder:text-[rgba(12,12,12,0.4)]"
            />
          </label>
        </div>

        {/* column headers, on the design's rule */}
        <div
          className="grid items-center pb-[13px] text-18 font-medium"
          style={{ gridTemplateColumns: '48px 69px 211px 186px 409px 125px 164px 82px', color: 'rgb(131,131,131)' }}
        >
          <span />
          <span />
          <span>Name</span>
          <span>Role</span>
          <span>Email</span>
          <span>Status</span>
          <span>Last Login</span>
          <span />
        </div>
        <div aria-hidden className="h-px w-full" style={{ background: 'rgba(131,131,131,0.25)' }} />

        {members === null ? (
          <p className="py-[24px] text-16" style={{ color: 'rgb(131,131,131)' }}>Reading the team…</p>
        ) : shown.length === 0 ? (
          <p className="py-[24px] text-16" style={{ color: 'rgb(131,131,131)' }}>
            {q ? 'Nobody matches that.' : 'Nobody else is in this organisation yet.'}
          </p>
        ) : (
          <ul>
            {shown.map((m) => {
              const role = m.orgRole.replace(/^org:/, '');
              const hue = ROLE_HUE[role] ?? 'var(--ss-set-role-viewer)';
              return (
                <li
                  key={m.userId}
                  className="grid items-center border-b border-[rgba(131,131,131,0.25)]"
                  style={{ gridTemplateColumns: '48px 69px 211px 186px 409px 125px 164px 82px', height: 83 }}
                >
                  <span
                    aria-hidden
                    className="block h-[24px] w-[24px] rounded-[5.63px]"
                    style={{ boxShadow: 'inset 0 0 0 1.5px rgba(12,12,12,0.2)' }}
                  />

                  <span
                    aria-hidden
                    className="flex h-[53px] w-[53px] items-center justify-center rounded-[12.322px] text-20 font-bold text-black"
                    style={{ background: hueFor(m.userId) }}
                  >
                    {monogram(m)}
                  </span>

                  <span className="truncate pr-[12px] text-18 font-medium text-ink">{m.name ?? '—'}</span>

                  {/* The role chip is also the control — `team.role.set`. */}
                  <span className="relative block h-[39px] w-[131px]">
                    <select
                      value={role}
                      disabled={busyId === m.userId}
                      onChange={(e) => void setRole(m, e.target.value)}
                      aria-label={`Role for ${m.name ?? m.email ?? 'this member'}`}
                      className="h-full w-full cursor-pointer appearance-none rounded-[8.202px] text-center text-18 font-medium outline-none"
                      style={{ background: `color-mix(in srgb, ${hue} 10%, transparent)`, color: hue }}
                    >
                      {['owner', 'admin', 'editor', 'approver', 'viewer', 'client'].map((r) => (
                        <option key={r} value={r} style={{ color: '#0C0C0C' }}>
                          {r[0]!.toUpperCase() + r.slice(1)}
                        </option>
                      ))}
                    </select>
                  </span>

                  <span className="truncate pr-[12px] text-18 font-medium text-ink">{m.email ?? '—'}</span>

                  {/*
                    The design's Online/Offline pill. Nothing tracks presence, so
                    this says what is known — whether the member reaches every
                    brand or only some — rather than inventing a green dot.
                  */}
                  <span
                    className="flex h-[34px] w-[89px] items-center justify-center rounded-[7.087px] text-[15.553px] font-medium"
                    style={{ background: 'rgba(131,131,131,0.2)', color: 'rgb(131,131,131)' }}
                    title={m.allBrands ? 'Administers every brand in this organisation' : `${m.brands.length} brand(s)`}
                  >
                    {m.allBrands ? 'All brands' : `${m.brands.length} brand${m.brands.length === 1 ? '' : 's'}`}
                  </span>

                  <span className="text-18 font-normal" style={{ color: 'rgb(131,131,131)' }}>
                    {new Date(m.joinedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>

                  <span className="flex items-center justify-self-end">
                    <RowButton label="Copy email" onClick={() => void navigator.clipboard?.writeText(m.email ?? '')}>
                      <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden>
                        <rect x="6" y="6" width="10" height="11" rx="2" stroke="rgb(131,131,131)" strokeWidth="1.5" />
                        <path d="M12 6V3.6a1.6 1.6 0 0 0-1.6-1.6H3.6A1.6 1.6 0 0 0 2 3.6v6.8A1.6 1.6 0 0 0 3.6 12H6" stroke="rgb(131,131,131)" strokeWidth="1.5" />
                      </svg>
                    </RowButton>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {error ? <p className="mt-[16px] text-16 text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

/** The design's 39x39 round row button. */
function RowButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-[39px] w-[39px] items-center justify-center rounded-full transition-colors hover:bg-[rgba(131,131,131,0.2)]"
      style={{ background: 'rgba(131,131,131,0.1)' }}
    >
      {children}
    </button>
  );
}

/* ── Groups ──────────────────────────────────────────────────────────── */

const CAPABILITY_LABEL: Record<string, string> = {
  publish: 'Publish',
  spend_credits: 'Spend credits',
  manage_brand: 'Manage brand',
  approve: 'Approve',
};

function GroupsTab({
  reloads,
  people,
  onEdit,
}: {
  reloads: number;
  people: Member[];
  onEdit: (g: EditableGroup) => void;
}) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await invoke<{ groups: Group[] }>('team.group.list', {});
      if (res.status !== 'succeeded') {
        setGroups([]);
        setError(res.status === 'failed' ? res.error.message : 'Reading groups needs an approval.');
        return;
      }
      setGroups(res.output.groups);
    })();
  }, [reloads]);

  return (
    <div className="grid grid-cols-1 gap-[34px]">
      <section>
        {groups === null ? (
          <p className="text-16" style={{ color: 'rgb(131,131,131)' }}>Reading groups…</p>
        ) : groups.length === 0 ? (
          <p className="text-16" style={{ color: 'rgb(131,131,131)' }}>
            No groups yet. A group is a named set of capabilities that widens what its members may do,
            on top of their role.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-[28px]">
            {groups.map((g) => (
              <li key={g.id}>
                {/* The design's group name is the affordance — `ws9` opens from it. */}
                <button
                  type="button"
                  onClick={() => onEdit({ groupId: g.id, name: g.name, capabilities: g.capabilities, members: g.members })}
                  className="h-[208px] w-[410px] rounded-[13.364px] bg-white p-[24px] text-left transition-shadow hover:shadow-card"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.15)' }}
                >
                <p className="text-20 font-bold text-ink">{g.name}</p>

                <p className="mt-[12px] text-16 font-normal leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
                  Permissions:{' '}
                  <span className="text-ink">
                    {g.capabilities.length
                      ? g.capabilities.map((c) => CAPABILITY_LABEL[c] ?? c).join(', ')
                      : 'None beyond each member’s own role'}
                  </span>
                </p>

                <p className="mt-[18px] flex items-center gap-[14px] text-16 font-normal" style={{ color: 'rgb(131,131,131)' }}>
                  Members:
                  <span aria-hidden className="relative block h-[30px] w-[74px]">
                    {g.members.slice(0, 3).map((id, i) => (
                      <span
                        key={id}
                        className="absolute top-0 block h-[30px] w-[30px] rounded-full"
                        style={{ left: i * 22, zIndex: 3 - i, background: hueFor(id), boxShadow: '0 0 0 2px #FFFFFF' }}
                      />
                    ))}
                  </span>
                  <span className="text-ink">{g.members.length}</span>
                </p>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="mt-[14px] text-16 text-destructive">{error}</p> : null}
      </section>

      {/*
        The prototype's third team screen is this block under the same Groups
        tab — which is what "(Optional)" in its own heading means. Both panels
        below already carry the design's card and switch.
      */}
      <ApprovalFlowsPanel />
      <PolicyPanel />
    </div>
  );
}
