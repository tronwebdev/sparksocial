import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { contentBeatUpdate } from '../src/beatUpdate.js';
import type { ResolvedBeat } from '../src/draft.js';

/**
 * `content.beat.update` — closes the gap where a hand-edited caption in the
 * Draft Panel updated only local React state and was silently lost on
 * publish. Scoped narrowly on purpose: only `text`-kind beats are a value
 * with meaning of their own to save directly.
 */

const BEATS: ResolvedBeat[] = [
  { kind: 'text', beatId: 'hook', text: 'Original hook.' },
  { kind: 'text', beatId: 'cta', text: 'Book now.' },
  { kind: 'generated_image', beatId: 'image', url: 'https://x.example/i.png', prompt: 'a product photo' },
];

function ctx(over: {
  get?: ScopedDb['content']['get'];
  updateDraft?: ScopedDb['content']['updateDraft'];
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('not used in this test'); },
        get:
          over.get ??
          (async () => ({
            id: 'ci_1',
            genomeId: 'gen_1',
            playbookId: 'pb_x',
            mode: 'assemble' as const,
            status: 'draft',
            copy: BEATS,
            why: { summary: 'test', factors: [], evidence: [], alternatives: [] },
            createdAt: new Date(),
          })),
        updateDraft:
          over.updateDraft ??
          (async (args) => ({
            id: args.id,
            genomeId: args.genomeId,
            playbookId: 'pb_x',
            mode: 'assemble' as const,
            status: 'draft',
            copy: args.copy,
            why: args.why,
            createdAt: new Date(),
          })),
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('content.beat.update', () => {
  it('saves the new text and leaves every other beat untouched', async () => {
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_x', mode: 'assemble' as const,
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));

    const out = await contentBeatUpdate.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1', beatId: 'hook', text: 'A sharper hook.' },
      ctx({ updateDraft }),
    );

    expect(out.beats.find((b) => b.beatId === 'hook')).toEqual({ kind: 'text', beatId: 'hook', text: 'A sharper hook.' });
    // Untouched: the CTA is pulled verbatim from the genome and must survive an unrelated edit.
    expect(out.beats.find((b) => b.beatId === 'cta')).toEqual({ kind: 'text', beatId: 'cta', text: 'Book now.' });
    expect(out.beats.find((b) => b.beatId === 'image')).toEqual(BEATS[2]);

    expect(updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ci_1', genomeId: 'gen_1', orgId: 'org_1' }),
    );
  });

  it('refuses to edit a generated beat directly — that goes through regeneration', async () => {
    await expect(
      contentBeatUpdate.handler({ contentItemId: 'ci_1', genomeId: 'gen_1', beatId: 'image', text: 'new prompt' }, ctx()),
    ).rejects.toThrow(/not text/);
  });

  it('throws NOT_FOUND for a beat id that does not exist on the draft', async () => {
    await expect(
      contentBeatUpdate.handler({ contentItemId: 'ci_1', genomeId: 'gen_1', beatId: 'nope', text: 'x' }, ctx()),
    ).rejects.toThrow(ToolError);
  });

  it('throws NOT_FOUND for a draft that does not exist or is out of scope', async () => {
    await expect(
      contentBeatUpdate.handler(
        { contentItemId: 'ci_missing', genomeId: 'gen_1', beatId: 'hook', text: 'x' },
        ctx({ get: async () => undefined }),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('is idempotent — saving the same text twice is a safe replay, not a new edit', () => {
    expect(contentBeatUpdate.idempotent).toBe(true);
  });
});
