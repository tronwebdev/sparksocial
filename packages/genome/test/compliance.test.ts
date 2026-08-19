import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { Genome } from '@sparksocial/shared/genome';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { genomeComplianceClassify } from '../src/compliance.js';

/**
 * `genome.compliance.classify` — the write side of `guard.compliance_profile`
 * actually mattering. What's asserted here: the keyword match is real (not a
 * hand-picked fixture), a genome with no regulated-vertical signal is left at
 * `'none'` rather than forced to guess, and `overrideProfile` always wins over
 * the classifier.
 */

function genome(over: Partial<Genome['identity']> = {}): Genome {
  return {
    id: 'gen_1',
    org_id: 'org_1',
    workspace_id: 'brand_1',
    identity: {
      business_name: 'Test Co',
      category: 'general business',
      one_liner: 'we do things',
      geography: { scope: 'local', locale: 'en-US', radius_km: 10 },
      languages: ['en'],
      price_tier: 'mid',
      ...over,
    },
  } as unknown as Genome;
}

function ctx(over: { get?: ScopedDb['genomes']['get']; patchConstraints?: ScopedDb['genomes']['patchConstraints'] } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        patchConstraints: over.patchConstraints ?? (async ({ genomeId }) => ({ id: genomeId, version: 2 })),
        get: over.get ?? (async () => genome()),
        listForOrg: async () => [],
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('the registry contract', () => {
  it('is human_only — the vertical is a person’s call to confirm', () => {
    expect(genomeComplianceClassify.autonomy).toBe('human_only');
  });

  it('is idempotent — reclassifying is a refresh, not a new decision', () => {
    expect(genomeComplianceClassify.idempotent).toBe(true);
  });
});

describe('genome.compliance.classify — keyword classification', () => {
  it('classifies a clinic as health', async () => {
    const patchConstraints = vi.fn<ScopedDb['genomes']['patchConstraints']>(async ({ genomeId }) => ({ id: genomeId, version: 2 }));
    const get = async () => genome({ category: 'medical clinic', one_liner: 'family medicine and urgent care' });

    const out = await genomeComplianceClassify.handler({ genomeId: 'gen_1' }, ctx({ get, patchConstraints }));

    expect(out.complianceProfile).toBe('health');
    expect(patchConstraints).toHaveBeenCalledWith({ genomeId: 'gen_1', orgId: 'org_1', patch: { complianceProfile: 'health' } });
    expect(out.why.summary).toContain('health');
  });

  it('classifies a law firm as legal', async () => {
    const get = async () => genome({ category: 'law firm', one_liner: 'personal injury attorney' });
    const out = await genomeComplianceClassify.handler({ genomeId: 'gen_1' }, ctx({ get }));
    expect(out.complianceProfile).toBe('legal');
  });

  it('classifies an investment advisory as finance', async () => {
    const get = async () => genome({ category: 'financial advisory', one_liner: 'investment management for retirees' });
    const out = await genomeComplianceClassify.handler({ genomeId: 'gen_1' }, ctx({ get }));
    expect(out.complianceProfile).toBe('finance');
  });

  it('classifies a dispensary as regulated_other', async () => {
    const get = async () => genome({ category: 'cannabis dispensary', one_liner: 'recreational and medical cannabis' });
    const out = await genomeComplianceClassify.handler({ genomeId: 'gen_1' }, ctx({ get }));
    expect(out.complianceProfile).toBe('regulated_other');
  });

  it('leaves an ordinary business at none rather than forcing a guess', async () => {
    const get = async () => genome({ category: 'barbershop', one_liner: 'fades and beard trims' });
    const out = await genomeComplianceClassify.handler({ genomeId: 'gen_1' }, ctx({ get }));
    expect(out.complianceProfile).toBe('none');
    expect(out.why.summary).toContain('No regulated-vertical keyword matched');
  });

  it('does not false-positive a gym as health — "wellness"/"fitness" are not in the health keyword list', async () => {
    const get = async () => genome({ category: 'fitness studio', one_liner: 'strength training and wellness coaching' });
    const out = await genomeComplianceClassify.handler({ genomeId: 'gen_1' }, ctx({ get }));
    expect(out.complianceProfile).toBe('none');
  });
});

describe('genome.compliance.classify — override', () => {
  it('overrideProfile wins over the classifier, and is not run through keyword matching', async () => {
    const patchConstraints = vi.fn<ScopedDb['genomes']['patchConstraints']>(async ({ genomeId }) => ({ id: genomeId, version: 3 }));
    const get = async () => genome({ category: 'barbershop', one_liner: 'fades and beard trims' }); // would classify 'none'

    const out = await genomeComplianceClassify.handler({ genomeId: 'gen_1', overrideProfile: 'health' }, ctx({ get, patchConstraints }));

    expect(out.complianceProfile).toBe('health');
    expect(patchConstraints).toHaveBeenCalledWith({ genomeId: 'gen_1', orgId: 'org_1', patch: { complianceProfile: 'health' } });
    expect(out.why.summary).toContain('override');
  });

  it('overrideProfile can set none, clearing a prior classification', async () => {
    const out = await genomeComplianceClassify.handler({ genomeId: 'gen_1', overrideProfile: 'none' }, ctx());
    expect(out.complianceProfile).toBe('none');
  });
});

describe('genome.compliance.classify — errors', () => {
  it('throws NOT_FOUND for an unknown or out-of-scope genome', async () => {
    await expect(
      genomeComplianceClassify.handler({ genomeId: 'gen_missing' }, ctx({ get: async () => undefined })),
    ).rejects.toThrow(ToolError);
  });
});
