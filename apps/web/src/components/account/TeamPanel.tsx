'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';

/**
 * `SET-WS-01` — teams, roles, and which brands each person can reach.
 *
 * ── Why this is an org-level screen and not a brand one ───────────────────
 *
 * Membership belongs to the org; brand assignment is *about* brands but is not
 * scoped to one. An agency operator moving a staffer from client A to client B
 * would otherwise have to open client A's settings to remove them and client B's
 * to add them — two screens for one decision. So this lives on `/account`,
 * where every brand is already in view.
 *
 * ── The split the PRD cares about ─────────────────────────────────────────
 *
 * Two different systems own the two halves, and the screen says so rather than
 * pretending it is one setting. **Clerk owns whether someone is in the org**
 * (`team.invite`, `team.role.set`), which is what lands in their session claims.
 * **This registry owns which brands they can reach** (`team.permission.set`,
 * backed by `brand_members`, which `clerk-auth.ts` checks on every request).
 * Getting the first right and the second wrong is exactly how an agency leaks
 * one client's material to another, so the second is never implied — it is a row
 * you can see, or its absence.
 *
 * Owners and admins show as reaching every brand rather than as assigned to
 * none. They administer the whole org by construction and have no `brand_members`
 * rows, and rendering that as an empty list reads as "locked out" — the opposite
 * of the truth.
 */

interface BrandAssignment {
  brandId: string;
  role: string;
}

interface Member {
  userId: string;
  email?: string;
  name?: string;
  orgRole: string;
  joinedAt: string;
  brands: BrandAssignment[];
  allBrands: boolean;
}

interface Brand {
  genomeId: string;
  brandId: string;
  name: string;
}

/**
 * The six roles `Role` names. `client` is last and separated in the copy because
 * it is the only one that is not a colleague — it is the agency's customer,
 * looking at their own brand.
 */
const BRAND_ROLES = ['admin', 'editor', 'approver', 'viewer', 'client'] as const;

/**
 * What `team.invite` sends to Clerk. Prefixed, because Clerk's own role
 * identifiers are `org:`-namespaced and the tool passes the string through
 * untouched — an unprefixed value is rejected by Clerk with a message that does
 * not explain why.
 */
const ORG_ROLES = [
  { value: 'org:admin', label: 'Admin' },
  { value: 'org:editor', label: 'Editor' },
  { value: 'org:approver', label: 'Approver' },
  { value: 'org:viewer', label: 'Viewer' },
] as const;

