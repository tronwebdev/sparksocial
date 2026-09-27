import { describe, expect, it } from 'vitest';
import { runOnce, type RenderQueueDeps } from '../src/render-queue.js';

/**
 * The render queue — what it renders, and what it refuses to.
 *
 * Drafting writes the script; `compose.render` makes the file, and nothing
 * called it. Activating a thirty-day campaign produced eleven scripts and zero
 * pixels, with the calendar and the campaign both saying "video" and nothing
 * anywhere saying there wasn't one.
 *
 * Most of what is pinned below is about *not* spending. A render is tens of
 * seconds of CPU and real money, so every skip is a decision worth keeping.
 */

const genome = { workspace_id: 'ws_1' } as never;

type Pending = { id: string; orgId: string; genomeId: string; playbookId: string | null; copy: unknown };

function harness(over: { pending?: Pending[]; result?: unknown } = {}) {
  const calls: Array<{ tool: string; input: Record<string, unknown>; idempotencyKey?: string }> = [];
  const d = {
    source: { findUnrendered: async () => over.pending ?? [] },
    db: { genomes: { get: async () => genome } },
    invoke: {} as never,
    loadBrandGovernance: async () => ({}) as never,
    invokeTool: (async (req: { tool: string; input: Record<string, unknown>; idempotencyKey?: string }) => {
      calls.push({ tool: req.tool, input: req.input, idempotencyKey: req.idempotencyKey });
      return over.result ?? { status: 'succeeded', output: { renders: [{ aspect: '9:16', url: 'u' }] } };
    }) as unknown as RenderQueueDeps['invokeTool'],
  } as unknown as RenderQueueDeps;
  return { d, calls };
}

/** A video playbook that really exists in the library. */
const VIDEO: Pending = {
  id: 'c_video',
  orgId: 'o',
  genomeId: 'g',
  playbookId: 'pb_voice_over_broll',
  copy: [{ kind: 'text', beatId: 'hook', text: 'a hook' }],
};

describe('render queue', () => {
  it('renders a video post that has copy', async () => {
    // The positive case, without which every assertion below could pass on a
    // loop that does nothing at all.
    const { d, calls } = harness({ pending: [VIDEO] });
    await runOnce(d);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.tool).toBe('compose.render');
    expect(calls[0]!.input).toEqual({ genomeId: 'g', contentItemId: 'c_video' });
  });

  it('keys on the item, so a retried tick cannot bill twice', async () => {
    const { d, calls } = harness({ pending: [VIDEO] });
    await runOnce(d);
    await runOnce(d);
    expect(new Set(calls.map((c) => c.idempotencyKey)).size).toBe(1);
  });

  it('never asks the query for a format with no pixels', async () => {
    /*
     * The exclusion moved into the query after the loop version deadlocked: a
     * batch of two, ordered oldest first, was permanently held by two old text
     * posts and nothing behind them ever rendered. Asserting on the argument
     * is what pins the fix — a skip inside the loop would pass a test that
     * only looked at `calls`.
     */
    let excluded: string[] | undefined;
    const { d } = harness({ pending: [VIDEO] });
    (d as { source: { findUnrendered: unknown } }).source = {
      findUnrendered: async (_n: number, ex?: string[]) => {
        excluded = ex;
        return [VIDEO];
      },
    };
    await runOnce(d);
    expect(excluded).toContain('pb_text_update');
  });

  it('skips a post whose playbook no longer resolves', async () => {
    // Its media type is unknowable, and guessing costs money.
    const { d, calls } = harness({ pending: [{ ...VIDEO, playbookId: 'pb_gone_forever' }] });
    await runOnce(d);
    expect(calls).toHaveLength(0);
  });

  it('skips a post with no playbook at all', async () => {
    const { d, calls } = harness({ pending: [{ ...VIDEO, playbookId: null }] });
    await runOnce(d);
    expect(calls).toHaveLength(0);
  });

  it('leaves a post alone when rendering fails', async () => {
    /*
     * A post that failed to render is still a perfectly good post — it has its
     * copy, and `publish.now` can send a caption without a file. Blocking it
     * would take a working post off the calendar because its optional half
     * failed.
     */
    const { d } = harness({
      pending: [VIDEO],
      result: { status: 'failed', error: { message: 'compositor down' } },
    });
    await expect(runOnce(d)).resolves.toBeUndefined();
  });

  it('keeps going when one item throws', async () => {
    // One bad row must not stall the queue behind it.
    const calls: string[] = [];
    const d = harness({ pending: [{ ...VIDEO, id: 'bad' }, { ...VIDEO, id: 'good' }] }).d;
    let first = true;
    (d as { invokeTool: unknown }).invokeTool = async (req: { input: { contentItemId: string } }) => {
      calls.push(req.input.contentItemId);
      if (first) {
        first = false;
        throw new Error('boom');
      }
      return { status: 'succeeded', output: { renders: [] } };
    };
    await runOnce(d);
    expect(calls).toEqual(['bad', 'good']);
  });
});
