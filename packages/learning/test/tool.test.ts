import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { learningRecordOutcome, learningReweight, learningConfidence, learningExplain, learningFreeze, learningReset } from '../src/tool.js';

/**
 * The learning loop's two obligations: `record_outcome` must never trust a
 * caller-supplied reward (it computes one from real metrics against this
 * genome's own baseline), and `reweight` must never let one lucky pillar
 * hijack the mix (the exploration floor + minimum-qualifying-arms gate).
 */

function contentMetric(contentItemId: string, engagement: number) {
  return { contentItemId, platform: 'instagram', likes: engagement, comments: 0, shares: 0, views: 0, impressions: 0, syncedAt: new Date() };
}

function baseGenome(over: Partial<{ confidence: number; mixWeightsOverride: Record<string, number> | null; frozen: boolean }> = {}) {
  return {
    genome_id: 'gen_1',
    workspace_id: 'brand_1',
    version: 1,
    identity: { business_name: 'Test', category: 'x', geography: { scope: 'local' }, languages: ['en'] },
    dimensions: { proof_asset: [], capture_capability: [], talent_availability: 'no', objective: 'leads' },
    voice: {},
    audience: { segments: [] },
    offer: { products: [], primary_cta: '' },
    constraints: { compliance_profile: 'none' },
    learned: {
      top_formats: [],
      best_post_times: [],
      mix_weights_override: over.mixWeightsOverride ?? null,
      confidence: over.confidence ?? 0,
      frozen: over.frozen ?? false,
    },
  };
}

function ctx(over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {} as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  } as unknown as ToolCtx;
}

describe('learning.record_outcome', () => {
  it('computes a reward from real metrics against this genome\'s own baseline, never a supplied number', async () => {
    const db = {
      content: {
        get: async () => ({ id: 'ci_1', genomeId: 'gen_1', playbookId: 'pb', mode: 'assemble', pillar: 'proof', status: 'published', createdAt: new Date() }),
        list: async () => [
          { id: 'ci_2', genomeId: 'gen_1', playbookId: 'pb', mode: 'assemble', pillar: 'proof', status: 'published', createdAt: new Date() },
          { id: 'ci_3', genomeId: 'gen_1', playbookId: 'pb', mode: 'assemble', pillar: 'proof', status: 'published', createdAt: new Date() },
        ],
      },
      analytics: {
        listForItems: async (ids: string[]) =>
          ids.includes('ci_1') ? [contentMetric('ci_1', 20)] : [contentMetric('ci_2', 5), contentMetric('ci_3', 5)],
      },
      learning: {
        recordOutcome: async (args: any) => ({
          recorded: true,
          arm: { pillar: args.pillar, alpha: 1 + args.reward, beta: 1 + (1 - args.reward), observations: 1, updatedAt: new Date() },
        }),
      },
    } as unknown as ToolCtx['db'];

    const out = await learningRecordOutcome.handler({ genomeId: 'gen_1', contentItemId: 'ci_1' }, ctx({ db }));
    // baseline = avg(5,5) = 5; reward = clamp01(20 / (2*5)) = 1
    expect(out.reward).toBe(1);
    expect(out.pillar).toBe('proof');
    expect(out.recorded).toBe(true);
  });

  it('refuses to score an unpublished item', async () => {
    const db = {
      content: { get: async () => ({ id: 'ci_1', genomeId: 'gen_1', playbookId: 'pb', mode: 'assemble', pillar: 'proof', status: 'scheduled', createdAt: new Date() }) },
    } as unknown as ToolCtx['db'];
    await expect(learningRecordOutcome.handler({ genomeId: 'gen_1', contentItemId: 'ci_1' }, ctx({ db }))).rejects.toThrow(ToolError);
  });

  it('refuses an item with no pillar', async () => {
    const db = {
      content: { get: async () => ({ id: 'ci_1', genomeId: 'gen_1', playbookId: 'pb', mode: 'assemble', status: 'published', createdAt: new Date() }) },
    } as unknown as ToolCtx['db'];
    await expect(learningRecordOutcome.handler({ genomeId: 'gen_1', contentItemId: 'ci_1' }, ctx({ db }))).rejects.toThrow(ToolError);
  });

  it('404s for a missing content item', async () => {
    const db = { content: { get: async () => undefined } } as unknown as ToolCtx['db'];
    await expect(learningRecordOutcome.handler({ genomeId: 'gen_1', contentItemId: 'ghost' }, ctx({ db }))).rejects.toThrow(ToolError);
  });

  it('is idempotent — the storage layer\'s unique index is what enforces the one-outcome-per-post rule', () => {
    expect(learningRecordOutcome.idempotent).toBe(true);
  });
});

