'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * `genome.consent.grant` / `.revoke` / `.list` — real since P3, unreached from
 * any screen until now. §10: no avatar/voice-cloning format clears the rights
 * guardrail without an active record here.
 *
 * `human_only` on both writes (see `packages/genome/src/consent.ts`'s own
 * comment) — this panel is the human attestation, not a proposal SPARK could
 * make on someone's behalf.
 */

interface ConsentRecord {
  id: string;
  kind: string;
  subject: string;
  evidenceUrl?: string;
  grantedBy: string;
  grantedAt: string;
  revokedBy?: string;
  revokedAt?: string;
}

const KINDS = [
  { value: 'avatar_clone', label: 'Avatar (likeness) clone' },
  { value: 'voice_clone', label: 'Voice clone' },
];

export function ConsentPanel() {
  const [records, setRecords] = useState<ConsentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState(KINDS[0]!.value);
  const [subject, setSubject] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await invoke<{ records: ConsentRecord[] }>('genome.consent.list', {});
    if (res.status === 'succeeded') {
      setRecords(res.output.records);
      setError(null);
    } else {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function grant() {
    if (!subject.trim()) return;
    setBusy(true);
    const res = await invoke<ConsentRecord>(
      'genome.consent.grant',
      {
        kind,
        subject: subject.trim(),
        ...(evidenceUrl.trim() ? { evidenceUrl: evidenceUrl.trim() } : {}),
      },
      // Not idempotent by design (a second grant is a second attestation) —
      // unique per submission, same pattern CalendarBoard's campaign.create
      // uses, so a double-click can't be replayed as a no-op or rejected.
      `consent:${kind}:${subject.trim()}:${Date.now()}`,
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setSubject('');
    setEvidenceUrl('');
    await reload();
  }

  async function revoke(consentId: string) {
    setRevoking(consentId);
    const res = await invoke<ConsentRecord>('genome.consent.revoke', { consentId });
    setRevoking(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    await reload();
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Likeness &amp; voice consent</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        Required before any avatar or voice-clone format can pass the rights guardrail. Recording consent here is an
        attestation by a person on this account — SPARK cannot grant or revoke it.
      </p>

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

      <div className="mt-4 flex min-w-0 flex-wrap items-end gap-3">
        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="consent-kind">
            Type
          </label>
          <select
            id="consent-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 min-w-[200px] flex-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="consent-subject">
            Whose likeness/voice (name)
          </label>
          <input
            id="consent-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Emeka Okafor"
            className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink placeholder:text-ink-placeholder"
          />
        </div>
        <div className="grid grid-cols-1 min-w-[200px] flex-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="consent-evidence">
            Evidence URL (optional)
          </label>
          <input
            id="consent-evidence"
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            placeholder="https://…"
            className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink placeholder:text-ink-placeholder"
          />
        </div>
        <Button size="sm" disabled={busy || !subject.trim()} onClick={() => void grant()}>
          {busy ? 'Recording…' : 'Record consent'}
        </Button>
      </div>

      <div className="mt-5">
        {records === null ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : records.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No consent records yet.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {records.map((r) => {
              const active = !r.revokedAt;
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink">
                      {r.subject}{' '}
                      <span className="text-ink-muted">— {KINDS.find((k) => k.value === r.kind)?.label ?? r.kind}</span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-muted">
                      Granted {new Date(r.grantedAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {r.revokedAt
                        ? ` · Revoked ${new Date(r.revokedAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Revoked'}</Badge>
                    {active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={revoking === r.id}
                        onClick={() => void revoke(r.id)}
                      >
                        {revoking === r.id ? 'Revoking…' : 'Revoke'}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
