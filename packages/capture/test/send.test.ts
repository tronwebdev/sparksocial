import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { ToolError } from '@sparksocial/shared';
import { makeSessionSend } from '../src/send.js';
import { createStubTransport, redactRecipient } from '../src/transport.js';
import type { CaptureBrief } from '../src/schema.js';

/**
 * The send step is the only part of the capture loop that spends the owner's
 * attention. §6.3 is explicit that getting the cadence wrong — "never send
 * briefs one at a time", "local business owners will not respond to daily
 * nags" — is what makes the whole loop fail, so the properties tested here are
 * cadence and privacy rather than delivery mechanics.
 */

const brief = (id: string): CaptureBrief => ({
  brief_id: id,
  playbook_id: 'pb_craft_capture',
  subject: 'the fade finishing, up close',
  framing: 'tight on the clippers',
  orientation: 'vertical',
  duration_sec: 15,
  motion: 'slow pan',
  audio: 'ambient only',
  lighting: 'the window you already use',
  do_not: ['no talking to camera'],
  estimated_effort_sec: 60,
  expires_at: '2026-08-15T00:00:00.000Z',
});

const ctx = () =>
  ({
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {} as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  }) as unknown as ToolCtx;

describe('redactRecipient', () => {
  it('keeps only the last four characters', () => {
    // This string lands in `tool_calls`, which is queried, exported and read by
    // support. Enough to identify the owner in conversation, not enough to be a
    // contact list.
    expect(redactRecipient('+2348012345678')).toBe('**********5678');
    expect(redactRecipient('  +2348012345678  ')).toBe('**********5678');
  });

  it('does not leak a short value by leaving it intact', () => {
    expect(redactRecipient('1234')).toBe('****');
    expect(redactRecipient('99')).toBe('**');
  });
});

describe('direct.session.send', () => {
  const tool = makeSessionSend(createStubTransport());

  it('declares itself external and non-idempotent — a retry must not re-nag', () => {
    // The heart of §6.3's cadence rule expressed as a registry contract: with
    // `idempotent: false`, invokeTool requires a key and replays the first
    // result instead of sending a second time.
    expect(tool.effect).toBe('external');
    expect(tool.idempotent).toBe(false);
  });

  it('runs unattended — asking is the product working, not a decision to approve', () => {
    expect(tool.autonomy).toBe('auto');
  });

  it('sends the whole session in one message', async () => {
    const transport = createStubTransport();
    const t = makeSessionSend(transport);

    const out = await t.handler(
      { genomeId: 'gen_barber', to: '+2348012345678', briefs: [brief('b1'), brief('b2'), brief('b3')], totalEffortSec: 180 },
      ctx(),
    );

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.briefCount).toBe(3);
    expect(out.briefCount).toBe(3);
    expect(out.messageId).toBeTruthy();
  });

  it('never returns the raw recipient', async () => {
    const out = await tool.handler(
      { genomeId: 'gen_barber', to: '+2348012345678', briefs: [brief('b1')], totalEffortSec: 60 },
      ctx(),
    );

    expect(out.toRedacted).toBe('**********5678');
    expect(JSON.stringify(out)).not.toContain('2348012345');
  });

  it('refuses a session over the five-minute filming budget', async () => {
    // Re-checked here and not only in the batcher, because this tool is
    // reachable on its own — by SPARK, or by a caller assembling briefs another
    // way — and the budget is a promise to the owner, not a batching detail.
    await expect(
      tool.handler(
        { genomeId: 'gen_barber', to: '+234801', briefs: [brief('b1')], totalEffortSec: 601 },
        ctx(),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('accepts a session exactly at the budget', async () => {
    const out = await tool.handler(
      { genomeId: 'gen_barber', to: '+234801', briefs: [brief('b1')], totalEffortSec: 300 },
      ctx(),
    );
    expect(out.briefCount).toBe(1);
  });

  it('caps a session at five briefs and requires at least one, at the schema', () => {
    // §6.3: "3–5 briefs, ~5 minutes total, one sitting."
    const many = { genomeId: 'g', to: '+234', briefs: Array.from({ length: 6 }, (_, i) => brief(`b${i}`)), totalEffortSec: 60 };
    expect(tool.input.safeParse(many).success).toBe(false);
    expect(tool.input.safeParse({ genomeId: 'g', to: '+234', briefs: [], totalEffortSec: 60 }).success).toBe(false);
  });

  it('reports the channel it actually used, so the audit row is not guesswork', async () => {
    const out = await tool.handler(
      { genomeId: 'gen_barber', to: '+234801', briefs: [brief('b1')], totalEffortSec: 60 },
      ctx(),
    );
    expect(out.channel).toBe('stub');
  });
});