describe('learning.reweight', () => {
  it('stays cold-start when fewer than two arms clear the exploration floor', async () => {
    const patched: unknown[] = [];
    const db = {
      genomes: { get: async () => baseGenome(), patchLearned: async (args: any) => { patched.push(args); return { id: 'gen_1', version: 2 }; } },
      learning: {
        list: async () => [{ pillar: 'proof', alpha: 4, beta: 1, observations: 4, updatedAt: new Date() }],
      },
    } as unknown as ToolCtx['db'];

    const out = await learningReweight.handler({ genomeId: 'gen_1' }, ctx({ db }));
    expect(out.mixWeightsOverride).toBeNull();
    expect(patched[0]).toMatchObject({ patch: { confidence: expect.any(Number) } });
    expect((patched[0] as any).patch.mix_weights_override).toBeUndefined();
  });

  it('applies a learned override once at least two pillars clear the floor', async () => {
    const patched: unknown[] = [];
    const db = {
      genomes: { get: async () => baseGenome(), patchLearned: async (args: any) => { patched.push(args); return { id: 'gen_1', version: 2 }; } },
      learning: {
        list: async () => [
          { pillar: 'proof', alpha: 9, beta: 1, observations: 10, updatedAt: new Date() },
          { pillar: 'educational', alpha: 6, beta: 6, observations: 12, updatedAt: new Date() },
          { pillar: 'community', alpha: 1, beta: 1, observations: 1, updatedAt: new Date() }, // below the floor
        ],
      },
    } as unknown as ToolCtx['db'];

    const out = await learningReweight.handler({ genomeId: 'gen_1' }, ctx({ db }));
    expect(out.mixWeightsOverride).toEqual({ proof: 0.9, educational: 0.5 });
    expect(out.mixWeightsOverride).not.toHaveProperty('community');
    expect((patched[0] as any).patch.mix_weights_override).toEqual({ proof: 0.9, educational: 0.5 });
  });

  it('confidence rises toward 1 as total observations grow, capped at 1', async () => {
    const db = {
      genomes: { get: async () => baseGenome(), patchLearned: async () => ({ id: 'gen_1', version: 2 }) },
      learning: { list: async () => [{ pillar: 'proof', alpha: 51, beta: 1, observations: 50, updatedAt: new Date() }] },
    } as unknown as ToolCtx['db'];
    const out = await learningReweight.handler({ genomeId: 'gen_1' }, ctx({ db }));
    expect(out.confidence).toBe(1);
  });

  it('404s for an unknown genome', async () => {
    const db = { genomes: { get: async () => undefined } } as unknown as ToolCtx['db'];
    await expect(learningReweight.handler({ genomeId: 'ghost' }, ctx({ db }))).rejects.toThrow(ToolError);
  });

  it('is not open to editors — only owner/admin can move the account\'s own mix', () => {
    expect(learningReweight.scopes).toEqual(['owner', 'admin']);
  });

  it('no-ops while frozen — returns the stored state, never recomputes or writes', async () => {
    const patched: unknown[] = [];
    const db = {
      genomes: {
        get: async () => baseGenome({ frozen: true, confidence: 0.5, mixWeightsOverride: { proof: 0.6 } }),
        patchLearned: async (args: any) => { patched.push(args); return { id: 'gen_1', version: 2 }; },
      },
      learning: {
        // Arms that would otherwise push confidence to 1 — proving frozen
        // really does skip recomputation, not just skip the write.
        list: async () => [{ pillar: 'proof', alpha: 51, beta: 1, observations: 50, updatedAt: new Date() }],
      },
    } as unknown as ToolCtx['db'];

    const out = await learningReweight.handler({ genomeId: 'gen_1' }, ctx({ db }));

    expect(out.confidence).toBe(0.5);
    expect(out.mixWeightsOverride).toEqual({ proof: 0.6 });
    expect(patched).toHaveLength(0);
    expect(out.why.summary).toMatch(/frozen/i);
  });
});