export function TeamPanel() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('org:editor');

  const load = useCallback(async () => {
    const [team, roster] = await Promise.all([
      invoke<{ members: Member[]; partial?: string }>('team.list', { limit: 100 }),
      invoke<{ genomes: Brand[] }>('genome.list', {}),
    ]);

    if (team.status === 'succeeded') {
      setMembers(team.output.members);
      setPartial(team.output.partial ?? null);
      setError(null);
    } else {
      setError(
        team.status === 'failed'
          ? team.error.message
          : 'Only an owner or admin can see who is in this workspace.',
      );
    }
    // A failed roster read degrades the assignment control to nothing rather
    // than failing the member list beside it.
    if (roster.status === 'succeeded') setBrands(roster.output.genomes);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite() {
    if (!inviteEmail.trim()) return;
    setBusy('invite');
    setNote(null);
    // `idempotent: false` on the tool — a replayed key would still be a second
    // email, so no key is sent and a double click is the user's own risk, made
    // smaller by disabling the button while it runs.
    const res = await invoke<{ invitationId: string; status: string }>('team.invite', {
      email: inviteEmail.trim(),
      role: inviteRole,
    });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setNote({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That invitation was held for review.' });
      return;
    }
    setNote({ kind: 'ok', text: `Invitation sent to ${inviteEmail.trim()}. They appear here once they accept.` });
    setInviteEmail('');
    await load();
  }

  async function setOrgRole(userId: string, role: string) {
    setBusy(`role:${userId}`);
    setNote(null);
    const res = await invoke<{ role: string }>('team.role.set', { userId, role });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setNote({
        kind: 'err',
        text: res.status === 'failed' ? res.error.message : 'Only the owner can change org roles.',
      });
      return;
    }
    await load();
  }

  async function setBrandAccess(userId: string, brandId: string, role?: string) {
    setBusy(`brand:${userId}:${brandId}`);
    setNote(null);
    const res = await invoke('team.permission.set', {
      userId,
      brandId,
      ...(role ? { role } : { revoke: true }),
    });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setNote({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That change was held for review.' });
      return;
    }
    await load();
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Team</h2>
      <p className="mt-1 max-w-prose text-[14px] text-ink-muted">
        Who is in this workspace, and which brands each of them can open. Being in the workspace is not the
        same as having access to a brand — everyone below an admin needs to be assigned explicitly.
      </p>

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
      {partial ? <p className="mt-3 text-[13px] text-warn">{partial}</p> : null}
      {note ? (
        <p className={cn('mt-3 text-[13px]', note.kind === 'ok' ? 'text-success' : 'text-destructive')}>{note.text}</p>
      ) : null}

      {/* ── Invite ──────────────────────────────────────────────────────── */}
      <div className="mt-5 rounded-lg border border-border p-4">
        <p className="text-[13px] font-medium text-ink">Invite someone</p>
        <p className="mt-1 text-[12px] text-ink-muted">
          Clerk sends the email. They join the workspace with the role you pick here, and reach no brand until
          you assign one below.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="block text-[12px] text-ink-muted" htmlFor="team-email">
              Email
            </label>
            <Input
              id="team-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-[12px] text-ink-muted" htmlFor="team-role">
              Workspace role
            </label>
            <select
              id="team-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink"
            >
              {ORG_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <Button disabled={busy !== null || !inviteEmail.trim()} onClick={() => void invite()}>
            {busy === 'invite' ? 'Sending…' : 'Send invitation'}
          </Button>
        </div>
      </div>

      {/* ── Members ─────────────────────────────────────────────────────── */}
      <div className="mt-4">
        {members === null && !error ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : members && members.length === 0 ? (
          <p className="text-[14px] text-ink-muted">Nobody else has joined yet.</p>
        ) : members ? (
          <ul className="grid grid-cols-1 gap-3">
            {members.map((m) => (
              <li key={m.userId} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-ink">
                      {m.name ?? m.email ?? m.userId}
                    </p>
                    <p className="text-[12px] text-ink-muted">
                      {m.email && m.name ? `${m.email} · ` : ''}
                      joined{' '}
                      {new Date(m.joinedAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <label className="sr-only" htmlFor={`org-role-${m.userId}`}>
                      Workspace role
                    </label>
                    <select
                      id={`org-role-${m.userId}`}
                      value={`org:${m.orgRole}`}
                      disabled={busy !== null || m.orgRole === 'owner'}
                      onChange={(e) => void setOrgRole(m.userId, e.target.value)}
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink disabled:opacity-50"
                    >
                      {/* The owner is listed so the select shows the truth, and
                          disabled so this screen cannot orphan a workspace by
                          demoting the only person who can promote anybody. */}
                      <option value="org:owner">Owner</option>
                      {ORG_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3 border-t border-rule pt-3">
                  {m.allBrands ? (
                    <p className="text-[12px] text-ink-muted">
                      <span className="font-medium text-ink">Reaches every brand.</span> Owners and admins
                      administer the whole workspace, so there is nothing to assign.
                    </p>
                  ) : brands.length === 0 ? (
                    <p className="text-[12px] text-ink-muted">No brands to assign yet.</p>
                  ) : (
                    <>
                      <p className="text-[12px] text-ink-muted">Brands this person can open</p>
                      <ul className="mt-2 grid grid-cols-1 gap-1.5">
                        {brands.map((b) => {
                          const assigned = m.brands.find((a) => a.brandId === b.brandId);
                          const key = `brand:${m.userId}:${b.brandId}`;
                          return (
                            <li key={b.brandId} className="flex flex-wrap items-center gap-2">
                              <span className="min-w-[140px] flex-1 truncate text-[13px] text-ink">
                                {b.name || b.brandId}
                              </span>
                              {assigned ? <Badge variant="success">{assigned.role}</Badge> : null}
                              <label className="sr-only" htmlFor={key}>
                                Access to {b.name || b.brandId}
                              </label>
                              <select
                                id={key}
                                value={assigned?.role ?? ''}
                                disabled={busy !== null}
                                onChange={(e) =>
                                  void setBrandAccess(m.userId, b.brandId, e.target.value || undefined)
                                }
                                className="rounded-lg border border-border bg-surface px-2.5 py-1 text-[12px] text-ink disabled:opacity-50"
                              >
                                <option value="">No access</option>
                                {BRAND_ROLES.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
