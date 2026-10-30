import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ContentStatus, ToolError } from '@sparksocial/shared';

/**
 * `content.delete` — removing a post that has not gone out.
 *
 * There was no way to remove a post at all. The calendar and the Plan Queue
 * both drew a Remove control and both disabled it, because the registry had
 * nothing to call (`docs/GAPS.md`); a planned post somebody no longer wanted
 * could only be left to publish, or left blocked in the queue forever. PRD
 * `CAL-05` and `CAL-06` assume removing a planned post is ordinary.
 *
 * ── Only what has not been published ──────────────────────────────────────
 *
 * Drafts, scheduled posts, and anything held, blocked or failed. A published
 * post is refused, with the reason: its record is what analytics, the learning
 * loop and the engagement inbox read, and deleting the row would not take the
 * post down from the platform — it would only make SPARK forget it went out.
 *
 * ── Why it waits for approval ─────────────────────────────────────────────
 *
 * `effect: 'destructive'`, so policy rule 5 routes every call to an owner or
 * admin, the same as `recipe.delete` and `brand.delete`. A deleted draft is
 * gone — its copy, its renders, its short links — and there is no undo to offer
 * instead. The person approving it sees exactly which post.
 */

export const ContentDeleteInput = z.object({
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
});

export const ContentDeleteOutput = z.object({
  deleted: z.literal(true),
  contentItemId: z.string(),
  /** The status it had — so the caller can say "removed a scheduled post". */
  status: ContentStatus,
});

export const contentDelete = defineTool({
  name: 'content.delete',
  version: 1,

  summary:
    'Permanently remove a post that has not been published — a draft, a scheduled post, or one that is held, ' +
    'blocked or failed — with its renders and short links. Published posts are refused. Free.',

  input: ContentDeleteInput,
  output: ContentDeleteOutput,

  effect: 'destructive',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Deleting what is already gone changes nothing; a replay answers NOT_FOUND
  // and leaves every row as the first call left it.
  idempotent: true,
  surfaces: ['CAL-05', 'CAL-06'],

  async handler(input, ctx) {
    if (input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'genomeId does not match the active genome.', {
        requested: input.genomeId,
        active: ctx.genomeId,
      });
    }

    const result = await ctx.db.content.delete({ id: input.contentItemId, genomeId: input.genomeId, orgId: ctx.orgId });

    if (!result.deleted && result.status) {
      throw new ToolError(
        'INVALID_INPUT',
        'This post has already been published, so it stays: its results feed analytics and learning, and deleting ' +
          'the record would not take it down from the platform. Remove it on the platform itself.',
        { contentItemId: input.contentItemId, status: result.status },
      );
    }
    if (!result.deleted || !result.status) {
      throw new ToolError('NOT_FOUND', 'No such post.', { contentItemId: input.contentItemId });
    }

    ctx.logger.info('content deleted', { contentItemId: input.contentItemId, status: result.status });
    return { deleted: true as const, contentItemId: input.contentItemId, status: result.status };
  },
});
