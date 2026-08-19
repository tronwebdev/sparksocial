import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { brandCreate, brandSettingsPatch, makeBrandKnowledgeAttach, brandExport, brandImport } from '../src/brand.js';

function ctx(db: unknown, over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: db as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  } as unknown as ToolCtx;
}

describe('brand.create', () => {
  it('provisions a brand row and a paired genome shell', async () => {
    const brandGets: unknown[] = [];
    const genomeCreates: unknown[] = [];
    const db = {
      brands: { get: async (id: string, orgId: string, name?: string) => { brandGets.push({ id, orgId, name }); return { brandId: id, name, approvalMode: 'review_first_week', createdAt: new Date(), agentPaused: false, postsPerWeek: 3 }; } },
      genomes: { createDraft: async (args: unknown) => { genomeCreates.push(args); return { id: 'gen_new' }; } },
    };
    const out = await brandCreate.handler({ name: 'Client Co', category: 'Barbershop', locale: 'en-US' }, ctx(db));
    expect(out.genomeId).toBe('gen_new');
    expect(out.name).toBe('Client Co');
    expect(brandGets).toHaveLength(1);
    expect(genomeCreates).toHaveLength(1);
    expect((genomeCreates[0] as { identity: { business_name: string } }).identity.business_name).toBe('Client Co');
  });

  it('is not idempotent — a repeated call creates a second brand', () => {
    expect(brandCreate.idempotent).toBe(false);
  });
});

describe('brand.settings.patch', () => {
  it('renames a brand and nothing else', async () => {
    const db = { brands: { get: async (id: string, orgId: string, name?: string) => ({ brandId: id, name, approvalMode: 'review_first_week', createdAt: new Date(), agentPaused: false, postsPerWeek: 3 }) } };
    const out = await brandSettingsPatch.handler({ brandId: 'brand_1', name: 'New Name' }, ctx(db));
    expect(out.name).toBe('New Name');
  });
});

describe('brand.knowledge.attach', () => {
  it('embeds the text and stores it against the genome', async () => {
    const attached: unknown[] = [];
    const db = { knowledge: { attach: async (args: unknown) => { attached.push(args); return { id: 'kc_1', genomeId: 'gen_1', docId: 'faq', text: 'x', createdAt: new Date() }; } } };
    const tool = makeBrandKnowledgeAttach({ embed: async () => [0.1, 0.2] });
    const out = await tool.handler({ genomeId: 'gen_1', docId: 'faq', text: 'Our return policy is 30 days.' }, ctx(db));
    expect(out.docId).toBe('faq');
    expect((attached[0] as { embedding: number[] }).embedding).toEqual([0.1, 0.2]);
  });
});

describe('brand.export / brand.import', () => {
  const exportedGenome = {
    genome_id: 'gen_1',
    workspace_id: 'brand_1',
    version: 3,
    identity: { business_name: 'Original Co', category: 'x', geography: { scope: 'local' }, languages: ['en'] },
    dimensions: { proof_asset: ['physical_craft'], capture_capability: [], talent_availability: 'no', objective: 'leads' },
    voice: { tone: 'warm' },
    audience: { segments: [] },
    offer: { products: [], primary_cta: 'Book now' },
    constraints: { compliance_profile: 'none' },
    learned: { top_formats: [], best_post_times: [], mix_weights_override: { proof: 0.9 }, confidence: 0.8 },
  };

  it('export omits learned performance history', async () => {
    const db = { genomes: { get: async () => exportedGenome } };
    const out = await brandExport.handler({ genomeId: 'gen_1' }, ctx(db));
    expect(out.data).not.toHaveProperty('learned');
    expect(out.data.offer).toEqual({ products: [], primary_cta: 'Book now' });
  });

  it('404s exporting an unknown genome', async () => {
    const db = { genomes: { get: async () => undefined } };
    await expect(brandExport.handler({ genomeId: 'ghost' }, ctx(db))).rejects.toThrow(ToolError);
  });

  it('import creates a fresh brand/genome from exported data, never overwriting the source', async () => {
    const genomeCreates: unknown[] = [];
    const patches: { offer?: unknown; constraints?: unknown } = {};
    const db = {
      brands: { get: async (id: string, orgId: string, name?: string) => ({ brandId: id, name, approvalMode: 'review_first_week', createdAt: new Date(), agentPaused: false, postsPerWeek: 3 }) },
      genomes: {
        createDraft: async (args: unknown) => { genomeCreates.push(args); return { id: 'gen_clone' }; },
        patchOffer: async (args: { offer: unknown }) => { patches.offer = args.offer; return { id: 'gen_clone', version: 2 }; },
        patchConstraints: async (args: { patch: unknown }) => { patches.constraints = args.patch; return { id: 'gen_clone', version: 3 }; },
      },
    };
    const exported = await brandExport.handler({ genomeId: 'gen_1' }, ctx({ genomes: { get: async () => exportedGenome } }));
    const out = await brandImport.handler({ name: 'Clone of Original', data: exported.data }, ctx(db));
    expect(out.genomeId).toBe('gen_clone');
    expect(out.name).toBe('Clone of Original');
    expect(genomeCreates).toHaveLength(1);
    expect(patches.offer).toEqual({ products: [], primary_cta: 'Book now' });
  });
});
