import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools/defineTool';
import type { Role } from '@sparksocial/shared';
import { lagosBarbershop, manilaFreelancer } from '@sparksocial/playbooks';
import { makeEvaluateDraft } from '../src/tool.js';
import { makeRunGuardrails } from '../src/runGuardrails.js';

/**
 * `guard.evaluate_draft` end to end, and the `runGuardrails` adapter that a
 * future guardrail-declaring tool would go through inside `invokeTool`. Both
 * call the same `gatherAndEvaluate` core — these tests exist to prove the
 * *wiring* is correct, not to re-test each pure check (that's covered per-file).
 */

function ctx(over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner' as Role,
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'gen_draft' }),
        patchDimensions: async () => ({ id: 'gen_1', version: 1 }),
        get: async () => lagosBarbershop.genome,
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => ({}),
        retrieve: async () => [],
        create: async () => ({ id: 'asset_1' }),
        captionsByRole: async () => [],
        info: async () => ({}),
      },
      content: { recent: async () => [] },
      campaigns: {
        create: async () => ({ id: 'cmp_1' }),
        get: async () => undefined,
        listForGenome: async () => [],
        replaceSlots: async () => 0,
        slots: async () => [],
        setStatus: async () => {},
      },
      brands: {
        get: async (brandId: string) => ({
          brandId, name: '', approvalMode: 'autopublish' as const, createdAt: new Date('2026-01-01T00:00:00Z'),
        }),
        setApprovalMode: async (brandId: string) => ({
          brandId, name: '', approvalMode: 'autopublish' as const, createdAt: new Date('2026-01-01T00:00:00Z'),
        }),
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n, fn) => fn(), event: () => {} },
    ...over,
  };
}

const embed = { embed: async (text: string) => [text.length, 0, 0] };

describe('guard.evaluate_draft', () => {
  it('does not declare guardrails on itself', () => {
    // If it did, invokeTool would abort on the first block before this
    // handler ever ran, and the caller would lose every other check's result.
    const tool = makeEvaluateDraft(embed);
    expect(tool.guardrails).toBeUndefined();
  });

  it('reports overall pass when every check clears', async () => {
    const tool = makeEvaluateDraft(embed);
    const res = await tool.handler(
      {
        genomeId: lagosBarbershop.genome.genome_id,
        playbookId: 'pb_craft_capture',
        platform: 'instagram',
        text: 'The fade finishing, up close.',
        referencedAssetIds: [],
      },
      ctx(),
    );
    expect(res.overall).toBe('pass');
    expect(res.why.summary).toContain('clear');
  });

  it('reports overall block when any check blocks, and lists it in why.factors', async () => {
    const tool = makeEvaluateDraft(embed);
    const res = await tool.handler(
      {
        genomeId: lagosBarbershop.genome.genome_id,
        playbookId: 'pb_craft_capture',
        platform: 'x',
        text: 'x'.repeat(300), // over X's 280-char limit
        referencedAssetIds: [],
      },
      ctx(),
    );
    expect(res.overall).toBe('block');
    expect(res.checks.platform_policy?.verdict).toBe('block');
    expect(res.why.factors.some((f) => f.label === 'platform_policy')).toBe(true);
  });

  it('reports overall flag (not block) when the worst check is a flag', async () => {
    const tool = makeEvaluateDraft(embed);
    const res = await tool.handler(
      {
        genomeId: manilaFreelancer.genome.genome_id,
        playbookId: 'pb_portfolio_in_motion',
        platform: 'instagram',
        text: 'This redesign is a total game-changer for the client.',
        referencedAssetIds: [],
      },
      ctx({
        db: {
          ...ctx().db,
          genomes: {
            ...ctx().db.genomes,
            get: async () => ({
              ...manilaFreelancer.genome,
              voice: { ...manilaFreelancer.genome.voice, banned_phrases: ['game-changer'] },
            }),
          },
        },
      }),
    );
    expect(res.overall).toBe('flag');
    expect(res.checks.brand_voice?.verdict).toBe('flag');
  });

  it('blocks with missing_context when the genome cannot be found', async () => {
    const tool = makeEvaluateDraft(embed);
    const res = await tool.handler(
      { genomeId: 'nope', playbookId: 'pb_craft_capture', platform: 'x', text: 'short', referencedAssetIds: [] },
      ctx({ db: { ...ctx().db, genomes: { ...ctx().db.genomes, get: async () => undefined } } }),
    );
    expect(res.overall).toBe('block');
  });
});

describe('makeRunGuardrails (the invokeTool adapter)', () => {
  it('returns one GuardrailVerdict per requested guard, in invoke.ts shape', async () => {
    const runGuardrails = makeRunGuardrails(embed);
    const verdicts = await runGuardrails(
      ['brand_voice', 'platform_policy'],
      {
        genomeId: lagosBarbershop.genome.genome_id,
        playbookId: 'pb_craft_capture',
        platform: 'instagram',
        text: 'A clean, short post.',
        referencedAssetIds: [],
      },
      ctx(),
    );
    expect(verdicts).toHaveLength(2);
    expect(verdicts.map((v) => v.guard).sort()).toEqual(['brand_voice', 'platform_policy']);
    expect(verdicts.every((v) => v.verdict === 'pass')).toBe(true);
  });

  it('blocks loudly on a wiring error rather than silently skipping enforcement', async () => {
    const runGuardrails = makeRunGuardrails(embed);
    const verdicts = await runGuardrails(['brand_voice'], { not: 'a draft' }, ctx());
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.verdict).toBe('block');
    expect(verdicts[0]!.rule).toBe('wiring_error');
  });
});
