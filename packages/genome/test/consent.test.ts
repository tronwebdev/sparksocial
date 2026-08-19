import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { evaluate } from '@sparksocial/tools';
import type { ConsentRecord, ConsentStore, ToolCtx } from '@sparksocial/tools';
import { consentGrant, consentList, consentRevoke } from '../src/consent.js';

/**
 * `genome.consent.*` — the attestation trail behind `rights()`'s `avatarEnabled`.
 *
 * The tests that matter mirror `humanLoop.test.ts`'s shape: the asymmetry
 * between what SPARK may decide (nothing here) and what a person must
 * (everything here), and that the store's "no such record" and "not yours"
 * and "already revoked" outcomes are indistinguishable to the caller.
 */

function store(seed: ConsentRecord[] = []): ConsentStore & { rows: ConsentRecord[] } {
  const rows = [...seed];
  return {
    rows,
    async grant({ genomeId, orgId, kind, subject, evidenceUrl, grantedBy }) {
      const row: ConsentRecord = {
        id: randomUUID(),
        genomeId,
        orgId,
        kind,
        subject,
        grantedBy,
        grantedAt: new Date(),
        ...(evidenceUrl ? { evidenceUrl } : {}),
      };
      rows.push(row);
      return row;
    },
    async revoke({ id, orgId, revokedBy }) {
      const row = rows.find((r) => r.id === id && r.orgId === orgId);
      if (!row || row.revokedAt) return undefined;
      row.revokedBy = revokedBy;
      row.revokedAt = new Date();
      return row;
    },
    async hasActive(genomeId, orgId, kind, subject) {
      const matches = rows
        .filter((r) => r.genomeId === genomeId && r.orgId === orgId && r.kind === kind && (subject === undefined || r.subject === subject))
        .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());
      const newestBySubject = new Map<string, ConsentRecord>();
      for (const r of matches) if (!newestBySubject.has(r.subject)) newestBySubject.set(r.subject, r);
      return [...newestBySubject.values()].some((r) => !r.revokedAt);
    },
    async list(genomeId, orgId) {
      return rows
        .filter((r) => r.genomeId === genomeId && r.orgId === orgId)
        .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());
    },
  };
}

const ctx = (s: ConsentStore, over: Partial<ToolCtx> = {}): ToolCtx =>
  ({
    orgId: 'org_1',
    genomeId: 'gen_1',
    userId: 'user_owner',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: { consent: s } as unknown as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  }) as unknown as ToolCtx;

describe('the registry contract', () => {
  it('grant and revoke are human_only — SPARK does not attest on anyone’s behalf', () => {
    expect(consentGrant.autonomy).toBe('human_only');
    expect(consentRevoke.autonomy).toBe('human_only');
  });

  it('reading the ledger is auto — no attestation happens by looking at it', () => {
    expect(consentList.autonomy).toBe('auto');
  });

  it('stays inside the workspace, so it is write, not external', () => {
    expect(consentGrant.effect).toBe('write');
    expect(consentRevoke.effect).toBe('write');
  });

  it('the policy engine actually denies the agent granting consent', () => {
    const decision = evaluate({
      tool: { name: 'genome.consent.grant', effect: 'write', autonomy: 'human_only', scopes: ['owner', 'admin'] },
      caller: 'agent',
      role: 'owner',
      now: new Date(),
      brand: { createdAt: new Date('2026-01-01T00:00:00Z'), approvalMode: 'autopublish', agentPaused: false },
      budget: { remainingCents: 10_000, estimatedCents: 0 },
    });

    expect(decision.kind).toBe('deny');
    expect(decision.kind === 'deny' && decision.ruleId).toBe('autonomy.human_only');
  });
});

describe('genome.consent.grant', () => {
  it('records who granted it, attributed to the calling user', async () => {
    const s = store();
    const out = await consentGrant.handler({ kind: 'avatar_clone', subject: 'Emeka, owner' }, ctx(s));

    expect(out.grantedBy).toBe('user_owner');
    expect(out.genomeId).toBe('gen_1');
    expect(s.rows[0]!.subject).toBe('Emeka, owner');
  });

  it('requires an attributable person, same as human.answer', async () => {
    await expect(
      consentGrant.handler({ kind: 'avatar_clone', subject: 'Emeka' }, ctx(store(), { userId: undefined })),
    ).rejects.toThrow(ToolError);
  });

  it('needs a genome selected', async () => {
    await expect(
      consentGrant.handler({ kind: 'avatar_clone', subject: 'Emeka' }, ctx(store(), { genomeId: undefined })),
    ).rejects.toThrow(ToolError);
  });

  it('accepts an evidence URL but does not require one', async () => {
    expect(consentGrant.input.safeParse({ kind: 'avatar_clone', subject: 'Emeka' }).success).toBe(true);
    expect(consentGrant.input.safeParse({ kind: 'avatar_clone', subject: 'Emeka', evidenceUrl: 'not a url' }).success).toBe(false);
  });
});

describe('genome.consent.revoke', () => {
  it('turns the record inactive', async () => {
    const s = store();
    const granted = await consentGrant.handler({ kind: 'avatar_clone', subject: 'Emeka' }, ctx(s));

    const out = await consentRevoke.handler({ consentId: granted.id }, ctx(s));
    expect(out.revokedBy).toBe('user_owner');
    expect(s.rows[0]!.revokedAt).toBeInstanceOf(Date);
  });

  it('treats an unknown id and an already-revoked id identically', async () => {
    const s = store();
    const granted = await consentGrant.handler({ kind: 'avatar_clone', subject: 'Emeka' }, ctx(s));
    await consentRevoke.handler({ consentId: granted.id }, ctx(s));

    await expect(consentRevoke.handler({ consentId: granted.id }, ctx(s))).rejects.toThrow(ToolError);
    await expect(consentRevoke.handler({ consentId: 'nope' }, ctx(s))).rejects.toThrow(ToolError);
  });

  it('requires an attributable person', async () => {
    const s = store();
    const granted = await consentGrant.handler({ kind: 'avatar_clone', subject: 'Emeka' }, ctx(s));

    await expect(
      consentRevoke.handler({ consentId: granted.id }, ctx(s, { userId: undefined })),
    ).rejects.toThrow(ToolError);
  });
});

describe('genome.consent.list', () => {
  it('reads back everything on file for the selected genome', async () => {
    const s = store();
    await consentGrant.handler({ kind: 'avatar_clone', subject: 'Emeka' }, ctx(s));
    await consentGrant.handler({ kind: 'voice_clone', subject: 'Emeka' }, ctx(s));

    const out = await consentList.handler({}, ctx(s));
    expect(out.records).toHaveLength(2);
  });

  it('needs a genome selected', async () => {
    await expect(consentList.handler({}, ctx(store(), { genomeId: undefined }))).rejects.toThrow(ToolError);
  });
});
