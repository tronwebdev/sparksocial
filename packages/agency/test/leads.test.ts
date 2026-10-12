import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { ToolError } from '@sparksocial/shared';
import { leadDedupeKey } from '@sparksocial/shared/agencyPipeline';
import { leadConvert, leadCreate, leadImport, leadList, leadUpdate } from '../src/leads.js';

/**
 * `lead.*` — the agency's own pipeline.
 *
 * ── What these guard ──────────────────────────────────────────────────────
 *
 * Three things, in order of what would hurt most if they broke:
 *
 *   1. **Dedupe.** An agency re-importing last month's sheet must not double
 *      its pipeline, and must be *told* what was skipped — a silent drop reads
 *      as a failed import and gets retried.
 *   2. **The won-lead lock.** A won lead has a client workspace attached.
 *      Moving it would leave a brand whose own lead says it was never sold.
 *   3. **Org scope.** Every read and write filters on the caller's org. A
 *      pipeline is commercially sensitive in a way a brand's post schedule is
 *      not.
 *
 * Not the arithmetic of `leadDedupeKey` — that is `packages/shared`'s test.
 */

interface Row {
  id: string;
  orgId: string;
  businessName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  location?: string;
  status: 'new' | 'contacted' | 'qualified' | 'won' | 'lost';
  source: 'manual' | 'import' | 'referral' | 'inbound';
  dedupeKey: string;
  convertedBrandId?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const AT = new Date('2026-09-01T10:00:00Z');

function row(o: Partial<Row> & { businessName: string }): Row {
  return {
    id: o.id ?? `lead_${o.businessName.toLowerCase().replace(/\W/g, '')}`,
    orgId: o.orgId ?? 'org_1',
    status: 'new',
    source: 'manual',
    createdBy: 'user_1',
    createdAt: AT,
    updatedAt: AT,
    dedupeKey: leadDedupeKey(o),
    ...o,
  };
}

/** An in-memory `leads` store with the semantics the real repository has. */
function store(seed: Row[] = []) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  const calls: string[] = [];

  return {
    rows,
    calls,
    api: {
      async create(args: Record<string, unknown>) {
        calls.push('create');
        const r = row({ ...(args as unknown as Row), id: `lead_${rows.size + 1}` });
        rows.set(r.id, r);
        return r;
      },
      async importMany({ orgId, source, createdBy, rows: incoming }: {
        orgId: string; source: Row['source']; createdBy: string;
        rows: Array<{ businessName: string; dedupeKey: string }>;
      }) {
        calls.push('importMany');
        const inserted: Row[] = [];
        const skippedKeys: string[] = [];
        for (const r of incoming) {
          if ([...rows.values()].some((x) => x.orgId === orgId && x.dedupeKey === r.dedupeKey)) {
            skippedKeys.push(r.dedupeKey);
            continue;
          }
          const made = row({ ...(r as unknown as Row), orgId, source, createdBy, id: `lead_${rows.size + 1}`, dedupeKey: r.dedupeKey });
          rows.set(made.id, made);
          inserted.push(made);
        }
        return { inserted, skippedKeys };
      },
      async get({ orgId, id }: { orgId: string; id: string }) {
        const r = rows.get(id);
        return r && r.orgId === orgId ? r : undefined;
      },
      async getByDedupeKey({ orgId, dedupeKey }: { orgId: string; dedupeKey: string }) {
        return [...rows.values()].find((r) => r.orgId === orgId && r.dedupeKey === dedupeKey);
      },
      async list({ orgId, status, search, limit, offset }: {
        orgId: string; status?: Row['status'][]; search?: string; limit: number; offset: number;
      }) {
        calls.push('list');
        const term = search?.toLowerCase();
        const all = [...rows.values()]
          .filter((r) => r.orgId === orgId)
          .filter((r) => !status?.length || status.includes(r.status))
          .filter((r) => !term || r.businessName.toLowerCase().includes(term));
        return { rows: all.slice(offset, offset + limit), total: all.length };
      },
      async countsByStatus(orgId: string) {
        const out = { new: 0, contacted: 0, qualified: 0, won: 0, lost: 0 };
        for (const r of rows.values()) if (r.orgId === orgId) out[r.status] += 1;
        return out;
      },
      async update({ orgId, id, patch }: { orgId: string; id: string; patch: Record<string, unknown> }) {
        const r = rows.get(id);
        if (!r || r.orgId !== orgId) return undefined as never;
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) (r as Record<string, unknown>)[k] = v;
        return r;
      },
    },
  };
}

