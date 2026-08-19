import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { GOLDEN_SET, byId } from '@sparksocial/playbooks';
import { makeAssemblePlan, requiredRoles } from '../src/tool.js';

type RetrieveArgs = Parameters<ScopedDb['assets']['retrieve']>[0];

const genome = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!.genome;
const withCta = { ...genome, offer: { ...genome.offer, primary_cta: 'Start a free trial' } };

const embed = { embed: async () => Array.from({ length: 8 }, () => 0.1) };

function ctx(over: {
  retrieve?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  ctx?: Partial<ToolCtx>;
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    brandId: 'ws_gen_saas',
    genomeId: 'gen_saas',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        get: over.get ?? (async () => withCta),
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => ({}),
        retrieve:
          over.retrieve ??
          (async () => [
            { assetId: 'a1', role: 'product_screen', caption: 'the scheduler', score: 0.9,
              usageCount: 0, lastUsedAt: null, rightsStatus: 'cleared' },
          ]),
        create: async () => ({ id: 'a' }),
        captionsByRole: async () => [],
        info: async () => ({}),
      },
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('content.createDraft not stubbed in this test'); },
        get: async () => undefined,
        updateDraft: async () => undefined,
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n, fn) => fn(), event: () => {} },
    ...over.ctx,
  } as ToolCtx;
}

describe('requiredRoles', () => {
  it('derives roles from the beats, deduped, in first-appearance order', () => {
    expect(requiredRoles(byId('pb_workflow_clip')!.structure.beats)).toEqual(['product_screen']);
    // genome: and prompt_ref beats contribute nothing to retrieve.
    expect(requiredRoles([{ source: 'genome:offer.primary_cta' }, {}])).toEqual([]);
    expect(
      requiredRoles([
        { source: 'asset:product_shot' },
        { source: 'asset:social_proof' },
        { source: 'asset:product_shot' },
      ]),
    ).toEqual(['product_shot', 'social_proof']);
  });
});

describe('assemble.plan', () => {
  const tool = makeAssemblePlan(embed);

  it('is read-effect and idempotent — planning must never mutate the graph', () => {
    expect(tool.effect).toBe('read');
    expect(tool.idempotent).toBe(true);
  });

  it('retrieves exactly the roles the beats need, scoped to the caller’s org', async () => {
    // Typed against the real parameter shape: a zero-arg `vi.fn` makes
    // `mock.calls[0]` an empty tuple, and the assertions below are entirely
    // about what arguments the handler passed.
    const retrieve = vi.fn(async (_args: RetrieveArgs) => [
      { assetId: 'a1', role: 'product_screen' as const, caption: null, score: 0.9,
        usageCount: 0, lastUsedAt: null, rightsStatus: 'cleared' },
    ]);

    await tool.handler(
      { genomeId: 'gen_saas', playbookId: 'pb_workflow_clip', intent: 'scheduling' },
      ctx({ retrieve }),
    );

    expect(retrieve).toHaveBeenCalledOnce();
    const args = retrieve.mock.calls[0]![0] as { orgId: string; genomeId: string; requiredRoles: string[] };
    // orgId comes from the verified context, never from the input — the input
    // has no field for it, which is the point.
    expect(args.orgId).toBe('org_1');
    expect(args.genomeId).toBe('gen_saas');
    expect(args.requiredRoles).toEqual(['product_screen']);
  });

  it('strips a caller-supplied orgId at the schema, before the handler can see it', () => {
    // The tenancy defence here is the input schema, not handler discipline:
    // Zod objects drop unknown keys, so a body carrying `orgId` arrives at the
    // handler without it and there is nothing for a careless `input.orgId ??
    // ctx.orgId` to pick up. Asserted because it is the reason the handler is
    // allowed to be simple.
    const parsed = tool.input.parse({
      genomeId: 'gen_saas',
      playbookId: 'pb_workflow_clip',
      orgId: 'org_attacker',
      requiredRoles: ['social_proof'],
    });
    expect(parsed).not.toHaveProperty('orgId');
    expect(parsed).not.toHaveProperty('requiredRoles');
  });

  it('does not retrieve at all when no beat needs an asset', async () => {
    const retrieve = vi.fn(async () => []);
    const textOnly = byId('pb_generated_quote_card');
    if (!textOnly || requiredRoles(textOnly.structure.beats).length > 0) return; // guard if records change

    await tool.handler({ genomeId: 'gen_saas', playbookId: textOnly.playbook_id, intent: '' }, ctx({ retrieve }))
      .catch(() => undefined); // mode may not be assemble; retrieval is what we assert
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('reports an out-of-scope genome as NOT_FOUND, never another org’s plan', async () => {
    const err = await tool
      .handler({ genomeId: 'gen_someone_else', playbookId: 'pb_workflow_clip', intent: '' },
        ctx({ get: vi.fn(async () => undefined) }))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('rejects an unknown playbook', async () => {
    await expect(
      tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_nope', intent: '' }, ctx()),
    ).rejects.toThrow(ToolError);
  });

  it('returns a why naming the assets it used — invariant 4', async () => {
    const out = await tool.handler(
      { genomeId: 'gen_saas', playbookId: 'pb_workflow_clip', intent: 'scheduling' },
      ctx(),
    );

    expect(out.why.summary).toMatch(/Workflow Clip/);
    // Evidence must be linkable back to the library, so ids not prose.
    expect(out.why.evidence).toEqual([
      expect.objectContaining({ kind: 'asset', id: 'a1' }),
    ]);
  });

  it('surfaces the missing role rather than a shortened video', async () => {
    const err = await tool
      .handler({ genomeId: 'gen_saas', playbookId: 'pb_workflow_clip', intent: '' },
        ctx({ retrieve: vi.fn(async () => []) }))
      .catch((e: unknown) => e as ToolError);

    expect((err as ToolError).code).toBe('NOT_FOUND');
    expect((err as ToolError).meta.missingRoles).toEqual(['product_screen']);
  });

  it('falls back to the playbook description when no intent is given', async () => {
    const spy = vi.fn(async () => Array.from({ length: 8 }, () => 0.1));
    const t = makeAssemblePlan({ embed: spy });

    await t.handler({ genomeId: 'gen_saas', playbookId: 'pb_workflow_clip', intent: '' }, ctx());

    // Embedding the empty string would rank every asset identically, quietly
    // turning retrieval into "whatever came back first".
    expect(spy).toHaveBeenCalledWith(byId('pb_workflow_clip')!.description);
  });
});
