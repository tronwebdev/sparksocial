import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { avatarConfigSet } from '../src/avatarConfig.js';

/**
 * `genome.avatar_config.set` — registers a trained HeyGen avatar / ElevenLabs
 * voice against a genome. What matters here is the same asymmetry
 * `genome.consent.grant` has: `human_only`, and the store call is a partial
 * merge, never a clobber of whichever field the caller didn't mention.
 */

function ctx(over: { patchConstraints?: ScopedDb['genomes']['patchConstraints'] } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        patchConstraints:
          over.patchConstraints ?? (async ({ genomeId }) => ({ id: genomeId, version: 2 })),
        get: async () => undefined,
        listForOrg: async () => [],
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('the registry contract', () => {
  it('is human_only — pointing a genome at a specific trained likeness is not SPARK\'s call', () => {
    expect(avatarConfigSet.autonomy).toBe('human_only');
  });

  it('stays inside the workspace, so it is write, not external', () => {
    expect(avatarConfigSet.effect).toBe('write');
  });
});

describe('genome.avatar_config.set', () => {
  it('sets only the avatar id, leaving the voice id patch untouched', async () => {
    const patchConstraints = vi.fn<ScopedDb['genomes']['patchConstraints']>(async ({ genomeId }) => ({
      id: genomeId, version: 2,
    }));

    const out = await avatarConfigSet.handler({ genomeId: 'gen_1', heygenAvatarId: 'av_123' }, ctx({ patchConstraints }));

    expect(out).toMatchObject({ genomeId: 'gen_1', version: 2, heygenAvatarId: 'av_123' });
    expect(out.elevenlabsVoiceId).toBeUndefined();
    expect(patchConstraints).toHaveBeenCalledWith({
      genomeId: 'gen_1', orgId: 'org_1', patch: { heygenAvatarId: 'av_123' },
    });
  });

  it('sets both fields in one call when both are given', async () => {
    const patchConstraints = vi.fn<ScopedDb['genomes']['patchConstraints']>(async ({ genomeId }) => ({
      id: genomeId, version: 3,
    }));

    await avatarConfigSet.handler(
      { genomeId: 'gen_1', heygenAvatarId: 'av_123', elevenlabsVoiceId: 'voice_456' },
      ctx({ patchConstraints }),
    );

    expect(patchConstraints).toHaveBeenCalledWith({
      genomeId: 'gen_1', orgId: 'org_1', patch: { heygenAvatarId: 'av_123', elevenlabsVoiceId: 'voice_456' },
    });
  });

  it('refuses a call that names neither id', () => {
    expect(avatarConfigSet.input.safeParse({ genomeId: 'gen_1' }).success).toBe(false);
  });

  it('propagates NOT_FOUND for an unknown or out-of-scope genome', async () => {
    const patchConstraints: ScopedDb['genomes']['patchConstraints'] = async () => {
      throw new ToolError('NOT_FOUND', 'No genome.');
    };
    await expect(
      avatarConfigSet.handler({ genomeId: 'gen_x', heygenAvatarId: 'av_1' }, ctx({ patchConstraints })),
    ).rejects.toThrow(ToolError);
  });
});
