import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `content.schedule` — places or moves a content item on the calendar.
 *
 * The one write `CAL-04` ("create post for date") and `CAL-05` (drag a slot
 * to a new date) both reduce to: `content.draft` already made the copy,
 * `calendar.generate` already places whole campaigns, but nothing let a
 * single ad-hoc draft (CC-02's "one brief → draft pack") or an existing slot
 * be pinned to — or moved to — one specific date. One tool, since the store
 * write is identical either way (`ScopedDb.content.schedule`'s own comment).
 */

export const ContentScheduleInput = z.object({
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
  scheduledAt: z.string().datetime(),
  /**
   * Publish a post whose date is already in the past, immediately.
   *
   * There was no lower bound on `scheduledAt` at all, and the calendar's drop
   * handler only blocked the `unscheduled` column and already-published slots.
   * So dragging a scheduled post onto an earlier day made it due on the spot,
   * and the scheduler published it within a minute — a backward drag was an
   * "publish now" button that did not say so. CAL-05's undo is the right
   * affordance for moving a post *later*; it is not sufficient for a move that
   * fires before anyone can click it.
   *
   * Still allowed, because backfilling a date is a real thing to want (a post
   * that should have gone out on Tuesday, an imported archive). It just has to
   * be said out loud.
   */
  publishImmediatelyIfPast: z.boolean().default(false),
});

export const ContentScheduleOutput = z.object({
  contentItemId: z.string(),
  status: z.string(),
  scheduledAt: z.string(),
});

export const contentSchedule = defineTool({
  name: 'content.schedule',
  version: 1,

  summary: 'Place a draft on the calendar for a specific date, or move an already-scheduled one to a new date. Free.',

  input: ContentScheduleInput,
  output: ContentScheduleOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Moving the same post to the same date twice is the same fact, not a new
  // one — unlike `content.draft`, where a second call is a new generation.
  idempotent: true,
  surfaces: ['CAL-04', 'CAL-05'],

  async handler(input, ctx) {
    const when = new Date(input.scheduledAt);
    if (when.getTime() < Date.now() && !input.publishImmediatelyIfPast) {
      throw new ToolError(
        'INVALID_INPUT',
        'That date has already passed, so this post would publish immediately. Pick a future date, or pass publishImmediatelyIfPast to send it now.',
        { scheduledAt: input.scheduledAt, contentItemId: input.contentItemId },
      );
    }

    const draft = await ctx.db.content.schedule({
      id: input.contentItemId,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      scheduledAt: new Date(input.scheduledAt),
    });

    if (!draft) {
      throw new ToolError('NOT_FOUND', 'That draft is not open — it may already be published.', {
        contentItemId: input.contentItemId,
      });
    }

    ctx.logger.info('content scheduled', { contentItemId: draft.id, scheduledAt: input.scheduledAt });

    return {
      contentItemId: draft.id,
      status: draft.status,
      scheduledAt: (draft.scheduledAt ?? new Date(input.scheduledAt)).toISOString(),
    };
  },
});
