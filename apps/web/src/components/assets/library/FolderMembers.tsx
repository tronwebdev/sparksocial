'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModalShell } from '@/components/common/ModalShell';
import { invoke } from '@/lib/tools';
import type { Folder } from './types';

/**
 * Assigning people to a folder.
 *
 * ── What an assignment is ─────────────────────────────────────────────────
 *
 * A responsibility marker: who is looking after this footage. It is **not** an
 * access control and it does not pretend to be one — retrieval is scoped by
 * genome and never by folder, so every folder stays visible to everybody who
 * can reach the brand. The panel says that in as many words, because "assign a
 * member" reads like a permission and a screen that let it look like one would
 * be promising a boundary the query layer does not enforce.
 *
 * ── And what it deliberately leaves alone ─────────────────────────────────
 *
 * Nothing here writes brand membership. Who can reach the brand at all is Clerk
 * org membership plus `brand_members`, changed by `team.role.set` in Settings →
 * Team. `asset.folder.member.set` writes one table, `asset_folder_members`, so
 * adding somebody to a folder cannot add, remove or alter anybody's standing on
 * the brand — which is the constraint this feature was asked for under.
 *
 * The list is everyone in the org (`team.list`) rather than everyone already on
 * the brand: an org admin reaches every brand by construction and has no
 * `brand_members` row to be found by, so filtering by that would hide exactly
 * the people most likely to own a folder.
 */

export interface TeamMember {
  userId: string;
  name?: string;
  email?: string;
  orgRole: string;
}

export function memberName(m: TeamMember): string {
  return m.name ?? m.email ?? m.userId;
}

/** Two letters for the avatar bubble, from whatever the account actually has. */
export function initials(m: TeamMember): string {
  const source = m.name ?? m.email ?? m.userId;
  const parts = source.split(/[\s._@-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || source.slice(0, 2).toUpperCase();
}

/** Everyone in the org, once, for whichever panel needs to offer them. */
export function useTeam(): { team: TeamMember[] | null; error: string | null } {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await invoke<{ members: TeamMember[] }>('team.list', { limit: 100 });
    if (res.status !== 'succeeded') {
      /* A viewer-role member cannot read the team list — `team.list` withholds
         colleagues' emails from roles that should not have them. An empty
         picker with a reason beats an error banner on a folder dialog. */
      setError(res.status === 'failed' ? res.error.message : 'You do not have access to the team list.');
      setTeam([]);
      return;
    }
    setTeam(res.output.members);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { team, error };
}

/**
 * The picker itself — a checklist, used both while creating a folder and when
 * changing one afterwards.
 */
export function MemberChecklist({
  team,
  error,
  selected,
  onToggle,
  emptyHint,
}: {
  team: TeamMember[] | null;
  error: string | null;
  selected: string[];
  onToggle: (userId: string) => void;
  emptyHint: string;
}) {
  if (team === null) return <p className="py-[16px] text-15 text-ink-muted">Loading the team…</p>;

  if (team.length === 0) {
    return <p className="py-[16px] text-[14px] leading-[1.5] text-ink-muted">{error ?? emptyHint}</p>;
  }

  return (
    <ul className="flex flex-col gap-[8px]">
      {team.map((m) => {
        const on = selected.includes(m.userId);
        return (
          <li key={m.userId}>
            <button
              type="button"
              onClick={() => onToggle(m.userId)}
              aria-pressed={on}
              className="flex h-[58px] w-full items-center gap-[12px] rounded-[13px] bg-white px-[14px] text-left transition-shadow hover:shadow-[0_10px_26px_-18px_rgba(12,12,12,0.45)]"
              style={{ boxShadow: `inset 0 0 0 ${on ? '1.6px rgba(12,12,12,0.55)' : '1px rgba(131,131,131,0.16)'}` }}
            >
              <span
                aria-hidden
                className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-ink"
                style={{ background: '#E7EEF6' }}
              >
                {initials(m)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-ink">{memberName(m)}</span>
                <span className="block truncate text-[12.5px]" style={{ color: '#838383' }}>
                  {m.orgRole}
                  {m.email && m.name ? ` · ${m.email}` : ''}
                </span>
              </span>
              <span
                aria-hidden
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px]"
                style={{
                  background: on ? '#0C0C0C' : '#FFFFFF',
                  boxShadow: on ? 'none' : 'inset 0 0 0 1.3px rgba(12,12,12,0.25)',
                }}
              >
                {on ? (
                  <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                    <path d="m1 4.5 3 3L10 1" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The note that stops an assignment being mistaken for a permission. */
export function AssignmentNote() {
  return (
    <p className="mt-[12px] text-[12.5px] leading-[1.5]" style={{ color: '#838383' }}>
      Assigning someone marks who looks after this folder. It does not change what they can see —
      everyone on the brand can already open every folder — and it does not change their access to
      the brand, which is set in Settings → Team.
    </p>
  );
}

export function FolderMembersModal({
  genomeId,
  folder,
  onClose,
  onSaved,
}: {
  genomeId: string;
  folder: Folder;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const { team, error: teamError } = useTeam();
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await invoke<{ members: Array<{ userId: string }> }>('asset.folder.members', {
        genomeId,
        folderId: folder.folderId,
      });
      if (cancelled) return;
      setSelected(res.status === 'succeeded' ? res.output.members.map((m) => m.userId) : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, folder.folderId]);

  async function save() {
    if (busy || selected === null) return;
    setBusy(true);
    setError(null);
    /* `idempotent: true` — the same list twice is the same state. */
    const res = await invoke('asset.folder.member.set', {
      genomeId,
      folderId: folder.folderId,
      userIds: selected,
    });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    onSaved(selected.length);
  }

  return (
    <ModalShell
      top={220}
      height={560}
      width={620}
      radius={28}
      background="var(--ss-grad-lib-create)"
      label="Folder members"
      onClose={onClose}
    >
      <p className="pt-[46px] text-center text-[26px] font-bold text-ink">Assign Team members</p>
      <p className="mt-[6px] truncate px-[40px] text-center text-15 text-ink-muted" title={folder.name}>
        {folder.name}
      </p>

      <div className="mt-[20px] max-h-[280px] overflow-y-auto px-[60px]">
        <MemberChecklist
          team={team}
          error={teamError}
          selected={selected ?? []}
          onToggle={(id) =>
            setSelected((cur) => ((cur ?? []).includes(id) ? (cur ?? []).filter((x) => x !== id) : [...(cur ?? []), id]))
          }
          emptyHint="Nobody else is in this workspace yet. Invite people in Settings → Team."
        />
        {error ? <p className="mt-[12px] text-15 text-destructive">{error}</p> : null}
      </div>

      <div className="px-[60px]">
        <AssignmentNote />
      </div>

      <div className="mt-[18px] flex items-center justify-center gap-[26px]">
        <button
          type="button"
          onClick={onClose}
          className="flex h-[52px] items-center rounded-[11px] px-[24px] transition-colors hover:bg-white"
          style={{ background: 'rgba(255,255,255,0.6)', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}
        >
          <span className="text-17 font-medium" style={{ color: '#838383' }}>
            Cancel
          </span>
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || selected === null}
          className="flex h-[52px] items-center rounded-[11px] px-[24px] text-18 font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: 'var(--ss-lib-toggle)' }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </ModalShell>
  );
}
