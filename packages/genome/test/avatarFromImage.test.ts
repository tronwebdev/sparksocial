import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { makeAvatarFromImage } from '../src/avatarFromImage.js';

/**
 * `genome.avatar.from_image` — photo in, HeyGen character out.
 *
 * The test that matters most here is the `heygen_avatar_kind` one. HeyGen takes
 * a trained avatar as `{ type: 'avatar', avatar_id }` and a photo-derived one as
 * `{ type: 'talking_photo', talking_photo_id }`. Nothing rejects the wrong
 * pairing at submit — `/v2/video/generate` accepts it and the render fails
 * minutes later — so the only thing standing between a customer and a video that
 * never arrives is this tool recording which kind it just made.
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
          over.patchConstraints ?? (async ({ genomeId }) => ({ id: genomeId, version: 4 })),
        get: async () => undefined,
        listForOrg: async () => [],
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function client(over: { id?: string; throws?: Error } = {}) {
  return {
    generate: async () => ({ url: 'https://video.example/out.mp4' }),
    fromImage: vi.fn(async () => {
      if (over.throws) throw over.throws;
      return { talkingPhotoId: over.id ?? 'tp_123' };
    }),
  };
}

const input = {
  genomeId: 'gen_1',
  imageUrl: 'https://storage.example/face.jpg',
  contentType: 'image/jpeg' as const,
};

describe('the registry contract', () => {
  it('is human_only — pointing a brand at a real face is not SPARK’s call', () => {
    expect(makeAvatarFromImage(client()).autonomy).toBe('human_only');
  });
});

describe('genome.avatar.from_image', () => {
  it('records the kind alongside the id, so generation builds the right character block', async () => {
    const patchConstraints = vi.fn<ScopedDb['genomes']['patchConstraints']>(async ({ genomeId }) => ({
      id: genomeId,
      version: 4,
    }));

    const out = await makeAvatarFromImage(client({ id: 'tp_abc' })).handler(input, ctx({ patchConstraints }));

    expect(patchConstraints).toHaveBeenCalledWith({
      genomeId: 'gen_1',
      orgId: 'org_1',
      patch: { heygenAvatarId: 'tp_abc', heygenAvatarKind: 'talking_photo' },
    });
    expect(out.heygenAvatarKind).toBe('talking_photo');
  });

  it('passes the photo straight through to the vendor, bytes untouched by us', async () => {
    const avatar = client();
    await makeAvatarFromImage(avatar).handler(input, ctx());
    expect(avatar.fromImage).toHaveBeenCalledWith({
      imageUrl: 'https://storage.example/face.jpg',
      contentType: 'image/jpeg',
    });
  });

  it('leaves the genome untouched when HeyGen rejects the photo', async () => {
    const patchConstraints = vi.fn<ScopedDb['genomes']['patchConstraints']>(async ({ genomeId }) => ({
      id: genomeId,
      version: 4,
    }));

    await expect(
      makeAvatarFromImage(client({ throws: new ToolError('UPSTREAM_FAILED', 'no face found', {}) })).handler(
        input,
        ctx({ patchConstraints }),
      ),
    ).rejects.toThrow(ToolError);

    expect(patchConstraints).not.toHaveBeenCalled();
  });

  it('refuses a genomeId that is not the active one', async () => {
    await expect(
      makeAvatarFromImage(client()).handler({ ...input, genomeId: 'gen_OTHER' }, ctx()),
    ).rejects.toMatchObject({ code: 'ISOLATION_VIOLATION' });
  });
});
