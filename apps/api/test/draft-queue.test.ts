import { beforeEach, describe, expect, it } from 'vitest';
import { runOnce, __resetFailedForTest, type DraftQueueDeps } from '../src/draft-queue.js';

/**
 * The draft queue — writes a scheduled post's copy before it is due.
 *
 * The gap it closes: `calendar.generate` writes slots with no copy, the publish
 * scheduler drafts a slot only once it is *due* and publishes it in the same
 * tick, and the render queue only selects posts that already have copy. So a
 * slot nobody opened in the Draft Panel went out as a caption where the playbook
 * called for a video — with nothing logged as wrong and a published post on the
 * calendar.
 *
 * What is pinned below is mostly about *not* spending, like the render queue's
 * tests: a draft is a paid model call, and the batch is ordered and limited, so
 * every skip is load-bearing.
 */

const genome = { workspace_id: 'ws_1' } as never;

type Slot = {
  id: string;
  orgId: string;
  genomeId: string;
  playbookId: string | null;
  intent: string | null;
  scheduledAt: Date | null;
};

const slot = (over: Partial<Slot> = {}): Slot => ({
  id: 'c_1',
  orgId: 'o',
  genomeId: 'g',
  playbookId: 'pb_voice_over_broll',
  intent: null,
  scheduledAt: new Date('2026-10-20T09:00:00Z'),
  ...over,
});

function harness(over: { pending?: Slot[]; result?: unknown; genome?: unknown } = {}) {
  const calls: Array<{ tool: string; input: Record<string, unknown>; idempotencyKey?: string }> = [];
  const asked: Array<{ before: Date; limit: number }> = [];
  const d = {
    source: {
      findUndrafted: async (before: Date, limit: number) => {
        asked.push({ before, limit });
        return over.pending ?? [];
      },
    },
    db: { genomes: { get: async () => ('genome' in over ? over.genome : genome) } },
    invoke: {} as never,
    loadBrandGovernance: async () => ({}) as never,
    invokeTool: (async (req: { tool: string; input: Record<string, unknown>; idempotencyKey?: string }) => {
      calls.push({ tool: req.tool, input: req.input, idempotencyKey: req.idempotencyKey });
      return over.result ?? { status: 'succeeded', output: {} };
    }) as unknown as DraftQueueDeps['invokeTool'],
  } as unknown as DraftQueueDeps;
  return { d, calls, asked };
}

const DAY = 24 * 3_600_000;

beforeEach(() => __resetFailedForTest());

describe('what it asks the database for', () => {
  it('looks only as far ahead as the horizon it was given', async () => {
    const { d, asked } = harness();
    const before = Date.now() + 3 * DAY;

    await runOnce(d, 3 * DAY);

    // Within a second of now+horizon; the loop computes it off its own clock.
    expect(Math.abs(asked[0]!.before.getTime() - before)).toBeLessThan(1_000);
  });
});

describe('drafting', () => {
  it('drafts through the tool layer, so the call is policy-checked and billed', async () => {
    const { d, calls } = harness({ pending: [slot()] });

    await runOnce(d, 3 * DAY);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.tool).toBe('content.draft');
    expect(calls[0]!.input).toMatchObject({
      genomeId: 'g',
      playbookId: 'pb_voice_over_broll',
      contentItemId: 'c_1',
    });
  });

  /*
   * Distinct from the scheduler's `scheduled-draft:<id>` on purpose. Sharing the
   * key would hand the scheduler this loop's cached *failure* at due-time, so a
   * bad early draft would stop the post going out at all — turning the backstop
   * into the thing that breaks it.
   */
  it('uses its own idempotency key, not the one the publish scheduler uses', async () => {
    const { d, calls } = harness({ pending: [slot()] });

    await runOnce(d, 3 * DAY);

    expect(calls[0]!.idempotencyKey).toBe('ahead-draft:c_1');
    expect(calls[0]!.idempotencyKey).not.toContain('scheduled-draft');
  });

  it('never drafts more than one batch in a tick, however much work is waiting', async () => {
    const pending = Array.from({ length: 10 }, (_, i) => slot({ id: `c_${i}` }));
    const { d, calls } = harness({ pending });

    await runOnce(d, 3 * DAY);

    expect(calls.length).toBeLessThanOrEqual(3);
  });
});

describe('what it refuses to retry', () => {
  /*
   * The batch is ordered by `scheduled_at` and limited, so an item that can
   * never be drafted sits at the head and is retried on every tick forever while
   * everything behind it waits — the same head-of-line block
   * `findUnrenderedContentItems` documents having been caused once already, and
   * worse here because each retry is a paid model call.
   */
  it('does not ask twice for a slot the tool layer refused', async () => {
    const { d, calls } = harness({
      pending: [slot()],
      result: { status: 'failed', error: { message: 'no' } },
    });

    await runOnce(d, 3 * DAY);
    await runOnce(d, 3 * DAY);

    expect(calls).toHaveLength(1);
  });

  it('does not ask twice for a slot policy held', async () => {
    const { d, calls } = harness({
      pending: [slot()],
      result: { status: 'gated', decision: { kind: 'deny' } },
    });

    await runOnce(d, 3 * DAY);
    await runOnce(d, 3 * DAY);

    expect(calls).toHaveLength(1);
  });

  it('keeps working through a stuck item rather than starving behind it', async () => {
    /*
     * Attempts, not completed calls. The throw happens before the fake records
     * anything, which is the point — a slot that blows up mid-call leaves no
     * trace in `calls`, so counting those would say "never tried" for the one
     * case this test exists to pin.
     */
    const attempts: string[] = [];
    const { d, calls } = harness({ pending: [slot({ id: 'stuck' }), slot({ id: 'fine' })] });
    const inner = d.invokeTool!;
    d.invokeTool = (async (req: Parameters<typeof inner>[0], deps: Parameters<typeof inner>[1]) => {
      const id = (req.input as { contentItemId: string }).contentItemId;
      attempts.push(id);
      if (id === 'stuck') throw new Error('upstream blew up');
      return inner(req, deps);
    }) as typeof inner;

    await runOnce(d, 3 * DAY);
    await runOnce(d, 3 * DAY);

    // Tried once, then never again, however many ticks run.
    expect(attempts.filter((id) => id === 'stuck')).toHaveLength(1);
    // And the item behind it is still reached — both ticks, because this fake
    // never stops offering it.
    expect(calls.map((c) => (c.input as { contentItemId: string }).contentItemId)).toContain('fine');
  });

  it('skips a slot with no playbook instead of calling the tool with nothing', async () => {
    const { d, calls } = harness({ pending: [slot({ playbookId: null })] });

    await runOnce(d, 3 * DAY);

    expect(calls).toHaveLength(0);
  });

  it('skips a slot whose genome has gone', async () => {
    const { d, calls } = harness({ pending: [slot()], genome: undefined });

    await runOnce(d, 3 * DAY);

    expect(calls).toHaveLength(0);
  });
});
