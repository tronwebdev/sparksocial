import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { ToolError } from '@sparksocial/shared';
import {
  proposalDecide,
  proposalDraft,
  proposalList,
  proposalShare,
  proposalUpdate,
} from '../src/proposals.js';

/**
 * `proposal.*` — the priced offer.
 *
 * ── What these guard ──────────────────────────────────────────────────────
 *
 *   1. **The arithmetic.** A one-off multiplied by the term is a twelve-fold
 *      overstatement of a contract, and it is the mistake this module exists to
 *      stop. Guarded here at the tool boundary as well as in `shared`, because
 *      the tool is what stores it.
 *   2. **Immutability after sending.** Once a client has seen a price, editing
 *      that record in place would leave the agency unable to say what it
 *      offered. A revised offer is a new proposal.
 *   3. **The share credential.** It leaves the workspace, so it must expire, be
 *      revoked on a decision, and never appear in a list read.
 */

type Status = 'draft' | 'sent' | 'accepted' | 'declined' | 'withdrawn';

interface P {
  id: string;
  orgId: string;
  leadId: string;
  title: string;
  currency: string;
  status: Status;
  termMonths: number;
  lineItems: Array<{ service: string; unitCents: number; quantity: number; recurrence: 'monthly' | 'one_off'; description?: string }>;
  monthlyCents: number;
  oneOffCents: number;
  totalContractCents: number;
  notes?: string;
  shareToken?: string;
  shareExpiresAt?: Date;
  shareRevokedAt?: Date;
  sentAt?: Date;
  decidedAt?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const AT = new Date('2026-09-01T10:00:00Z');

const proposal = (o: Partial<P> = {}): P => ({
  id: 'p1',
  orgId: 'org_1',
  leadId: 'l1',
  title: 'Social media retainer',
  currency: 'USD',
  status: 'draft',
  termMonths: 12,
  lineItems: [{ service: 'content_creation', unitCents: 200_000, quantity: 1, recurrence: 'monthly' }],
  monthlyCents: 200_000,
  oneOffCents: 0,
  totalContractCents: 2_400_000,
  createdBy: 'user_1',
  createdAt: AT,
  updatedAt: AT,
  ...o,
});

function stores(seedProposals: P[] = [], lead: Record<string, unknown> | undefined = { id: 'l1', orgId: 'org_1', businessName: 'Sunnyvale', status: 'qualified' }) {
  const rows = new Map(seedProposals.map((p) => [p.id, { ...p }]));

  return {
    rows,
    db: {
      leads: {
        async get({ orgId, id }: { orgId: string; id: string }) {
          return lead && lead.orgId === orgId && lead.id === id ? lead : undefined;
        },
      },
      proposals: {
        async create(args: Record<string, unknown>) {
          const p = proposal({ ...(args as unknown as P), id: `p${rows.size + 1}`, status: 'draft', createdAt: AT, updatedAt: AT });
          rows.set(p.id, p);
          return p;
        },
        async get({ orgId, id }: { orgId: string; id: string }) {
          const p = rows.get(id);
          return p && p.orgId === orgId ? p : undefined;
        },
        async list({ orgId, leadId, status, limit, offset }: { orgId: string; leadId?: string; status?: Status[]; limit: number; offset: number }) {
          const all = [...rows.values()]
            .filter((p) => p.orgId === orgId)
            .filter((p) => !leadId || p.leadId === leadId)
            .filter((p) => !status?.length || status.includes(p.status));
          return { rows: all.slice(offset, offset + limit), total: all.length };
        },
        async update({ orgId, id, patch }: { orgId: string; id: string; patch: Record<string, unknown> }) {
          const p = rows.get(id);
          if (!p || p.orgId !== orgId) return undefined as never;
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) (p as Record<string, unknown>)[k] = undefined;
            else if (v !== undefined) (p as Record<string, unknown>)[k] = v;
          }
          return p;
        },
        async getByShareToken(token: string) {
          const p = [...rows.values()].find((x) => x.shareToken === token);
          if (!p || p.shareRevokedAt || !p.shareExpiresAt || p.shareExpiresAt.getTime() < Date.now()) return undefined;
          return p;
        },
      },
    },
  };
}

