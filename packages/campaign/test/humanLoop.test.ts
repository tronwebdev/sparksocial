import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { evaluate } from '@sparksocial/tools';
import type { HumanLoopStore, HumanMessage, ToolCtx } from '@sparksocial/tools';
import { humanAnswer, humanAsk, humanNotify, humanPending } from '../src/humanLoop.js';

/**
 * `human.*` — what SPARK says to a person.
 *
 * The tests that matter are about the asymmetries: ask is expensive and notify
 * is not, and an answer is the owner's word rather than the agent's.
 */

function store(seed: HumanMessage[] = []): HumanLoopStore & { rows: HumanMessage[] } {
  const rows = [...seed];
  let n = 0;
  return {
    rows,
    async create({ brandId, kind, body, options, urgency, runId }) {
      const row: HumanMessage = {
        id: `hm_${++n}`,
        brandId,
        kind,
        body,
        urgency,
        createdAt: new Date(),
        ...(options?.length ? { options } : {}),
        ...(runId ? { runId } : {}),
      };
      rows.push(row);
      return row;
    },
    async get(id) {
      return rows.find((r) => r.id === id);
    },
    async listPending(brandId, _orgId, limit) {
      return rows
        .filter((r) => r.brandId === brandId && r.kind === 'ask' && !r.answeredAt)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit);
    },
    async answer({ id, answer, by }) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.kind !== 'ask' || row.answeredAt) return undefined;
      row.answer = answer;
      row.answeredAt = new Date();
      row.answeredBy = by;
      return row;
    },
    async markDelivered(id, _orgId, channel) {
      const row = rows.find((r) => r.id === id);
      if (row) row.channel = channel;
    },
  };
}

const ctx = (s: HumanLoopStore, over: Partial<ToolCtx> = {}): ToolCtx =>
  ({
    orgId: 'org_1',
    brandId: 'brand_1',
    userId: 'user_owner',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: { humanLoop: s } as unknown as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  }) as unknown as ToolCtx;

describe('the registry contract', () => {
  it('both leave the building, so both are external', () => {
    // Not `write`. These reach a person on a channel that costs money per
    // message and cannot be recalled; classifying them as ordinary writes
    // would let them past the rung that exists for exactly this.
    expect(humanAsk.effect).toBe('external');
    expect(humanNotify.effect).toBe('external');
  });

  it('asking is not idempotent and notifying is', () => {
    // The asymmetry the whole design rests on. A duplicate notification is
    // noise; a duplicate *question* is an inbox nobody can clear.
    expect(humanAsk.idempotent).toBe(false);
    expect(humanNotify.idempotent).toBe(true);
  });

  it('SPARK may ask but may never answer', () => {
    // An agent that could answer its own question would produce an audit row
    // saying a person decided. This is the line that forecloses it.
    expect(humanAsk.autonomy).toBe('auto');
    expect(humanAnswer.autonomy).toBe('human_only');
  });

  it('the policy engine actually denies the agent answering', () => {
    // The registry field is a declaration; this is the enforcement.
    const decision = evaluate({
      tool: { name: 'human.answer', effect: 'write', autonomy: 'human_only', scopes: ['owner'] },
      caller: 'agent',
      role: 'owner',
      now: new Date(),
      brand: { createdAt: new Date('2026-01-01T00:00:00Z'), approvalMode: 'autopublish', agentPaused: false },
      budget: { remainingCents: 10_000, estimatedCents: 0 },
    });

    expect(decision.kind).toBe('deny');
    expect(decision.kind === 'deny' && decision.ruleId).toBe('autonomy.human_only');
  });
});

describe('human.ask', () => {
  it('records the question with its options and run', async () => {
    const s = store();
    const out = await humanAsk.handler(
      { question: 'Which fade should lead this week?', options: ['Low', 'Skin'], urgency: 'normal' },
      ctx(s, { runId: 'run_9' }),
    );

    expect(out.kind).toBe('ask');
    expect(out.pendingDelivery).toBe(true);
    // Correlating to the run is what lets the Timeline render "waited 4 hours
    // on the owner" instead of an unexplained gap.
    expect(s.rows[0]!.runId).toBe('run_9');
    expect(s.rows[0]!.options).toEqual(['Low', 'Skin']);
  });

  it('caps the question at something a phone can display', async () => {
    expect(humanAsk.input.safeParse({ question: 'x'.repeat(601) }).success).toBe(false);
    expect(humanAsk.input.safeParse({ question: 'ok' }).success).toBe(true);
  });

  it('refuses more than five options', async () => {
    // A list of nine choices on WhatsApp is not a question, it is a form.
    const nine = Array.from({ length: 9 }, (_, i) => `opt${i}`);
    expect(humanAsk.input.safeParse({ question: 'q', options: nine }).success).toBe(false);
  });

  it('needs a brand — a question is addressed to one', async () => {
    await expect(humanAsk.handler({ question: 'q', urgency: 'normal' }, ctx(store(), { brandId: undefined })))
      .rejects.toThrow(ToolError);
  });
});

