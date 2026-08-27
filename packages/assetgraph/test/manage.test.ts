import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { assetArchive, makeAssetCaptionSet } from '../src/manage.js';

/**
 * `LIB-02`'s two per-row actions — the trash icon and the editable meta
 * description — neither of which had a tool. Ten `asset.*` tools existed and
 * every one was about getting an asset *in* or *choosing* one; nothing could
 * change or retire one afterwards.
 */

function ctx(over: { setArchived?: unknown; setCaption?: unknown } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    userId: 'user_owner',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      assets: {
        setArchived:
          over.setArchived ??
          (async ({ archived }: { archived: boolean }) => ({
            id: 'asset_1',
            archivedAt: archived ? new Date('2026-08-27T10:00:00Z') : null,
          })),
        setCaption:
          over.setCaption ?? (async ({ caption }: { caption: string }) => ({ id: 'asset_1', caption })),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const target = { genomeId: 'gen_1', assetId: 'asset_1' };

describe('asset.archive', () => {
  it('is a write, not a destructive effect', () => {
    /**
     * Deliberate. Nothing is destroyed and the same tool reverses it, so marking
     * it destructive would put tidying a library behind the containment gate that
     * exists for irreversible things.
     */
    expect(assetArchive.effect).toBe('write');
  });

  it('archives, and reports when', async () => {
    const out = await assetArchive.handler({ ...target, archived: true }, ctx());
    expect(out).toMatchObject({ assetId: 'asset_1', archived: true });
    expect(out.archivedAt).toBe('2026-08-27T10:00:00.000Z');
  });

  it('restores through the same tool, and then reports no date', async () => {
    // Undo has to be as easy as the thing it undoes — a separate `asset.restore`
    // would be a second tool and a second scope list to keep in step.
    const out = await assetArchive.handler({ ...target, archived: false }, ctx());
    expect(out.archived).toBe(false);
    expect(out).not.toHaveProperty('archivedAt');
  });

  it('defaults to archiving when the caller does not say', async () => {
    expect(assetArchive.input.parse({ genomeId: 'g', assetId: 'a' }).archived).toBe(true);
  });

  it('404s for an asset in another brand rather than reporting success', async () => {
    // The scoped write returns undefined out of scope, and that must not read as
    // "archived" — a caller would otherwise learn an id exists elsewhere.
    await expect(
      assetArchive.handler({ ...target, archived: true }, ctx({ setArchived: async () => undefined })),
    ).rejects.toBeInstanceOf(ToolError);
  });
});

describe('asset.caption.set', () => {
  const embed = { embed: vi.fn(async () => Array.from({ length: 8 }, () => 0.25)) };

  it('re-embeds the new caption, because the caption *is* the asset to retrieval', async () => {
    // The assertion that matters. Saving the words without re-embedding would
    // leave the library showing one thing and the graph matching on another, and
    // retrieval would keep working — against text nobody can see any more.
    embed.embed.mockClear();
    const setCaption = vi.fn(async ({ caption }: { caption: string }) => ({ id: 'asset_1', caption }));
    const tool = makeAssetCaptionSet(embed);

    await tool.handler({ ...target, caption: 'the scheduler screen, dark mode' }, ctx({ setCaption }));

    expect(embed.embed).toHaveBeenCalledWith('the scheduler screen, dark mode');
    expect(setCaption).toHaveBeenCalledWith(
      expect.objectContaining({ caption: 'the scheduler screen, dark mode', embedding: expect.any(Array) }),
    );
  });

  it('trims before embedding, so stray whitespace cannot change the vector', async () => {
    embed.embed.mockClear();
    const tool = makeAssetCaptionSet(embed);
    await tool.handler({ ...target, caption: '  a tidy caption  ' }, ctx());
    expect(embed.embed).toHaveBeenCalledWith('a tidy caption');
  });

  it('costs something, because it spends an embedding call', () => {
    const tool = makeAssetCaptionSet(embed);
    expect(tool.estimateCents?.({})).toBe(1);
  });

  it('rejects a caption too long to embed as one idea', () => {
    const tool = makeAssetCaptionSet(embed);
    expect(tool.input.safeParse({ ...target, caption: 'x'.repeat(401) }).success).toBe(false);
    expect(tool.input.safeParse({ ...target, caption: 'ab' }).success).toBe(false);
  });

  it('404s out of scope', async () => {
    const tool = makeAssetCaptionSet(embed);
    await expect(
      tool.handler({ ...target, caption: 'a caption' }, ctx({ setCaption: async () => undefined })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
