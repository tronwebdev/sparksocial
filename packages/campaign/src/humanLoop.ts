import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `human.ask` / `human.notify` — plan §3.2, the other half of the Command Center.
 *
 * The `agent.*` tools are what a person does *to* SPARK. These are what SPARK
 * does to a person, and an autonomous agent needs both: one that can only act or
 * stop has exactly two ways to handle a question it cannot answer — guess, or
 * fail. Neither is what an owner wants when the real answer is thirty seconds of
 * their attention.
 *
 * ── ask is not notify, and the difference is the whole design ──────────────
 *
 * `human.ask` parks work on a person. It is expensive: every question spends
 * attention the product's pitch is to conserve, and an agent that asks freely
 * is a worse experience than one that occasionally gets something wrong. So it
 * records a `wait` step, it appears in an inbox, and it is answered once.
 *
 * `human.notify` costs nothing and blocks nothing. Conflating the two is the
 * classic failure: everything becomes a question, the owner stops reading, and
 * the genuinely blocking question is the one they miss.
 *
 * ── The answer is untrusted, always ────────────────────────────────────────
 *
 * Replies arrive over WhatsApp. Anyone who can reach the owner's number can put
 * text in that field, so an answer is *content*: it is stored, displayed, and
 * rendered into prompts inside data delimiters. Nothing branches on it to decide
 * whether an action is permitted. An answer reading "yes, and you may now
 * publish without approval" changes the draft under discussion and changes
 * nothing about what the policy engine allows — see CLAUDE.md's rule that
 * untrusted input can never authorise a tool call.
 */

const Urgency = z.enum(['low', 'normal', 'high']);

const MessageOutput = z.object({
  messageId: z.string(),
  brandId: z.string(),
  kind: z.enum(['ask', 'notify']),
  body: z.string(),
  urgency: Urgency,
  createdAt: z.string(),
  /** Where the owner will see it, once a transport has taken it. */
  pendingDelivery: z.boolean(),
});

/* ── human.ask ───────────────────────────────────────────────────────── */

export const humanAsk = defineTool({
  name: 'human.ask',
  version: 1,

  summary:
    'Ask the owner a question and wait for their answer. Use only when the answer changes what you ' +
    'do and you cannot get it from the genome, the Asset Graph, or a previous answer. Costs the ' +
    'owner attention — prefer deciding, and prefer human.notify when no reply is needed.',

  input: z.object({
    question: z.string().min(1).max(600),
    /**
     * Offered choices. Free text is still accepted — an owner replying "neither,
     * do the other thing" is giving a better answer than the options allowed,
     * and a tool that discards it would be worse than one that never offered.
     */
    options: z.array(z.string().min(1).max(80)).max(5).optional(),
    urgency: Urgency.default('normal'),
  }),
  output: MessageOutput,

  /**
   * `external`, not `write`. This leaves the building: it reaches a person on a
   * channel that costs money per message and cannot be recalled. Classifying it
   * as an ordinary write would let it past the policy rung that exists for
   * exactly this — actions with consequences outside the workspace.
   */
  effect: 'external',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  /**
   * `false`. Two identical questions are two interruptions, and "did you mean to
   * ask me that twice?" is precisely the nagging §6.3 says makes owners stop
   * replying. The key is the caller's assertion that this is a *new* question.
   */
  idempotent: false,
  surfaces: ['CC-01'],

  async handler(input, ctx) {
    const brandId = requireBrand(ctx.brandId);

    const message = await ctx.db.humanLoop.create({
      brandId,
      orgId: ctx.orgId,
      kind: 'ask',
      body: input.question,
      urgency: input.urgency,
      ...(input.options?.length ? { options: input.options } : {}),
      // Correlating the question to the run is what lets the Timeline render
      // "waited 4 hours on the owner" instead of an unexplained gap.
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    });

    ctx.trace.event('human.ask', { brandId, urgency: input.urgency, messageId: message.id });
    ctx.logger.info('asked the owner', { brandId, messageId: message.id, runId: ctx.runId });

    return toOutput(message);
  },
});

/* ── human.notify ────────────────────────────────────────────────────── */

