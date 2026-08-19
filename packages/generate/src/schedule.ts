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
