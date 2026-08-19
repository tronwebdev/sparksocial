import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { makeLinkShorten } from '../src/linkTool.js';
import type { DubClient } from '../src/dub.js';

function ctx(over: { genomeGet?: () => Promise<unknown>; ctaLinksCreate?: ReturnType<typeof vi.fn> } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        patchConstraints: async () => ({ id: 'g', version: 1 }),
        get: over.genomeGet ?? (async () => ({ identity: { business_name: 'Emeka Cuts' } })),
        listForOrg: async () => [],
      },
      ctaLinks: {
        create: over.ctaLinksCreate ?? vi.fn(async (args: unknown) => args),
        listForItems: async () => [],
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function stubDub(): DubClient & { shorten: ReturnType<typeof vi.fn> } {
  return {
    shorten: vi.fn(async () => ({ linkId: 'link_1', shortUrl: 'https://dub.sh/abc', destinationUrl: 'https://example.com' })),
    getClicks: vi.fn(async () => ({ clicks: 0 })),
  };
}

describe('link.shorten', () => {
  it('tags the link with the genome id and any extra tags', async () => {
    const dub = stubDub();
    const tool = makeLinkShorten(dub);
    await tool.handler({ genomeId: 'gen_1', url: 'https://example.com/book', tags: ['launch'] }, ctx());

    expect(dub.shorten).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/book', tags: ['gen_1', 'launch'] }),
    );
  });

  it('uses the genome\'s business name as the UTM campaign when available', async () => {
    const dub = stubDub();
    const tool = makeLinkShorten(dub);
    await tool.handler({ genomeId: 'gen_1', url: 'https://example.com' }, ctx());

    expect(dub.shorten).toHaveBeenCalledWith(
      expect.objectContaining({ utm: expect.objectContaining({ campaign: 'Emeka Cuts', source: 'sparksocial' }) }),
    );
  });

  it('falls back to the genome id when the genome cannot be found', async () => {
    const dub = stubDub();
    const tool = makeLinkShorten(dub);
    await tool.handler({ genomeId: 'gen_x', url: 'https://example.com' }, ctx({ genomeGet: async () => undefined }));

    expect(dub.shorten).toHaveBeenCalledWith(expect.objectContaining({ utm: expect.objectContaining({ campaign: 'gen_x' }) }));
  });

  it('returns the shortened link', async () => {
    const tool = makeLinkShorten(stubDub());
    const out = await tool.handler({ genomeId: 'gen_1', url: 'https://example.com' }, ctx());
    expect(out).toEqual({ shortUrl: 'https://dub.sh/abc', destinationUrl: 'https://example.com' });
  });

  it('is a plain write, not gated behind approval — infrastructure, not a decision', () => {
    const tool = makeLinkShorten(stubDub());
    expect(tool.effect).toBe('write');
    expect(tool.autonomy).toBe('auto');
  });

  it('refuses an invalid URL at the schema, before the tool runs', () => {
    const tool = makeLinkShorten(stubDub());
    expect(tool.input.safeParse({ genomeId: 'gen_1', url: 'not a url' }).success).toBe(false);
  });

  describe('contentItemId attribution', () => {
    it('persists the link when contentItemId is given', async () => {
      const ctaLinksCreate = vi.fn(async (args: unknown) => args);
      const tool = makeLinkShorten(stubDub());
      await tool.handler({ genomeId: 'gen_1', url: 'https://example.com/book', contentItemId: 'ci_1' }, ctx({ ctaLinksCreate }));

      expect(ctaLinksCreate).toHaveBeenCalledWith({
        genomeId: 'gen_1',
        orgId: 'org_1',
        contentItemId: 'ci_1',
        dubLinkId: 'link_1',
        shortUrl: 'https://dub.sh/abc',
        destinationUrl: 'https://example.com',
      });
    });

    it('does not persist anything when contentItemId is omitted — the link still works, just unattributed', async () => {
      const ctaLinksCreate = vi.fn(async (args: unknown) => args);
      const tool = makeLinkShorten(stubDub());
      const out = await tool.handler({ genomeId: 'gen_1', url: 'https://example.com/book' }, ctx({ ctaLinksCreate }));

      expect(ctaLinksCreate).not.toHaveBeenCalled();
      expect(out).toEqual({ shortUrl: 'https://dub.sh/abc', destinationUrl: 'https://example.com' });
    });
  });
});
