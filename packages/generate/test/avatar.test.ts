import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { makeContentGenerateAvatarVideo } from '../src/avatar.js';
import type { AvatarClient } from '../src/types.js';

const genome = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!.genome;
const withAvatar = { ...genome, constraints: { ...genome.constraints, heygen_avatar_id: 'av_123' } };

const draftBeats = [
  { kind: 'text' as const, beatId: 'hook', text: 'A strong opinion, delivered to camera.' },
  { kind: 'text' as const, beatId: 'cta', text: 'Book a call.' },
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
        get: over.genomeGet ?? (async () => withAvatar),
        listForOrg: async () => [],
      },
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('not used'); },
        get:
          over.get ??
          (async () => ({
            id: 'ci_1', genomeId: 'gen_saas', playbookId: 'pb_avatar_pov', mode: 'synthesize',
            status: 'draft', copy: draftBeats, createdAt: new Date(),
          })),
        updateDraft:
          over.updateDraft ??
          (async (args) => ({
            id: args.id, genomeId: args.genomeId, playbookId: 'pb_avatar_pov', mode: 'synthesize',
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

function stubAvatar(url = 'https://heygen.example/vid.mp4'): AvatarClient {
  return { generate: vi.fn(async () => ({ url })) };
}

describe('content.generate_avatar_video — the registry contract', () => {
  const tool = makeContentGenerateAvatarVideo(stubAvatar());

  it('is not idempotent', () => {
    expect(tool.idempotent).toBe(false);
  });

  it('is write, not external', () => {
    expect(tool.effect).toBe('write');
  });
});

describe('content.generate_avatar_video', () => {
  it('renders and saves a generated_video beat when consent and a registered avatar are both present', async () => {
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_avatar_pov', mode: 'synthesize',
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const avatar = stubAvatar('https://heygen.example/clip.mp4');
    const tool = makeContentGenerateAvatarVideo(avatar);

    const res = await tool.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', script: 'Here is my hot take.', aspectRatio: '9:16' },
      ctx({ updateDraft }),
    );

    expect(res.url).toBe('https://heygen.example/clip.mp4');
    expect(avatar.generate).toHaveBeenCalledWith({ avatarId: 'av_123', script: 'Here is my hot take.', aspectRatio: '9:16' });

    const saved = updateDraft.mock.calls[0]![0].copy as typeof draftBeats;
    expect(saved[0]).toEqual({ kind: 'generated_video', beatId: 'hook', url: 'https://heygen.example/clip.mp4', script: 'Here is my hot take.' });
    expect(saved[1]).toEqual(draftBeats[1]); // the cta beat is untouched
  });

  it('blocks at the tool layer when no active avatar_clone consent is on file', async () => {
    const avatar = stubAvatar();
    const tool = makeContentGenerateAvatarVideo(avatar);

    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', script: 'x', aspectRatio: '9:16' },
        ctx({ hasActive: async () => false }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(avatar.generate).not.toHaveBeenCalled();
  });

  it('refuses to generate when the genome has no registered avatar, even with consent on file', async () => {
    const avatar = stubAvatar();
    const tool = makeContentGenerateAvatarVideo(avatar);

    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', script: 'x', aspectRatio: '9:16' },
        ctx({ genomeGet: async () => genome }), // no heygen_avatar_id
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(avatar.generate).not.toHaveBeenCalled();
  });

  it('404s when the draft or beat does not exist', async () => {
    const tool = makeContentGenerateAvatarVideo(stubAvatar());
    await expect(
      tool.handler(
        { contentItemId: 'ci_gone', genomeId: 'gen_saas', beatId: 'hook', script: 'x', aspectRatio: '9:16' },
        ctx({ get: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'nope', script: 'x', aspectRatio: '9:16' },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('propagates a vendor failure without saving a broken beat', async () => {
    const failing: AvatarClient = { generate: vi.fn(async () => { throw new ToolError('UPSTREAM_FAILED', 'heygen down'); }) };
    const updateDraft = vi.fn();
    const tool = makeContentGenerateAvatarVideo(failing);

    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', script: 'x', aspectRatio: '9:16' },
        ctx({ updateDraft }),
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
    expect(updateDraft).not.toHaveBeenCalled();
  });
});
