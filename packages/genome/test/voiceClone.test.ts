import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { makeVoiceCloneFromSample } from '../src/voiceClone.js';

/**
 * `genome.voice.clone_from_sample` — trains a voice and registers it in one
 * call. The three things worth holding still:
 *
 *   1. `human_only`. Cloning a voice is a rights decision, same posture as
 *      `genome.consent.grant` and `genome.avatar_config.set`.
 *   2. One call, one outcome. If the clone succeeds the genome is written; a
 *      consumed ElevenLabs voice slot that nothing references is the failure
 *      mode this tool exists to avoid.
 *   3. The genome is never written when the vendor call fails.
 */

function ctx(over: { patchConstraints?: ScopedDb['genomes']['patchConstraints'] } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        patchConstraints:
          over.patchConstraints ?? (async ({ genomeId }) => ({ id: genomeId, version: 3 })),
        get: async () => undefined,
        listForOrg: async () => [],
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const sample = { url: 'https://storage.example/sample.mp3', contentType: 'audio/mpeg' };

function client(over: Partial<{ voiceId: string; requiresVerification: boolean; throws: Error }> = {}) {
  return {
    generate: async () => ({ url: 'https://audio.example/out.mp3' }),
    clone: vi.fn(async () => {
      if (over.throws) throw over.throws;
      return {
        voiceId: over.voiceId ?? 'voice_abc',
        requiresVerification: over.requiresVerification ?? false,
      };
    }),
  };
}

describe('the registry contract', () => {
  it("is human_only — cloning somebody's voice is not SPARK's call to make", () => {
    expect(makeVoiceCloneFromSample(client()).autonomy).toBe('human_only');
  });

  it('is not idempotent, because a second call burns a second voice slot', () => {
    expect(makeVoiceCloneFromSample(client()).idempotent).toBe(false);
  });
});

describe('genome.voice.clone_from_sample', () => {
  it('clones, then writes the returned id onto the genome in the same call', async () => {
    const patchConstraints = vi.fn<ScopedDb['genomes']['patchConstraints']>(async ({ genomeId }) => ({
      id: genomeId,
      version: 3,
    }));
    const voice = client({ voiceId: 'voice_xyz' });

    const out = await makeVoiceCloneFromSample(voice).handler(
      { genomeId: 'gen_1', name: 'AG Accessories — agent voice', samples: [sample] },
      ctx({ patchConstraints }),
    );

    expect(voice.clone).toHaveBeenCalledWith({
      name: 'AG Accessories — agent voice',
      samples: [sample],
    });
    expect(patchConstraints).toHaveBeenCalledWith({
      genomeId: 'gen_1',
      orgId: 'org_1',
      patch: { elevenlabsVoiceId: 'voice_xyz' },
    });
    expect(out).toMatchObject({ genomeId: 'gen_1', version: 3, elevenlabsVoiceId: 'voice_xyz' });
  });

  it('leaves the genome untouched when the vendor call fails', async () => {
    const patchConstraints = vi.fn<ScopedDb['genomes']['patchConstraints']>(async ({ genomeId }) => ({
      id: genomeId,
      version: 3,
    }));
    const voice = client({ throws: new ToolError('UPSTREAM_FAILED', 'nope', {}) });

    await expect(
      makeVoiceCloneFromSample(voice).handler(
        { genomeId: 'gen_1', name: 'v', samples: [sample] },
        ctx({ patchConstraints }),
      ),
    ).rejects.toThrow(ToolError);

    expect(patchConstraints).not.toHaveBeenCalled();
  });

  it('surfaces requiresVerification in why, rather than reporting plain success', async () => {
    const out = await makeVoiceCloneFromSample(client({ requiresVerification: true })).handler(
      { genomeId: 'gen_1', name: 'v', samples: [sample] },
      ctx(),
    );

    expect(out.requiresVerification).toBe(true);
    expect(out.why.factors.some((f) => /verif/i.test(f.label) || /verif/i.test(f.detail))).toBe(true);
  });

  it('refuses a genomeId that is not the active one', async () => {
    await expect(
      makeVoiceCloneFromSample(client()).handler(
        { genomeId: 'gen_OTHER', name: 'v', samples: [sample] },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'ISOLATION_VIOLATION' });
  });
});
