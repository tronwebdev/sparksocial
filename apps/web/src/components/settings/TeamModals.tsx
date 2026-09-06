'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';

/**
 * `Settings WS Add Member`, `… Add Client` and `… Edit Group` — the three
 * screens the Team section opens over itself.
 *
 * They are modals rather than routes because that is what the prototype draws:
 * each one renders the Groups screen behind it, unchanged, with the form laid
 * over the middle.
 *
 * Measured off the prototype, all in stage coordinates:
 *
 *   fields      two columns at x488 and x854 (a 366 pitch), each 346 wide;
 *               full-width rows 712. Every field is a 63-tall r10 white box
 *               under an 18/500 label, the label 31 above it
 *   role chip   a 332x49 r8.202 tile inside the Role field, tinted 10% of the
 *               role's own hue — `rgba(38,84,235,0.1)` for Admin,
 *               `rgba(23,219,131,0.1)` for Client
 *   footer      Cancel 168x44 transparent at x671, the primary 167x43 r8.457
 *               white at x851 — 45px apart
 *   Add Client  adds a dashed r10 711x290 box holding an Offer amount (189x63)
 *               and a payment link (656x63)
 *   Edit Group  capability chips 33 tall r6.208 on `rgba(131,131,131,0.1)` at
 *               14/500; an "Add Team Members" 535x63 picker; member pills 49
 *               tall r1000 on `rgba(131,131,131,0.15)` with a 40px avatar
 *
 * ── What each one actually writes ─────────────────────────────────────────
 *
 * Add Member is `team.invite` — a real invitation email through Clerk, which
 * takes an address and a role and nothing else. Add Client is `brand.create`,
 * which provisions a brand and its empty genome. Edit Group is
 * `team.group.update` for the name and capabilities and `team.group.member.set`
 * per member added or removed.
 *
 * Three of the design's fields have no field behind them, and are shown
 * disabled with the reason rather than silently discarding what is typed:
 * first and last name (the person supplies those when they accept the
 * invitation — Clerk's invitation carries an address only), the group on the
 * invite form (a group membership needs a user id, which does not exist until
 * the invitation is accepted), and the client's offer and payment link (no
 * tool stores either against a brand).
 */

const FIELD = 'h-[63px] rounded-[10px] bg-white';
const FIELD_RING = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' } as const;

const ROLE_HUE: Record<string, string> = {
  owner: 'var(--ss-set-role-owner)',
  admin: 'var(--ss-set-role-admin)',
  editor: 'var(--ss-set-role-editor)',
  approver: 'var(--ss-set-role-approver)',
  viewer: 'var(--ss-set-role-viewer)',
  client: 'var(--ss-set-role-client)',
};