describe('learning.freeze', () => {
  it('sets frozen and reports it in the why', async () => {
    const patched: unknown[] = [];
    const db = {
      genomes: {
        get: async () => baseGenome(),
        patchLearned: async (args: any) => { patched.push(args); return { id: 'gen_1', version: 2 }; },
      },
    } as unknown as ToolCtx['db'];

    const out = await learningFreeze.handler({ genomeId: 'gen_1', enabled: true }, ctx({ db }));

    expect(out.frozen).toBe(true);
    expect(patched[0]).toMatchObject({ genomeId: 'gen_1', orgId: 'org_1', patch: { frozen: true } });
    expect(out.why.summary).toMatch(/frozen/i);
  });

  it('unfreezing clears the flag', async () => {
    const patched: unknown[] = [];
    const db = {
      genomes: {
        get: async () => baseGenome({ frozen: true }),
        patchLearned: async (args: any) => { patched.push(args); return { id: 'gen_1', version: 2 }; },
      },
    } as unknown as ToolCtx['db'];

    const out = await learningFreeze.handler({ genomeId: 'gen_1', enabled: false }, ctx({ db }));
    expect(out.frozen).toBe(false);
    expect((patched[0] as any).patch.frozen).toBe(false);
  });

  it('is human_only — SPARK may not freeze or unfreeze its own leash', () => {
    expect(learningFreeze.autonomy).toBe('human_only');
  });

  it('404s for an unknown genome', async () => {
    const db = { genomes: { get: async () => undefined } } as unknown as ToolCtx['db'];
    await expect(learningFreeze.handler({ genomeId: 'ghost', enabled: true }, ctx({ db }))).rejects.toThrow(ToolError);
  });
});

describe('learning.reset', () => {
  it('deletes arms/outcomes and clears confidence, override, and frozen back to cold start', async () => {
    const resetCalls: unknown[] = [];
    const patched: unknown[] = [];
    const db = {
      genomes: {
        get: async () => baseGenome({ frozen: true, confidence: 0.8, mixWeightsOverride: { proof: 0.7 } }),
        patchLearned: async (args: any) => { patched.push(args); return { id: 'gen_1', version: 3 }; },
      },
      learning: { reset: async (genomeId: string, orgId: string) => { resetCalls.push({ genomeId, orgId }); } },
    } as unknown as ToolCtx['db'];

    const out = await learningReset.handler({ genomeId: 'gen_1' }, ctx({ db }));

    expect(resetCalls).toEqual([{ genomeId: 'gen_1', orgId: 'org_1' }]);
    expect(patched[0]).toMatchObject({
      genomeId: 'gen_1',
      orgId: 'org_1',
      patch: { confidence: 0, mix_weights_override: null, frozen: false },
    });
    expect(out.why.summary).toMatch(/cold start/i);
  });

  it('is destructive and human_only, owner/admin scoped only', () => {
    expect(learningReset.effect).toBe('destructive');
    expect(learningReset.autonomy).toBe('human_only');
    expect(learningReset.scopes).toEqual(['owner', 'admin']);
  });

  it('404s for an unknown genome', async () => {
    const db = { genomes: { get: async () => undefined } } as unknown as ToolCtx['db'];
    await expect(learningReset.handler({ genomeId: 'ghost' }, ctx({ db }))).rejects.toThrow(ToolError);
  });
});

describe('learning.confidence', () => {
  it('reports whether a learned mix is actually active, not just whether confidence is nonzero', async () => {
    const db = {
      genomes: { get: async () => baseGenome({ confidence: 0.5, mixWeightsOverride: { proof: 0.6 } }) },
      learning: { list: async () => [] },
    } as unknown as ToolCtx['db'];
    const out = await learningConfidence.handler({ genomeId: 'gen_1' }, ctx({ db }));
    expect(out.active).toBe(true);
    expect(out.confidence).toBe(0.5);
  });

  it('is not active when confidence is high but no override exists yet', async () => {
    const db = {
      genomes: { get: async () => baseGenome({ confidence: 0.9, mixWeightsOverride: null }) },
      learning: { list: async () => [] },
    } as unknown as ToolCtx['db'];
    const out = await learningConfidence.handler({ genomeId: 'gen_1' }, ctx({ db }));
    expect(out.active).toBe(false);
  });
});

describe('learning.explain', () => {
  it('explains cold-start when nothing has qualified yet', async () => {
    const db = {
      genomes: { get: async () => baseGenome() },
      learning: { list: async () => [] },
    } as unknown as ToolCtx['db'];
    const out = await learningExplain.handler({ genomeId: 'gen_1' }, ctx({ db }));
    expect(out.why.summary).toMatch(/cold-start/i);
  });
});
