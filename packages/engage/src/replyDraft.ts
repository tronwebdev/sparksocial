import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError, Explanation } from '@sparksocial/shared';
import type { ReplyWriter } from './replyWriter.js';

/**
 * `engage.reply.draft` — the first half of the "approve & send" loop
 * (PRD §8.8): produce the text a human reviews, edits, and hands to
 * `engage.reply.send`.
 *
 * `effect: 'read'`: nothing about this call is visible outside the
 * workspace, so it carries none of `engage.reply.send`'s governance — a user
 * (or SPARK) can draft freely and discard what it doesn't like.
 *
 * Prefers the reply `engage.classify` already suggested (`message.suggestedReply`)
 * over a fresh model call, per CLAUDE.md's cost discipline: the classifier
 * already wrote one in the same pass that categorized the message, for
 * exactly the categories (`suggested_reply`/`auto_handled`) where a reply is
 * safe to propose. Only when there is none on file — or the caller
 * explicitly asks via `regenerate` — does this reach for `ReplyWriter`.
 */

export const EngageReplyDraftInput = z.object({
  genomeId: z.string().min(1),
  messageId: z.string().min(1),
  /** Ask the writer for a fresh draft even when a suggested reply is already on file. */
  regenerate: z.boolean().default(false),
});

export const EngageReplyDraftOutput = z.object({
  messageId: z.string(),
  text: z.string(),
  /** Whether this reused `engage.classify`'s suggestion or asked the writer fresh. */
  source: z.enum(['suggested', 'generated']),
  why: Explanation,
});

export interface EngageReplyDraftDeps {
  writer: ReplyWriter;
}

export function makeEngageReplyDraft(deps: EngageReplyDraftDeps) {
  return defineTool({
    name: 'engage.reply.draft',
    version: 1,

    summary:
      'Draft a reply to one inbox message — reuses the classifier\'s suggested reply when there is one, ' +
      'otherwise writes a fresh brand-voiced draft. Read-only, free; nothing is sent.',

    input: EngageReplyDraftInput,
    output: EngageReplyDraftOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,

    async handler(input, ctx) {
      // Same check every other `engage.*` tool makes: whoever built this ctx
      // is the trust boundary, not the input.
      if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
          claimed: input.genomeId,
          selected: ctx.genomeId,
        });
      }

      const message = await ctx.db.engagement.get(input.messageId, input.genomeId, ctx.orgId);
      if (!message) {
        throw new ToolError('NOT_FOUND', 'No inbox message with that id in this genome.');
      }

      if (message.suggestedReply && !input.regenerate) {
        return {
          messageId: message.id,
          text: message.suggestedReply,
          source: 'suggested' as const,
          why: {
            summary: 'Reused the reply already suggested when this message was classified, rather than drafting a new one.',
            factors: [{ label: 'Classifier-suggested reply on file', weight: 1 }],
            evidence: [{ kind: 'metric' as const, id: message.id, note: message.text.slice(0, 200) }],
            alternatives: [{ option: 'Write a fresh draft', rejectedBecause: 'A suggestion already exists and regenerate was not requested.' }],
          },
        };
      }

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) {
        throw new ToolError('NOT_FOUND', 'No genome with that id in this org.');
      }

      const text = await deps.writer.write({
        genome,
        kind: message.kind,
        authorHandle: message.authorHandle,
        messageText: message.text,
      });

      return {
        messageId: message.id,
        text,
        source: 'generated' as const,
        why: {
          summary: input.regenerate
            ? 'Wrote a fresh reply at the caller\'s request instead of reusing the earlier suggestion.'
            : 'No suggested reply was on file, so the writer drafted one grounded in the brand voice.',
          factors: [{ label: input.regenerate ? 'Regeneration requested' : 'No suggested reply on file', weight: 1 }],
          evidence: [{ kind: 'metric' as const, id: message.id, note: message.text.slice(0, 200) }],
          alternatives: [],
        },
      };
    },
  });
}
