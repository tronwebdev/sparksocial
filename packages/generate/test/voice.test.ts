import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { makeContentGenerateVoiceover } from '../src/voice.js';
import type { VoiceClient } from '../src/types.js';

const genome = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!.genome;
const withVoice = { ...genome, constraints: { ...genome.constraints, elevenlabs_voice_id: 'voice_456' } };

const draftBeats = [
  { kind: 'asset' as const, beatId: 'broll', assetId: 'a1', role: 'product_screen' as const, caption: null },
  { kind: 'text' as const, beatId: 'body', text: 'Here is how the scheduler works.' },
];

function ctx(over: {
  get?: ScopedDb['content']['get'];
  updateDraft?: ScopedDb['content']['updateDraft'];
  genomeGet?: ScopedDb['genomes']['get'];
  hasActive?: ScopedDb['consent']['hasActive'];
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    genomeId: 'gen_saas',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        patchConstraints: async () => ({ id: 'g', version: 1 }),
        get: over.genomeGet ?? (async () => withVoice),
        listForOrg: async () => [],
      },
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('not used'); },
        get:
          over.get ??
          (async () => ({
            id: 'ci_1', genomeId: 'gen_saas', playbookId: 'pb_voice_over_broll', mode: 'synthesize',
            status: 'draft', copy: draftBeats, createdAt: new Date(),
          })),
        updateDraft:
          over.updateDraft ??
          (async (args) => ({
            id: args.id, genomeId: args.genomeId, playbookId: 'pb_voice_over_broll', mode: 'synthesize',
            status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
          })),
      },
      consent: {
        grant: async () => { throw new Error('not used'); },
        revoke: async () => undefined,
        hasActive: over.hasActive ?? (async () => true),
        list: async () => [],
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function stubVoice(url = 'https://storage.example/audio.mp3'): VoiceClient {
  return { generate: vi.fn(async () => ({ url })) };
}

describe('content.generate_voiceover', () => {
  it('defaults to the stock voice and needs no consent', async () => {
    const consent = vi.fn<ScopedDb['consent']['hasActive']>(async () => false);
    const voice = stubVoice();
    const tool = makeContentGenerateVoiceover(voice);

    const res = await tool.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'body', script: 'Here is how it works.', useClonedVoice: false },
      ctx({ hasActive: consent }),
    );

    expect(res.url).toBe('https://storage.example/audio.mp3');
    expect(consent).not.toHaveBeenCalled();
    expect(voice.generate).toHaveBeenCalledWith({ voiceId: '21m00Tcm4TlvDq8ikWAM', script: 'Here is how it works.' });
  });

  it('saves a generated_audio beat, leaving the asset beat untouched', async () => {
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_voice_over_broll', mode: 'synthesize',
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const tool = makeContentGenerateVoiceover(stubVoice('https://storage.example/take2.mp3'));

    await tool.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'body', script: 'x', useClonedVoice: false },
      ctx({ updateDraft }),
    );

    const saved = updateDraft.mock.calls[0]![0].copy as typeof draftBeats;
    expect(saved[1]).toEqual({ kind: 'generated_audio', beatId: 'body', url: 'https://storage.example/take2.mp3', script: 'x' });
    expect(saved[0]).toEqual(draftBeats[0]);
  });

  it('uses the registered cloned voice when useClonedVoice is true and consent is on file', async () => {
    const voice = stubVoice();
    const tool = makeContentGenerateVoiceover(voice);

    await tool.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'body', script: 'x', useClonedVoice: true },
      ctx(),
    );

    expect(voice.generate).toHaveBeenCalledWith({ voiceId: 'voice_456', script: 'x' });
  });

  it('blocks the cloned-voice path without consent, but still permits the default stock path', async () => {
    const tool = makeContentGenerateVoiceover(stubVoice());
    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'body', script: 'x', useClonedVoice: true },
        ctx({ hasActive: async () => false }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses the cloned-voice path when no voice is registered, even with consent', async () => {
    const tool = makeContentGenerateVoiceover(stubVoice());
    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'body', script: 'x', useClonedVoice: true },
        ctx({ genomeGet: async () => genome }), // no elevenlabs_voice_id
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('404s when the draft or beat does not exist', async () => {
    const tool = makeContentGenerateVoiceover(stubVoice());
    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'nope', script: 'x', useClonedVoice: false },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('propagates a vendor failure without saving a broken beat', async () => {
    const failing: VoiceClient = { generate: vi.fn(async () => { throw new ToolError('UPSTREAM_FAILED', 'elevenlabs down'); }) };
    const updateDraft = vi.fn();
    const tool = makeContentGenerateVoiceover(failing);

    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'body', script: 'x', useClonedVoice: false },
        ctx({ updateDraft }),
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
    expect(updateDraft).not.toHaveBeenCalled();
  });
});
