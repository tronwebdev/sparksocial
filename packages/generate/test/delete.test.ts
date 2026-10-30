import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { evaluate } from '@sparksocial/tools/policy';
import { contentDelete } from '../src/delete.js';

/**
 * `content.delete` — the Remove control the calendar and Plan Queue drew and
 * had to disable, because nothing could remove a post.
 */

function ctx(result: { deleted: boolean; status?: string }, genomeId = 'gen_1') {
  const del = vi.fn(async () => result);
  const c = {
    orgId: 'org_1',
    genomeId,
    role: 'owner',
    db: { content: { delete: del } },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as ToolCtx;
  return { c, del };
}

describe('content.delete', () => {
  it('removes a post that has not been published and says what it was', async () => {
    const { c, del } = ctx({ deleted: true, status: 'scheduled' });
    const out = await contentDelete.handler({ contentItemId: 'ci_1', genomeId: 'gen_1' }, c);
    expect(out).toEqual({ deleted: true, contentItemId: 'ci_1', status: 'scheduled' });
    expect(del).toHaveBeenCalledWith({ id: 'ci_1', genomeId: 'gen_1', orgId: 'org_1' });
  });

  it('refuses a published post, and says why rather than "not found"', async () => {
    // Its record is what analytics and learning read; deleting it would not
    // take the post down from the platform.
    const { c } = ctx({ deleted: false, status: 'published' });
    await expect(contentDelete.handler({ contentItemId: 'ci_1', genomeId: 'gen_1' }, c)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/already been published/),
    });
  });

  it('answers NOT_FOUND for a post that does not exist', async () => {
    const { c } = ctx({ deleted: false });
    await expect(contentDelete.handler({ contentItemId: 'ghost', genomeId: 'gen_1' }, c)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses another brand’s post without touching the store', async () => {
    const { c, del } = ctx({ deleted: true, status: 'draft' }, 'gen_other');
    await expect(contentDelete.handler({ contentItemId: 'ci_1', genomeId: 'gen_1' }, c)).rejects.toMatchObject({
      code: 'ISOLATION_VIOLATION',
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('is destructive, so policy holds it for approval even for an owner', () => {
    const decision = evaluate({
      caller: 'user',
      role: 'owner',
      tool: {
        name: contentDelete.name,
        effect: contentDelete.effect,
        autonomy: contentDelete.autonomy,
        scopes: contentDelete.scopes,
      },
      brand: { approvalMode: 'autopublish', agentPaused: false },
      budget: { estimatedCents: 0, remainingCents: 10_000 },
    } as unknown as Parameters<typeof evaluate>[0]);
    expect(decision).toMatchObject({ kind: 'approval', ruleId: 'effect.destructive' });
  });
});