function ctx(
  leads: ReturnType<typeof store>['api'],
  opts: { orgId?: string; role?: string; brands?: Array<{ id: string; brandId: string; name: string }> } = {},
): ToolCtx {
  return {
    orgId: opts.orgId ?? 'org_1',
    userId: 'user_1',
    role: opts.role ?? 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      leads,
      genomes: { listForOrg: async () => opts.brands ?? [] },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

/* ── lead.create ───────────────────────────────────────────────────── */

describe('lead.create', () => {
  it('adds a lead and defaults it to the start of the pipeline', async () => {
    const s = store();
    const out = await leadCreate.handler(
      leadCreate.input.parse({ businessName: 'Sunnyvale Innovations', email: 'hi@sunnyvale.test' }),
      ctx(s.api),
    );
    expect(out.lead.businessName).toBe('Sunnyvale Innovations');
    expect(out.lead.status).toBe('new');
    expect(out.lead.source).toBe('manual');
  });

  it('refuses a business already in the pipeline, and names it', async () => {
    const s = store([row({ businessName: 'Sunnyvale Innovations', email: 'hi@sunnyvale.test' })]);
    await expect(
      leadCreate.handler(
        leadCreate.input.parse({ businessName: 'Sunnyvale (new contact)', email: 'HI@SUNNYVALE.TEST' }),
        ctx(s.api),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', meta: { reason: 'duplicate' } });
  });

  it('lowercases the email so the same address in two cases is one lead', async () => {
    const s = store();
    const out = await leadCreate.handler(
      leadCreate.input.parse({ businessName: 'Case Test', email: 'Mixed@Case.TEST' }),
      ctx(s.api),
    );
    expect(out.lead.email).toBe('mixed@case.test');
  });

  it('rejects a business name that is only whitespace', () => {
    expect(() => leadCreate.input.parse({ businessName: '   ' })).toThrow();
  });

  it('does not see another organisation’s leads when checking for duplicates', async () => {
    /** The same business sold by two agencies is two pipelines, not a conflict. */
    const s = store([row({ businessName: 'Shared Prospect', email: 'x@y.test', orgId: 'org_other' })]);
    const out = await leadCreate.handler(
      leadCreate.input.parse({ businessName: 'Shared Prospect', email: 'x@y.test' }),
      ctx(s.api, { orgId: 'org_1' }),
    );
    expect(out.lead.id).toBeTruthy();
  });
});

/* ── lead.import ───────────────────────────────────────────────────── */

describe('lead.import', () => {
  it('imports a sheet and explains what landed', async () => {
    const s = store();
    const out = await leadImport.handler(
      leadImport.input.parse({
        rows: [
          { businessName: 'Alpha', email: 'a@a.test' },
          { businessName: 'Beta', email: 'b@b.test' },
        ],
      }),
      ctx(s.api),
    );
    expect(out.imported).toBe(2);
    expect(out.duplicatesSkipped).toBe(0);
    expect(out.why.summary).toContain('2 of 2');
  });

  it('skips rows already in the pipeline and says how many, so a re-run is legible', async () => {
    const s = store([row({ businessName: 'Alpha', email: 'a@a.test' })]);
    const out = await leadImport.handler(
      leadImport.input.parse({
        rows: [
          { businessName: 'Alpha', email: 'a@a.test' },
          { businessName: 'Beta', email: 'b@b.test' },
        ],
      }),
      ctx(s.api),
    );
    expect(out.imported).toBe(1);
    expect(out.duplicatesSkipped).toBe(1);
    expect(out.why.summary).toContain('already in the pipeline');
  });

  it('is safe to run twice — the second run adds nothing', async () => {
    const s = store();
    const input = leadImport.input.parse({ rows: [{ businessName: 'Alpha', email: 'a@a.test' }] });
    await leadImport.handler(input, ctx(s.api));
    const second = await leadImport.handler(input, ctx(s.api));
    expect(second.imported).toBe(0);
    expect(second.duplicatesSkipped).toBe(1);
    expect(s.rows.size).toBe(1);
  });

  it('reports a repeat inside one file separately from an existing duplicate', async () => {
    /**
     * These are different facts. "Your sheet repeats itself" is a data-quality
     * note; "these are already here" is the re-import case. Collapsing them
     * makes both unactionable.
     */
    const s = store();
    const out = await leadImport.handler(
      leadImport.input.parse({
        rows: [
          { businessName: 'Alpha', email: 'a@a.test' },
          { businessName: 'Alpha again', email: 'A@A.TEST' },
        ],
      }),
      ctx(s.api),
    );
    expect(out.imported).toBe(1);
    expect(out.duplicatesWithinUpload).toBe(1);
    expect(out.duplicatesSkipped).toBe(0);
    expect(out.why.summary).toContain('repeated within the file');
  });

  it('keeps the first of two identical rows, which is the one the preview showed', async () => {
    const s = store();
    await leadImport.handler(
      leadImport.input.parse({
        rows: [
          { businessName: 'First Seen', email: 'dup@x.test' },
          { businessName: 'Second Seen', email: 'dup@x.test' },
        ],
      }),
      ctx(s.api),
    );
    expect([...s.rows.values()][0]!.businessName).toBe('First Seen');
  });

  it('sends one bulk write rather than a call per row', async () => {
    /** A 2,000-row sheet as 2,000 round trips is a timeout, not an import. */
    const s = store();
    await leadImport.handler(
      leadImport.input.parse({ rows: Array.from({ length: 50 }, (_, i) => ({ businessName: `Biz ${i}` })) }),
      ctx(s.api),
    );
    expect(s.calls.filter((c) => c === 'importMany')).toHaveLength(1);
    expect(s.calls).not.toContain('create');
  });

  it('requires an idempotency key, because a silent re-run is indistinguishable from a failure', () => {
    expect(leadImport.idempotent).toBe(false);
  });

  it('caps a single upload so an oversized sheet is paged rather than timed out', () => {
    expect(() =>
      leadImport.input.parse({ rows: Array.from({ length: 2001 }, (_, i) => ({ businessName: `B${i}` })) }),
    ).toThrow();
  });
});

/* ── lead.list ─────────────────────────────────────────────────────── */

describe('lead.list', () => {
  const seeded = () =>
    store([
      row({ businessName: 'Alpha', email: 'a@a.test', status: 'new' }),
      row({ businessName: 'Beta', email: 'b@b.test', status: 'qualified' }),
      row({ businessName: 'Gamma', email: 'g@g.test', status: 'won' }),
      row({ businessName: 'Elsewhere', email: 'e@e.test', orgId: 'org_other' }),
    ]);

  it('returns only this organisation’s pipeline', async () => {
    const out = await leadList.handler(leadList.input.parse({}), ctx(seeded().api));
    expect(out.leads.map((l) => l.businessName).sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('filters by stage, and the total matches the filter rather than the whole pipeline', async () => {
    const out = await leadList.handler(leadList.input.parse({ status: ['qualified'] }), ctx(seeded().api));
    expect(out.leads).toHaveLength(1);
    expect(out.total).toBe(1);
  });

  it('counts every stage including the empty ones, so a header need not guess', async () => {
    const out = await leadList.handler(leadList.input.parse({}), ctx(seeded().api));
    expect(out.counts).toEqual({ new: 1, contacted: 0, qualified: 1, won: 1, lost: 0 });
  });

  it('keeps the stage counts whole-pipeline even when the rows are filtered', async () => {
    /** The header answers "where is everything", the table answers the filter. */
    const out = await leadList.handler(leadList.input.parse({ status: ['new'] }), ctx(seeded().api));
    expect(out.leads).toHaveLength(1);
    expect(out.counts.won).toBe(1);
  });

  it('searches by name', async () => {
    const out = await leadList.handler(leadList.input.parse({ search: 'bet' }), ctx(seeded().api));
    expect(out.leads.map((l) => l.businessName)).toEqual(['Beta']);
  });
});

/* ── lead.update ───────────────────────────────────────────────────── */

describe('lead.update', () => {
  it('moves a lead along the pipeline', async () => {
    const s = store([row({ businessName: 'Alpha', email: 'a@a.test' })]);
    const id = [...s.rows.keys()][0]!;
    const out = await leadUpdate.handler(leadUpdate.input.parse({ leadId: id, status: 'contacted' }), ctx(s.api));
    expect(out.lead.status).toBe('contacted');
  });

  it('refuses to move a won lead, because a client workspace depends on it', async () => {
    const s = store([row({ businessName: 'Gamma', email: 'g@g.test', status: 'won', convertedBrandId: 'brand_1' })]);
    const id = [...s.rows.keys()][0]!;
    await expect(
      leadUpdate.handler(leadUpdate.input.parse({ leadId: id, status: 'contacted' }), ctx(s.api)),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', meta: { reason: 'bad_transition' } });
  });

  it('explains the won case in terms of the workspace rather than the state machine', async () => {
    const s = store([row({ businessName: 'Gamma', status: 'won' })]);
    const id = [...s.rows.keys()][0]!;
    await expect(
      leadUpdate.handler(leadUpdate.input.parse({ leadId: id, status: 'lost' }), ctx(s.api)),
    ).rejects.toThrow(/client workspace was created/);
  });

  it('lets a lost lead be reopened', async () => {
    const s = store([row({ businessName: 'Alpha', status: 'lost' })]);
    const id = [...s.rows.keys()][0]!;
    const out = await leadUpdate.handler(leadUpdate.input.parse({ leadId: id, status: 'contacted' }), ctx(s.api));
    expect(out.lead.status).toBe('contacted');
  });

  it('recomputes the dedupe key when an identifying field is corrected', async () => {
    const s = store([row({ businessName: 'Typo Co', email: 'wrong@x.test' })]);
    const id = [...s.rows.keys()][0]!;
    await leadUpdate.handler(leadUpdate.input.parse({ leadId: id, email: 'right@x.test' }), ctx(s.api));
    expect(s.rows.get(id)!.dedupeKey).toBe('email:right@x.test');
  });

  it('refuses a correction that would collide with another lead', async () => {
    const s = store([
      row({ id: 'l1', businessName: 'One', email: 'one@x.test' }),
      row({ id: 'l2', businessName: 'Two', email: 'two@x.test' }),
    ]);
    await expect(
      leadUpdate.handler(leadUpdate.input.parse({ leadId: 'l2', email: 'one@x.test' }), ctx(s.api)),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', meta: { reason: 'duplicate' } });
  });

  it('leaves the dedupe key alone on a notes-only edit', async () => {
    const s = store([row({ businessName: 'Alpha', email: 'a@a.test' })]);
    const id = [...s.rows.keys()][0]!;
    const before = s.rows.get(id)!.dedupeKey;
    await leadUpdate.handler(leadUpdate.input.parse({ leadId: id, notes: 'Called Tuesday.' }), ctx(s.api));
    expect(s.rows.get(id)!.dedupeKey).toBe(before);
  });

  it('404s on a lead belonging to another organisation', async () => {
    const s = store([row({ id: 'l1', businessName: 'Elsewhere', orgId: 'org_other' })]);
    await expect(
      leadUpdate.handler(leadUpdate.input.parse({ leadId: 'l1', status: 'contacted' }), ctx(s.api, { orgId: 'org_1' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a call that changes nothing', () => {
    expect(() => leadUpdate.input.parse({ leadId: 'l1' })).toThrow();
  });
});

/* ── lead.convert ──────────────────────────────────────────────────── */

const BRANDS = [{ id: 'gen_1', brandId: 'brand_1', name: 'Sunnyvale' }];

describe('lead.convert', () => {
  it('marks the lead won and links the workspace', async () => {
    const s = store([row({ id: 'l1', businessName: 'Sunnyvale Innovations', status: 'qualified' })]);
    const out = await leadConvert.handler(
      leadConvert.input.parse({ leadId: 'l1', brandId: 'brand_1' }),
      ctx(s.api, { brands: BRANDS }),
    );
    expect(out.lead.status).toBe('won');
    expect(out.lead.convertedBrandId).toBe('brand_1');
    expect(out.why.summary).toContain('Sunnyvale');
  });

  it('refuses a brand that is not in this organisation', async () => {
    /** A lead pointing at a mistyped brand reports a win nobody can open. */
    const s = store([row({ id: 'l1', businessName: 'Alpha', status: 'qualified' })]);
    await expect(
      leadConvert.handler(leadConvert.input.parse({ leadId: 'l1', brandId: 'brand_nope' }), ctx(s.api, { brands: BRANDS })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('treats a repeat of the same conversion as success', async () => {
    const s = store([row({ id: 'l1', businessName: 'Alpha', status: 'won', convertedBrandId: 'brand_1' })]);
    const out = await leadConvert.handler(
      leadConvert.input.parse({ leadId: 'l1', brandId: 'brand_1' }),
      ctx(s.api, { brands: BRANDS }),
    );
    expect(out.lead.status).toBe('won');
    expect(out.why.summary).toContain('Nothing changed');
  });

  it('refuses to re-point a won lead at a different workspace', async () => {
    const s = store([row({ id: 'l1', businessName: 'Alpha', status: 'won', convertedBrandId: 'brand_other' })]);
    await expect(
      leadConvert.handler(leadConvert.input.parse({ leadId: 'l1', brandId: 'brand_1' }), ctx(s.api, { brands: BRANDS })),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', meta: { reason: 'already_converted' } });
  });

  it('does not create the brand itself, so that call keeps its own audit entry', async () => {
    expect(leadConvert.input.safeParse({ leadId: 'l1' }).success).toBe(false);
  });
});

/* ── policy surface ────────────────────────────────────────────────── */

describe('policy surface', () => {
  it('lets a salesperson work the pipeline without administering the workspace', () => {
    for (const t of [leadCreate, leadImport, leadList, leadUpdate]) {
      expect(t.scopes).toContain('editor');
    }
  });

  it('keeps conversion to owner and admin, because it attaches a billable workspace', () => {
    expect(leadConvert.scopes).toEqual(['owner', 'admin']);
    expect(leadConvert.scopes).not.toContain('editor');
  });

  it('shuts every one of these out of a viewer and a client session', () => {
    for (const t of [leadCreate, leadImport, leadList, leadUpdate, leadConvert]) {
      expect(t.scopes).not.toContain('viewer');
      expect(t.scopes).not.toContain('client');
    }
  });

  it('declares reads as reads and writes as writes, which is what the audit trail records', () => {
    expect(leadList.effect).toBe('read');
    for (const t of [leadCreate, leadImport, leadUpdate, leadConvert]) expect(t.effect).toBe('write');
  });

  it('spends nothing — no vendor is called, so no tool here estimates a cost', () => {
    for (const t of [leadCreate, leadImport, leadList, leadUpdate, leadConvert]) {
      expect(t.estimateCents).toBeUndefined();
      expect(t.effect).not.toBe('spend');
    }
  });
});

/* ── the boundary this family deliberately does not cross ──────────── */

describe('capture, not prospecting', () => {
  it('exposes no tool that finds businesses the agency did not already know', async () => {
    /**
     * The Agency Portal's "Find Clients" button has nothing behind it on
     * purpose. Harvesting businesses out of a directory collects personal data
     * with no lawful basis and generally breaks the source's terms; it is not
     * something to acquire as a side effect of building a pipeline. If this ever
     * changes it should be a deliberate decision with its own review, and this
     * test failing is what forces that.
     */
    const mod: Record<string, unknown> = await import('../src/leads.js');
    const toolNames = Object.values(mod)
      .filter((v): v is { name: string } => typeof v === 'object' && v !== null && 'name' in v && 'handler' in v)
      .map((t) => t.name);

    expect(toolNames.sort()).toEqual(['lead.convert', 'lead.create', 'lead.import', 'lead.list', 'lead.update']);
    for (const n of toolNames) expect(n).not.toMatch(/find|search|discover|scrape|prospect|enrich/);
  });

  it('never calls anything external — every source is the caller’s own list', () => {
    for (const t of [leadCreate, leadImport, leadList, leadUpdate, leadConvert]) {
      expect(t.effect).not.toBe('external');
    }
  });
});

/* ── errors ────────────────────────────────────────────────────────── */

describe('errors', () => {
  it('throws ToolError rather than bare strings, so the agent can read them', async () => {
    const s = store();
    await expect(
      leadUpdate.handler(leadUpdate.input.parse({ leadId: 'nope', status: 'contacted' }), ctx(s.api)),
    ).rejects.toBeInstanceOf(ToolError);
  });
});
