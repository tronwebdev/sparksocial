import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Platform } from '@sparksocial/shared';
import { byId } from '@sparksocial/playbooks';
import { ResolvedBeat } from './draft.js';

/**
 * `content.list` — the Draft List's (CC-03) source: every content item for a
 * genome, across every status, newest first.
 *
 * Genome-wide rather than per-campaign, same reasoning as
 * `ScopedDb.content.list`'s own comment — `content.draft`'s ad-hoc path
 * (CC-02's "one brief → draft pack") produces rows with no campaign at all.
 */

export const ContentListInput = z.object({
  genomeId: z.string().min(1),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

const ContentListItem = z.object({
  contentItemId: z.string(),
  playbookId: z.string(),
  playbookName: z.string(),
  mediaType: z.enum(['video', 'image', 'carousel', 'text']).optional(),
  /**
   * Which account this is going to, when one has been chosen.
   *
   * Absent on a calendar slot that has not been assigned a platform yet —
   * `calendar.generate` writes the playbook and the date and leaves this to the
   * slot's own platform choice, so "no platform yet" is a real state and not a
   * missing value. Added so the Plan queue can filter by channel, which the
   * Command Center prototype offers and had no data behind it.
   */
  platform: Platform.optional(),
  status: z.string(),
  /** The first written beat, truncated — enough to recognise the post in a list row. */
  summary: z.string(),
  scheduledAt: z.string().optional(),
  createdAt: z.string(),
  /**
   * `DISC-02`'s A/B group, when this post is an arm of one. Present so a list
   * row can offer the verdict without a second read per item — the alternative
   * was N calls to find out that N-1 of them are ordinary posts.
   */
  variantGroupId: z.string().optional(),
  variantLabel: z.string().optional(),
  /**
   * Why this post is not moving — set when `status` is `blocked` or `needs_review`.
   *
   * On the list row, not only on `content.get`, because a list that can show the
   * badge and not the cause makes somebody open every stalled item to find out
   * which one matters. Same column both states use, as `markContentBlocked`'s own
   * comment explains: both answer the question a person opening a stalled item
   * asks.
   */
  blockedReason: z.string().optional(),
  /**
   * Failed publish attempts. Present so a list can distinguish "held for review"
   * from "tried five times and gave up", which read very differently to whoever
   * has to act on it.
   */
  publishAttempts: z.number().optional(),
});

export const ContentListOutput = z.object({ items: z.array(ContentListItem) });

const SUMMARY_MAX = 90;

export const contentList = defineTool({
  name: 'content.list',
  version: 1,

  summary: 'Every draft, scheduled slot and published post for a genome, newest first. Free.',

  input: ContentListInput,
  output: ContentListOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,
  surfaces: ['CC-03'],

  async handler(input, ctx) {
    const rows = await ctx.db.content.list(input.genomeId, ctx.orgId, {
      ...(input.status ? { status: input.status } : {}),
      limit: input.limit,
    });

    return {
      items: rows.map((r) => {
        const playbook = byId(r.playbookId);
        const parsed = z.array(ResolvedBeat).safeParse(r.copy);
        const beats = parsed.success ? parsed.data : [];
        const firstText = beats.find((b): b is Extract<ResolvedBeat, { kind: 'text' }> => b.kind === 'text');

        return {
          contentItemId: r.id,
          playbookId: r.playbookId,
          playbookName: playbook?.name ?? r.playbookId,
          ...(playbook ? { mediaType: playbook.output.media_type } : {}),
          ...(r.platform ? { platform: r.platform } : {}),
          status: r.status,
          summary: firstText ? truncate(firstText.text) : '(no copy yet)',
          ...(r.scheduledAt ? { scheduledAt: r.scheduledAt.toISOString() } : {}),
          createdAt: r.createdAt.toISOString(),
          ...(r.variantGroupId ? { variantGroupId: r.variantGroupId } : {}),
          ...(r.variantLabel ? { variantLabel: r.variantLabel } : {}),
      ...(r.blockedReason ? { blockedReason: r.blockedReason } : {}),
      ...(r.publishAttempts ? { publishAttempts: r.publishAttempts } : {}),
        };
      }),
    };
  },
});

function truncate(s: string): string {
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}