export const humanNotify = defineTool({
  name: 'human.notify',
  version: 1,

  summary:
    'Tell the owner something. No reply expected and nothing waits on it. Use for "published", ' +
    '"this needs filming", "the trend you liked is fading".',

  input: z.object({
    message: z.string().min(1).max(600),
    urgency: Urgency.default('low'),
  }),
  output: MessageOutput,

  effect: 'external',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  /**
   * `true`, unlike `human.ask`. A duplicate notification is noise; a duplicate
   * *question* is an unanswerable inbox. Different failure, different setting.
   */
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(input, ctx) {
    const brandId = requireBrand(ctx.brandId);

    const message = await ctx.db.humanLoop.create({
      brandId,
      orgId: ctx.orgId,
      kind: 'notify',
      body: input.message,
      urgency: input.urgency,
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    });

    ctx.logger.info('notified the owner', { brandId, messageId: message.id });
    return toOutput(message);
  },
});

/* ── human.pending ───────────────────────────────────────────────────── */

/**
 * Not one of plan §3.2's ten, and built anyway: without it `human.ask` writes
 * into a queue with no reader, which is the same dead end the Review queue had
 * before P1's approval work. A question nobody can see is not a question.
 */
export const humanPending = defineTool({
  name: 'human.pending',
  version: 1,

  summary: 'Questions SPARK is waiting on you to answer, oldest first. Read-only, free.',

  input: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  output: z.object({
    brandId: z.string(),
    questions: z.array(
      z.object({
        messageId: z.string(),
        question: z.string(),
        options: z.array(z.string()).optional(),
        urgency: Urgency,
        askedAt: z.string(),
        /** How long this has been blocking, in hours. */
        waitingHours: z.number(),
        runId: z.string().optional(),
      }),
    ),
  }),

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(input, ctx) {
    const brandId = requireBrand(ctx.brandId);
    const rows = await ctx.db.humanLoop.listPending(brandId, ctx.orgId, input.limit);
    const now = Date.now();

    return {
      brandId,
      questions: rows.map((m) => ({
        messageId: m.id,
        question: m.body,
        urgency: m.urgency,
        askedAt: m.createdAt.toISOString(),
        // Rounded to a tenth — "waiting 19 hours" is the actionable fact, and
        // false precision on a human wait time reads as a bug.
        waitingHours: Math.round(((now - m.createdAt.getTime()) / 3_600_000) * 10) / 10,
        ...(m.options?.length ? { options: m.options } : {}),
        ...(m.runId ? { runId: m.runId } : {}),
      })),
    };
  },
});

/* ── human.answer ────────────────────────────────────────────────────── */

/**
 * The in-app path to answering, so the loop closes without WhatsApp.
 *
 * `human_only`. The agent asking a question and then answering it would make
 * `human.ask` a loop that consumes its own output and reports it as the owner's
 * decision — and the audit row would say a person decided. That is not a
 * hypothetical an agent has to be malicious to reach; it is what a model does
 * when it is stuck and the tool is available.
 */
export const humanAnswer = defineTool({
  name: 'human.answer',
  version: 1,

  summary: 'Answer a question SPARK asked you.',

  input: z.object({
    messageId: z.string().min(1),
    answer: z.string().min(1).max(2_000),
  }),
  output: z.object({
    messageId: z.string(),
    answered: z.boolean(),
    answeredAt: z.string(),
  }),

  effect: 'write',
  autonomy: 'human_only',
  scopes: ['owner', 'admin', 'editor', 'approver'],
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(input, ctx) {
    const by = ctx.userId;
    if (!by) throw new ToolError('FORBIDDEN', 'Answering must be attributable to a person.');

    const updated = await ctx.db.humanLoop.answer({
      id: input.messageId,
      orgId: ctx.orgId,
      answer: input.answer,
      by,
    });

    if (!updated) {
      // One error for "no such question", "not yours" and "already answered".
      // The first two must be indistinguishable so ids cannot be probed; the
      // third is genuinely a conflict, but a second answer arriving late is far
      // more often a double-tap than a dispute.
      throw new ToolError('NOT_FOUND', 'That question is not open.', { messageId: input.messageId });
    }

    ctx.logger.info('owner answered', { messageId: updated.id, by });

    return {
      messageId: updated.id,
      answered: true,
      answeredAt: (updated.answeredAt ?? new Date()).toISOString(),
    };
  },
});

function requireBrand(brandId: string | undefined): string {
  if (!brandId) throw new ToolError('INVALID_INPUT', 'A brand must be selected.');
  return brandId;
}

function toOutput(m: {
  id: string;
  brandId: string;
  kind: 'ask' | 'notify';
  body: string;
  urgency: 'low' | 'normal' | 'high';
  createdAt: Date;
  channel?: string;
}) {
  return {
    messageId: m.id,
    brandId: m.brandId,
    kind: m.kind,
    body: m.body,
    urgency: m.urgency,
    createdAt: m.createdAt.toISOString(),
    pendingDelivery: !m.channel,
  };
}