describe('human.pending — the inbox', () => {
  it('lists unanswered questions oldest first', async () => {
    const s = store();
    await humanAsk.handler({ question: 'first', urgency: 'normal' }, ctx(s));
    await humanAsk.handler({ question: 'second', urgency: 'normal' }, ctx(s));

    const out = await humanPending.handler({ limit: 20 }, ctx(s));
    // The question blocking longest is the one costing the most; a newest-first
    // inbox buries it.
    expect(out.questions.map((q) => q.question)).toEqual(['first', 'second']);
  });

  it('excludes notifications — they are not questions', async () => {
    const s = store();
    await humanNotify.handler({ message: 'Published the fade clip.', urgency: 'low' }, ctx(s));

    expect((await humanPending.handler({ limit: 20 }, ctx(s))).questions).toHaveLength(0);
  });

  it('drops a question once answered', async () => {
    const s = store();
    const asked = await humanAsk.handler({ question: 'q', urgency: 'normal' }, ctx(s));
    await humanAnswer.handler({ messageId: asked.messageId, answer: 'the skin fade' }, ctx(s));

    expect((await humanPending.handler({ limit: 20 }, ctx(s))).questions).toHaveLength(0);
  });

  it('reports how long each has been blocking', async () => {
    const s = store([
      { id: 'hm_old', brandId: 'brand_1', kind: 'ask', body: 'q', urgency: 'high',
        createdAt: new Date(Date.now() - 5 * 3_600_000) },
    ]);

    const out = await humanPending.handler({ limit: 20 }, ctx(s));
    expect(out.questions[0]!.waitingHours).toBeCloseTo(5, 1);
  });
});

describe('human.answer', () => {
  it('records the answer against the question', async () => {
    const s = store();
    const asked = await humanAsk.handler({ question: 'q', urgency: 'normal' }, ctx(s));
    const out = await humanAnswer.handler({ messageId: asked.messageId, answer: 'the skin fade' }, ctx(s));

    expect(out.answered).toBe(true);
    expect(s.rows[0]!.answer).toBe('the skin fade');
    expect(s.rows[0]!.answeredBy).toBe('user_owner');
  });

  it('refuses a second answer', async () => {
    // Write-once. A late second answer is far more often a double-tap than a
    // dispute, and overwriting silently changes a decision SPARK may have acted on.
    const s = store();
    const asked = await humanAsk.handler({ question: 'q', urgency: 'normal' }, ctx(s));
    await humanAnswer.handler({ messageId: asked.messageId, answer: 'first' }, ctx(s));

    await expect(humanAnswer.handler({ messageId: asked.messageId, answer: 'second' }, ctx(s)))
      .rejects.toThrow(ToolError);
    expect(s.rows[0]!.answer).toBe('first');
  });

  it('refuses to answer a notification', async () => {
    const s = store();
    const noted = await humanNotify.handler({ message: 'fyi', urgency: 'low' }, ctx(s));

    await expect(humanAnswer.handler({ messageId: noted.messageId, answer: 'ok' }, ctx(s)))
      .rejects.toThrow(ToolError);
  });

  it('requires an attributable person', async () => {
    // `human_only` already blocks the agent, but a session with no user id
    // would leave the record unable to say who decided.
    const s = store();
    const asked = await humanAsk.handler({ question: 'q', urgency: 'normal' }, ctx(s));

    await expect(
      humanAnswer.handler({ messageId: asked.messageId, answer: 'x' }, ctx(s, { userId: undefined })),
    ).rejects.toThrow(ToolError);
  });

  it('treats an unknown id and another org’s id identically', async () => {
    await expect(humanAnswer.handler({ messageId: 'hm_nope', answer: 'x' }, ctx(store())))
      .rejects.toThrow(ToolError);
  });
});