const ctx = (db: unknown, orgId = 'org_1'): ToolCtx =>
  ({
    orgId,
    userId: 'user_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  }) as unknown as ToolCtx;

const RETAINER = { service: 'content_creation' as const, unitCents: 200_000, recurrence: 'monthly' as const };
const SETUP = { service: 'strategy_consulting' as const, unitCents: 50_000, recurrence: 'one_off' as const };

/* ── proposal.draft ────────────────────────────────────────────────── */

describe('proposal.draft', () => {
  it('prices a retainer over its term', async () => {
    const s = stores();
    const out = await proposalDraft.handler(
      proposalDraft.input.parse({ leadId: 'l1', title: 'Retainer', termMonths: 12, lineItems: [RETAINER] }),
      ctx(s.db),
    );
    expect(out.proposal.monthlyCents).toBe(200_000);
    expect(out.proposal.totalContractCents).toBe(2_400_000);
    expect(out.proposal.status).toBe('draft');
  });

  it('does not multiply a one-off by the term', async () => {
    const s = stores();
    const out = await proposalDraft.handler(
      proposalDraft.input.parse({ leadId: 'l1', title: 'Mixed', termMonths: 12, lineItems: [RETAINER, SETUP] }),
      ctx(s.db),
    );
    expect(out.proposal.oneOffCents).toBe(50_000);
    expect(out.proposal.totalContractCents).toBe(200_000 * 12 + 50_000);
  });

  it('explains the total in the terms a reader would check it in', async () => {
    const s = stores();
    const out = await proposalDraft.handler(
      proposalDraft.input.parse({ leadId: 'l1', title: 'Retainer', termMonths: 6, lineItems: [RETAINER] }),
      ctx(s.db),
    );
    expect(out.why.summary).toContain('6 months');
    expect(out.why.factors.map((f) => f.label)).toContain('contract value');
  });

  it('says plainly that it invented no prices', async () => {
    /** A proposal is a contractual offer; a guessed rate would bind the agency. */
    const s = stores();
    const out = await proposalDraft.handler(
      proposalDraft.input.parse({ leadId: 'l1', title: 'Retainer', termMonths: 12, lineItems: [RETAINER] }),
      ctx(s.db),
    );
    expect(out.why.factors.some((f) => f.label === 'prices are yours')).toBe(true);
    expect(out.why.alternatives.some((a) => /invented rate|never chose/.test(a.rejectedBecause))).toBe(true);
  });

  it('404s on a lead that is not in this organisation', async () => {
    const s = stores([], { id: 'l1', orgId: 'org_other', businessName: 'Elsewhere', status: 'new' });
    await expect(
      proposalDraft.handler(
        proposalDraft.input.parse({ leadId: 'l1', title: 'X', termMonths: 12, lineItems: [RETAINER] }),
        ctx(s.db, 'org_1'),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to quote a lead that is already a client', async () => {
    const s = stores([], { id: 'l1', orgId: 'org_1', businessName: 'Sunnyvale', status: 'won', convertedBrandId: 'brand_1' });
    await expect(
      proposalDraft.handler(
        proposalDraft.input.parse({ leadId: 'l1', title: 'X', termMonths: 12, lineItems: [RETAINER] }),
        ctx(s.db),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', meta: { reason: 'lead_is_client' } });
  });

  it('will quote a lost lead, because reopening one is the point of the status', async () => {
    const s = stores([], { id: 'l1', orgId: 'org_1', businessName: 'Second Chance', status: 'lost' });
    const out = await proposalDraft.handler(
      proposalDraft.input.parse({ leadId: 'l1', title: 'Retry', termMonths: 3, lineItems: [RETAINER] }),
      ctx(s.db),
    );
    expect(out.proposal.termMonths).toBe(3);
  });

  it('requires a description on an "other" line, which otherwise says nothing', () => {
    expect(() =>
      proposalDraft.input.parse({
        leadId: 'l1', title: 'X', termMonths: 12,
        lineItems: [{ service: 'other', unitCents: 1000, recurrence: 'monthly' }],
      }),
    ).toThrow();

    expect(
      proposalDraft.input.parse({
        leadId: 'l1', title: 'X', termMonths: 12,
        lineItems: [{ service: 'other', description: 'Podcast editing', unitCents: 1000, recurrence: 'monthly' }],
      }).lineItems,
    ).toHaveLength(1);
  });

  it('refuses a zero-month term, which would erase every recurring line', () => {
    expect(() => proposalDraft.input.parse({ leadId: 'l1', title: 'X', termMonths: 0, lineItems: [RETAINER] })).toThrow();
  });

  it('refuses a proposal with no lines at all', () => {
    expect(() => proposalDraft.input.parse({ leadId: 'l1', title: 'X', termMonths: 12, lineItems: [] })).toThrow();
  });

  it('defaults the currency but accepts any ISO code', () => {
    expect(proposalDraft.input.parse({ leadId: 'l1', title: 'X', termMonths: 12, lineItems: [RETAINER] }).currency).toBe('USD');
    expect(
      proposalDraft.input.parse({ leadId: 'l1', title: 'X', currency: 'NGN', termMonths: 12, lineItems: [RETAINER] }).currency,
    ).toBe('NGN');
  });
});

/* ── proposal.update ──────────────────────────────────────────────── */

describe('proposal.update', () => {
  it('reprices when the term changes, not just when the lines do', async () => {
    const s = stores([proposal()]);
    const out = await proposalUpdate.handler(proposalUpdate.input.parse({ proposalId: 'p1', termMonths: 6 }), ctx(s.db));
    expect(out.proposal.totalContractCents).toBe(200_000 * 6);
  });

  it('reprices when the lines change', async () => {
    const s = stores([proposal()]);
    const out = await proposalUpdate.handler(
      proposalUpdate.input.parse({ proposalId: 'p1', lineItems: [RETAINER, SETUP] }),
      ctx(s.db),
    );
    expect(out.proposal.oneOffCents).toBe(50_000);
    expect(out.proposal.totalContractCents).toBe(200_000 * 12 + 50_000);
  });

  it('refuses to edit a proposal the client has already seen', async () => {
    const s = stores([proposal({ status: 'sent' })]);
    await expect(
      proposalUpdate.handler(proposalUpdate.input.parse({ proposalId: 'p1', termMonths: 6 }), ctx(s.db)),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', meta: { reason: 'not_editable' } });
  });

  it('points at drafting a new one rather than leaving the caller stuck', async () => {
    const s = stores([proposal({ status: 'accepted' })]);
    await expect(
      proposalUpdate.handler(proposalUpdate.input.parse({ proposalId: 'p1', title: 'Sneaky' }), ctx(s.db)),
    ).rejects.toThrow(/Draft a new one/);
  });

  it('refuses a call that changes nothing', () => {
    expect(() => proposalUpdate.input.parse({ proposalId: 'p1' })).toThrow();
  });
});

/* ── proposal.share ───────────────────────────────────────────────── */

describe('proposal.share', () => {
  it('mints a 256-bit token and marks the proposal sent', async () => {
    const s = stores([proposal()]);
    const out = await proposalShare.handler(proposalShare.input.parse({ proposalId: 'p1' }), ctx(s.db));
    expect(out.token).toMatch(/^[0-9a-f]{64}$/);
    expect(out.proposal.status).toBe('sent');
    expect(out.proposal.sentAt).toBeTruthy();
  });

  it('defaults to a fortnight and honours a shorter window', async () => {
    const s = stores([proposal()]);
    const out = await proposalShare.handler(proposalShare.input.parse({ proposalId: 'p1', expiresInDays: 3 }), ctx(s.db));
    const days = (new Date(out.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
  });

  it('caps the window, because the link outlives the deal', () => {
    expect(() => proposalShare.input.parse({ proposalId: 'p1', expiresInDays: 91 })).toThrow();
  });

  it('can share without sending, for a link the agency wants to check first', async () => {
    const s = stores([proposal()]);
    const out = await proposalShare.handler(
      proposalShare.input.parse({ proposalId: 'p1', markSent: false }),
      ctx(s.db),
    );
    expect(out.proposal.status).toBe('draft');
  });

  it('never leaks the token through a list read', async () => {
    const s = stores([proposal()]);
    await proposalShare.handler(proposalShare.input.parse({ proposalId: 'p1' }), ctx(s.db));
    const listed = await proposalList.handler(proposalList.input.parse({}), ctx(s.db));
    expect(JSON.stringify(listed)).not.toContain(s.rows.get('p1')!.shareToken!);
  });

  it('mints a different token every time', async () => {
    const s = stores([proposal(), proposal({ id: 'p2' })]);
    const a = await proposalShare.handler(proposalShare.input.parse({ proposalId: 'p1' }), ctx(s.db));
    const b = await proposalShare.handler(proposalShare.input.parse({ proposalId: 'p2' }), ctx(s.db));
    expect(a.token).not.toBe(b.token);
  });

  it('requires an idempotency key, because each call scatters another live credential', () => {
    expect(proposalShare.idempotent).toBe(false);
  });

  it('refuses to share a settled proposal', async () => {
    const s = stores([proposal({ status: 'accepted' })]);
    await expect(
      proposalShare.handler(proposalShare.input.parse({ proposalId: 'p1' }), ctx(s.db)),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', meta: { reason: 'already_decided' } });
  });

  it('keeps sharing to owner and admin — it is the one act that leaves the workspace', () => {
    expect(proposalShare.scopes).toEqual(['owner', 'admin']);
  });
});

/* ── proposal.decide ─────────────────────────────────────────────── */

describe('proposal.decide', () => {
  it('records an acceptance and says what was won', async () => {
    const s = stores([proposal({ status: 'sent' })]);
    const out = await proposalDecide.handler(
      proposalDecide.input.parse({ proposalId: 'p1', outcome: 'accepted' }),
      ctx(s.db),
    );
    expect(out.proposal.status).toBe('accepted');
    expect(out.why.summary).toContain('USD 24,000.00');
  });

  it('revokes the share link, so a settled offer stops circulating', async () => {
    const s = stores([proposal()]);
    await proposalShare.handler(proposalShare.input.parse({ proposalId: 'p1' }), ctx(s.db));
    const token = s.rows.get('p1')!.shareToken!;
    expect(await s.db.proposals.getByShareToken(token)).toBeTruthy();

    await proposalDecide.handler(proposalDecide.input.parse({ proposalId: 'p1', outcome: 'declined' }), ctx(s.db));
    expect(await s.db.proposals.getByShareToken(token)).toBeUndefined();
  });

  it('refuses to record an answer to something never sent', async () => {
    const s = stores([proposal({ status: 'draft' })]);
    await expect(
      proposalDecide.handler(proposalDecide.input.parse({ proposalId: 'p1', outcome: 'accepted' }), ctx(s.db)),
    ).rejects.toThrow(/has not been sent/);
  });

  it('treats recording the same outcome twice as success', async () => {
    const s = stores([proposal({ status: 'accepted' })]);
    const out = await proposalDecide.handler(
      proposalDecide.input.parse({ proposalId: 'p1', outcome: 'accepted' }),
      ctx(s.db),
    );
    expect(out.why.summary).toContain('Nothing changed');
  });

  it('freezes a decided proposal against a different answer', async () => {
    const s = stores([proposal({ status: 'accepted' })]);
    await expect(
      proposalDecide.handler(proposalDecide.input.parse({ proposalId: 'p1', outcome: 'declined' }), ctx(s.db)),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', meta: { reason: 'bad_transition' } });
  });

  it('points an acceptance at the two calls that turn it into a client', async () => {
    const s = stores([proposal({ status: 'sent' })]);
    const out = await proposalDecide.handler(
      proposalDecide.input.parse({ proposalId: 'p1', outcome: 'accepted' }),
      ctx(s.db),
    );
    expect(out.why.factors.find((f) => f.label === 'next')?.detail).toContain('brand.create');
    expect(out.why.factors.find((f) => f.label === 'next')?.detail).toContain('lead.convert');
  });

  it('does not provision a workspace as a side effect of a price being agreed', async () => {
    const s = stores([proposal({ status: 'sent' })]);
    const out = await proposalDecide.handler(
      proposalDecide.input.parse({ proposalId: 'p1', outcome: 'accepted' }),
      ctx(s.db),
    );
    expect(out.why.alternatives.some((a) => /silently provision/.test(a.rejectedBecause))).toBe(true);
  });
});

/* ── proposal.list ────────────────────────────────────────────────── */

describe('proposal.list', () => {
  it('totals what is out and what has been accepted', async () => {
    const s = stores([
      proposal({ id: 'p1', status: 'sent', totalContractCents: 100_000 }),
      proposal({ id: 'p2', status: 'accepted', totalContractCents: 250_000 }),
      proposal({ id: 'p3', status: 'draft', totalContractCents: 999_000 }),
    ]);
    const out = await proposalList.handler(proposalList.input.parse({}), ctx(s.db));
    expect(out.pipeline.outstandingCents).toBe(100_000);
    expect(out.pipeline.acceptedCents).toBe(250_000);
    expect(out.pipeline.currency).toBe('USD');
  });

  it('refuses to add two currencies together, and says so by omitting the currency', async () => {
    /** Summing NGN into USD would produce a headline figure that means nothing. */
    const s = stores([
      proposal({ id: 'p1', status: 'sent', currency: 'USD', totalContractCents: 100_000 }),
      proposal({ id: 'p2', status: 'sent', currency: 'NGN', totalContractCents: 900_000 }),
    ]);
    const out = await proposalList.handler(proposalList.input.parse({}), ctx(s.db));
    expect(out.pipeline.currency).toBeUndefined();
    expect(out.pipeline.outstandingCents).toBe(0);
    expect(out.proposals).toHaveLength(2);
  });

  it('filters to one lead', async () => {
    const s = stores([proposal({ id: 'p1', leadId: 'l1' }), proposal({ id: 'p2', leadId: 'l2' })]);
    const out = await proposalList.handler(proposalList.input.parse({ leadId: 'l2' }), ctx(s.db));
    expect(out.proposals.map((p) => p.id)).toEqual(['p2']);
  });

  it('returns nothing from another organisation', async () => {
    const s = stores([proposal({ id: 'p1', orgId: 'org_other' })]);
    const out = await proposalList.handler(proposalList.input.parse({}), ctx(s.db, 'org_1'));
    expect(out.proposals).toHaveLength(0);
    expect(out.total).toBe(0);
  });
});

/* ── policy surface ────────────────────────────────────────────────── */

describe('policy surface', () => {
  it('lets a salesperson draft and revise, but not share', () => {
    for (const t of [proposalDraft, proposalUpdate, proposalList, proposalDecide]) {
      expect(t.scopes).toContain('editor');
    }
    expect(proposalShare.scopes).not.toContain('editor');
  });

  it('shuts viewers and clients out of every one', () => {
    for (const t of [proposalDraft, proposalUpdate, proposalList, proposalShare, proposalDecide]) {
      expect(t.scopes).not.toContain('viewer');
      expect(t.scopes).not.toContain('client');
    }
  });

  it('spends nothing and publishes nothing — a share link is not a broadcast', () => {
    for (const t of [proposalDraft, proposalUpdate, proposalList, proposalShare, proposalDecide]) {
      expect(t.effect).not.toBe('spend');
      expect(t.effect).not.toBe('publish');
      expect(t.estimateCents).toBeUndefined();
    }
  });

  it('exposes no send tool, because there is no email transport to back one', async () => {
    /**
     * `proposal.send` would be a lie. If a transport is ever wired, adding it
     * should be a deliberate decision — this failing is what forces that.
     */
    const mod: Record<string, unknown> = await import('../src/proposals.js');
    const names = Object.values(mod)
      .filter((v): v is { name: string } => typeof v === 'object' && v !== null && 'name' in v && 'handler' in v)
      .map((t) => t.name);
    expect(names.sort()).toEqual([
      'proposal.decide', 'proposal.draft', 'proposal.list', 'proposal.share', 'proposal.update',
    ]);
  });
});

describe('errors', () => {
  it('throws ToolError rather than bare strings', async () => {
    const s = stores();
    await expect(
      proposalUpdate.handler(proposalUpdate.input.parse({ proposalId: 'nope', title: 'X' }), ctx(s.db)),
    ).rejects.toBeInstanceOf(ToolError);
  });
});
