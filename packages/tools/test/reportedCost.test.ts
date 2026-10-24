import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, type ToolCtx } from '../src/defineTool.js';
import { register, __resetRegistry } from '../src/registry.js';
import { invokeTool, type InvokeDeps, type InvokeRequest } from '../src/invoke.js';

/**
 * The ledger recorded the estimate, always.
 *
 * `estimateCents` is a pre-flight ceiling — the policy has to check something
 * before the vendor is called — and every one of them in this codebase
 * describes itself as "a rough per-call ceiling". Charging it verbatim makes
 * the credit balance a record of guesses rather than of spending, and the
 * guesses were out by multiples: `content.generate_broll` estimated 40¢
 * against a measured $1.04 for five seconds of video.
 *
 * `ctx.reportCost` is the correction afterwards, from the only party that can
 * know. A handler that cannot find out stays silent and the estimate stands,
 * which is what happens nearly everywhere.
 */
function spender(handler: (input: unknown, ctx: ToolCtx) => Promise<unknown>, estimate = 40) {
  return defineTool({
    name: 'test.spend',
    version: 1,
    summary: 'A paid tool, for testing what the ledger is charged.',
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    effect: 'spend',
    autonomy: 'auto',
    scopes: ['owner'],
    idempotent: false,
    estimateCents: () => estimate,
    handler: handler as never,
  });
}

function ctx(): ToolCtx {
  return {
    orgId: 'org_1',
    brandId: 'brand_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 100_000, monthlyCapCents: 100_000 },
    db: {} as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

/** Charges the ledger for one call of `test.spend`, and hands back what it recorded. */
async function charge(handler: (input: unknown, ctx: ToolCtx) => Promise<unknown>) {
  __resetRegistry();
  register(spender(handler));

  const recorded: Array<{ costCents: number }> = [];
  const res = await invokeTool(
    {
      tool: 'test.spend',
      input: {},
      caller: 'user',
      // `idempotent: false` requires one, the same refusal `compose.static`
      // gives a caller that forgets it.
      idempotencyKey: 'test-key-1',
      ctx: ctx(),
      brand: { createdAt: new Date('2026-01-01T00:00:00Z'), approvalMode: 'autopublish' },
    } as InvokeRequest,
    {
      writeToolCall: async () => {},
      recordCost: async (r) => void recorded.push(r as { costCents: number }),
      newId: () => 'call_1',
      now: () => new Date('2026-10-24T12:00:00Z'),
    } as InvokeDeps,
  );
  /*
   * The diagnostic stays. Writing this test, every assertion failed as
   * "expected undefined to match object" — which says the ledger was not
   * charged and nothing about why. It was an `INVALID_INPUT` before the policy
   * even ran, for a missing idempotency key. One line turns a silent empty
   * array into the reason.
   */
  if (recorded.length === 0 && res.status !== 'succeeded') {
    throw new Error(`invoke did not succeed: ${JSON.stringify(res).slice(0, 300)}`);
  }
  return recorded;
}

describe('what the ledger is charged', () => {
  it('falls back to the estimate when the handler says nothing', async () => {
    const recorded = await charge(async () => ({ ok: true }));

    expect(recorded[0]).toMatchObject({ costCents: 40 });
  });

  it('charges what the handler reports instead', async () => {
    const recorded = await charge(async (_i, c) => {
      c.reportCost?.(104);
      return { ok: true };
    });

    expect(recorded[0]).toMatchObject({ costCents: 104 });
  });

  /*
   * A retry should report the total for the call, not each attempt — so a
   * later report replaces an earlier one rather than adding to it.
   */
  it('takes the last word, not the sum', async () => {
    const recorded = await charge(async (_i, c) => {
      c.reportCost?.(50);
      c.reportCost?.(104);
      return { ok: true };
    });

    expect(recorded[0]).toMatchObject({ costCents: 104 });
  });

  /* A refund belongs in `credits.grant`, not in a tool claiming to have earned. */
  it('never charges a negative', async () => {
    const recorded = await charge(async (_i, c) => {
      c.reportCost?.(-20);
      return { ok: true };
    });

    expect(recorded[0]).toMatchObject({ costCents: 0 });
  });

  /*
   * A reported true zero still writes a row: "this cost nothing" is a fact
   * worth recording about a tool that charges.
   */
  it('still records a row for a paid tool that turned out free', async () => {
    const recorded = await charge(async (_i, c) => {
      c.reportCost?.(0);
      return { ok: true };
    });

    expect(recorded).toHaveLength(1);
  });
});