/** The shared shell: a scrim, a centred card, and the design's footer pair. */
function TeamModal({
  title,
  onClose,
  onSubmit,
  submitLabel,
  busy,
  error,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto px-4 py-[6vh]" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ background: 'rgba(12,12,12,0.28)', backdropFilter: 'blur(6px)' }}
      />

      <div
        className="relative w-[760px] max-w-full rounded-[20px] bg-set-card px-[48px] pb-[34px] pt-[30px]"
        style={{ boxShadow: '0 40px 90px -40px rgba(12,12,12,0.5)' }}
      >
        <h2 className="text-[24px] font-semibold leading-[1.25] text-ink">{title}</h2>

        <div className="mt-[24px]">{children}</div>

        {error ? <p className="mt-[16px] text-16 text-destructive">{error}</p> : null}

        <div className="mt-[30px] flex flex-wrap items-center justify-center gap-[12px]">
          <button
            type="button"
            onClick={onClose}
            className="h-[44px] w-[168px] rounded-[8.457px] text-[16.915px] font-medium transition-colors hover:bg-white/60"
            style={{ color: 'rgb(131,131,131)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="h-[43px] w-[167px] rounded-[8.457px] bg-white text-[16.915px] font-medium text-ink transition-shadow disabled:opacity-60"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
          >
            {busy ? 'Working…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** An 18/500 label over a 63-tall r10 box, at the design's 346 or 712 width. */
function ModalField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-18 font-medium text-ink">{label}</label>
      <div className={cn('mt-[8px] flex items-center px-[24px]', FIELD)} style={FIELD_RING}>
        {children}
      </div>
      {hint ? (
        <p className="mt-[7px] text-[15px] leading-[1.35]" style={{ color: 'rgb(131,131,131)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ── Add Member ──────────────────────────────────────────────────────── */

export function AddMemberModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim()) {
      setError('An email address is required — the invitation is sent to it.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await invoke<{ invitationId: string; status: string }>(
      'team.invite',
      { email: email.trim(), role },
      // Not idempotent: a retry sends a second email.
      crypto.randomUUID(),
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Inviting someone needs an approval.');
      return;
    }
    onDone();
    onClose();
  }

  return (
    <TeamModal title="Add New User" onClose={onClose} onSubmit={() => void submit()} submitLabel="+ Add member" busy={busy} error={error}>
      <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2">
        <ModalField label="First Name" hint="Collected when the invitation is accepted.">
          <input disabled placeholder="—" className="w-full bg-transparent text-18 font-medium outline-none" style={{ color: 'rgb(131,131,131)' }} />
        </ModalField>
        <ModalField label="Last Name" hint="Collected when the invitation is accepted.">
          <input disabled placeholder="—" className="w-full bg-transparent text-18 font-medium outline-none" style={{ color: 'rgb(131,131,131)' }} />
        </ModalField>

        <ModalField label="Email Address" className="sm:col-span-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoFocus
            placeholder="name@example.com"
            aria-label="Email address"
            className="w-full bg-transparent text-18 font-medium text-ink outline-none"
          />
        </ModalField>

        <RoleField value={role} onChange={setRole} />

        <ModalField
          label="Add to Group (optional)"
          hint="A group membership needs an account, which exists only once the invitation is accepted. Add them from Groups afterwards."
        >
          <span className="text-18 font-medium" style={{ color: 'rgb(131,131,131)' }}>
            Not yet available
          </span>
        </ModalField>
      </div>
    </TeamModal>
  );
}

/** The design's Role field: a tinted 332x49 r8.202 tile inside the 63-tall box. */
function RoleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hue = ROLE_HUE[value] ?? 'var(--ss-set-role-viewer)';
  return (
    <div>
      <label className="block text-18 font-medium text-ink">Role</label>
      <div className={cn('mt-[8px] flex items-center px-[7px]', FIELD)} style={FIELD_RING}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Role"
          className="h-[49px] w-full cursor-pointer appearance-none rounded-[8.202px] px-[16px] text-18 font-medium outline-none"
          style={{ background: `color-mix(in srgb, ${hue} 10%, transparent)`, color: hue }}
        >
          {['owner', 'admin', 'editor', 'approver', 'viewer', 'client'].map((r) => (
            <option key={r} value={r} style={{ color: '#0C0C0C' }}>
              {r[0]!.toUpperCase() + r.slice(1)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ── Add Client ──────────────────────────────────────────────────────── */

export function AddClientModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [oneLiner, setOneLiner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !category.trim()) {
      setError('A client needs a name and a category — onboarding fills in the rest.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await invoke<{ brandId: string; genomeId: string; name: string }>(
      'brand.create',
      { name: name.trim(), category: category.trim(), ...(oneLiner.trim() ? { oneLiner: oneLiner.trim() } : {}) },
      crypto.randomUUID(),
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Adding a client needs an approval.');
      return;
    }
    onDone();
    onClose();
  }

  return (
    <TeamModal title="Add Client" onClose={onClose} onSubmit={() => void submit()} submitLabel="+ Add Client" busy={busy} error={error}>
      <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2">
        <ModalField label="Client name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={120}
            aria-label="Client name"
            className="w-full bg-transparent text-18 font-medium text-ink outline-none"
          />
        </ModalField>

        <ModalField label="Category" hint="A label only — routing is by genome dimensions, never by category.">
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={80}
            placeholder="Barbershop, dental clinic, SaaS…"
            aria-label="Category"
            className="w-full bg-transparent text-18 font-medium text-ink outline-none"
          />
        </ModalField>

        <ModalField label="One-liner (optional)" className="sm:col-span-2">
          <input
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
            maxLength={280}
            placeholder="What this client does, in one sentence."
            aria-label="One-liner"
            className="w-full bg-transparent text-18 font-medium text-ink outline-none"
          />
        </ModalField>
      </div>

      {/*
        The design's dashed 711x290 billing box. Neither field has anywhere to
        go — no tool stores an offer amount or a payment link against a brand —
        so it says so rather than collecting a Stripe URL that vanishes.
      */}
      <div
        className="mt-[22px] rounded-[10px] p-[24px]"
        style={{ border: '1px dashed rgba(131,131,131,0.45)' }}
      >
        <p className="text-18 font-medium text-ink">Offer and payment link</p>
        <p className="mt-[8px] max-w-[600px] text-16 leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
          The design collects an amount and a checkout link here. Nothing in the registry stores either
          against a brand yet, so this is left out rather than taking a payment URL that would be
          discarded. Billing lives under the organisation.
        </p>
      </div>

      <p className="mt-[16px] text-16" style={{ color: 'rgb(131,131,131)' }}>
        This provisions the brand and its empty genome. The five-question onboarding fills it in.
      </p>
    </TeamModal>
  );
}

/* ── Edit Group ──────────────────────────────────────────────────────── */

const CAPABILITIES = [
  { value: 'publish', label: 'Publish' },
  { value: 'spend_credits', label: 'Spend credits' },
  { value: 'manage_brand', label: 'Manage Brand' },
  { value: 'approve', label: 'Approve' },
] as const;

export interface EditableGroup {
  groupId: string;
  name: string;
  capabilities: string[];
  members: string[];
}

export function EditGroupModal({
  group,
  people,
  onClose,
  onDone,
}: {
  /** Null creates a new group — the design's "Create Group". */
  group: EditableGroup | null;
  people: Array<{ userId: string; name?: string; email?: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [caps, setCaps] = useState<string[]>(group?.capabilities ?? []);
  const [members, setMembers] = useState<string[]>(group?.members ?? []);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = (id: string) => {
    const p = people.find((x) => x.userId === id);
    return p?.name || p?.email || id.slice(0, 8);
  };

  async function submit() {
    if (!name.trim()) {
      setError('A group needs a name.');
      return;
    }
    setBusy(true);
    setError(null);

    if (!group) {
      const res = await invoke<{ id: string }>(
        'team.group.create',
        { name: name.trim(), capabilities: caps, members },
        crypto.randomUUID(),
      );
      setBusy(false);
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'Creating a group needs an approval.');
        return;
      }
      onDone();
      onClose();
      return;
    }

    const updated = await invoke('team.group.update', {
      groupId: group.groupId,
      name: name.trim(),
      capabilities: caps,
    });
    if (updated.status !== 'succeeded') {
      setBusy(false);
      setError(updated.status === 'failed' ? updated.error.message : 'Updating this group needs an approval.');
      return;
    }

    /* Membership is its own tool, one call per change — so only what actually
       changed is written, and a failure names the person it failed on. */
    const added = members.filter((m) => !group.members.includes(m));
    const removed = group.members.filter((m) => !members.includes(m));
    for (const userId of [...added, ...removed]) {
      const res = await invoke('team.group.member.set', {
        groupId: group.groupId,
        userId,
        member: added.includes(userId),
      });
      if (res.status !== 'succeeded') {
        setBusy(false);
        setError(
          res.status === 'failed'
            ? `${label(userId)}: ${res.error.message}`
            : `Changing membership for ${label(userId)} needs an approval.`,
        );
        return;
      }
    }

    setBusy(false);
    onDone();
    onClose();
  }

  const available = people.filter((p) => !members.includes(p.userId));

  return (
    <TeamModal
      title={group ? 'Edit Group' : 'Create Group'}
      onClose={onClose}
      onSubmit={() => void submit()}
      submitLabel={group ? 'Save Changes' : 'Create Group'}
      busy={busy}
      error={error}
    >
      <ModalField label="Group name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={80}
          aria-label="Group name"
          className="w-full bg-transparent text-18 font-medium text-ink outline-none"
        />
      </ModalField>

      {/* The design's capability chips — 33 tall, r6.208, 14/500. */}
      <p className="mt-[22px] text-18 font-medium text-ink">Capabilities</p>
      <div className="mt-[10px] flex flex-wrap gap-[8px]">
        {CAPABILITIES.map((c) => {
          const on = caps.includes(c.value);
          return (
            <button
              key={c.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => setCaps((s) => (on ? s.filter((x) => x !== c.value) : [...s, c.value]))}
              className="h-[33px] rounded-[6.208px] px-[9px] text-14 font-medium transition-colors"
              style={{
                background: on ? 'var(--ss-cyan)' : 'rgba(131,131,131,0.1)',
                color: on ? 'var(--ss-ink-900)' : 'rgb(131,131,131)',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <p className="mt-[8px] text-16" style={{ color: 'rgb(131,131,131)' }}>
        A group only ever widens what its members may do — removing one cannot lock anybody out.
      </p>

      {/* Add Team Members — the design's 535x63 picker over the member pills. */}
      <div className="mt-[22px]">
        <label className="block text-18 font-medium text-ink" htmlFor="grp-add">
          Add Team Members
        </label>
        <div className={cn('mt-[8px] flex items-center px-[14px]', FIELD)} style={FIELD_RING}>
          <select
            id="grp-add"
            value={pick}
            onChange={(e) => {
              if (e.target.value) setMembers((s) => [...s, e.target.value]);
              setPick('');
            }}
            disabled={available.length === 0}
            className="h-full w-full cursor-pointer appearance-none bg-transparent text-18 font-medium text-ink outline-none"
          >
            <option value="">{available.length === 0 ? 'Everyone is already in this group' : 'Choose someone…'}</option>
            {available.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name || p.email || p.userId.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {members.length > 0 ? (
        <ul className="mt-[16px] flex flex-wrap gap-[9px]">
          {members.map((id) => (
            <li
              key={id}
              className="flex h-[49px] items-center gap-[13px] rounded-full pl-[8px] pr-[16px]"
              style={{ background: 'rgba(131,131,131,0.15)' }}
            >
              <span aria-hidden className="block h-[40px] w-[40px] rounded-full" style={{ background: 'rgba(131,131,131,0.35)' }} />
              <span className="text-16 font-medium text-ink">{label(id)}</span>
              <button
                type="button"
                onClick={() => setMembers((s) => s.filter((x) => x !== id))}
                aria-label={`Remove ${label(id)}`}
                className="text-[15px] leading-none transition-colors hover:text-ink"
                style={{ color: 'rgb(131,131,131)' }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-[14px] text-16" style={{ color: 'rgb(131,131,131)' }}>
          Nobody in this group yet.
        </p>
      )}
    </TeamModal>
  );
}
