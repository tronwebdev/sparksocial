import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ContentStatus, Platform } from '@sparksocial/shared';
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
  status: ContentStatus.optional(),
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
  status: ContentStatus,
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
  /**
   * One frame to show the post by, on a surface that has room for a picture
   * and not for the post.
   *
   * On the row for the same reason `variantGroupId` and `blockedReason` are:
   * the alternative is a `content.get` per cell, and a calendar month is
   * thirty of them. Before this the list carried a media *type* and nothing to
   * look at, so every calendar cell showed the words "Image" where the image
   * should be.
   *
   * Absent for a post with nothing rendered or illustrated yet, which is a
   * real and common state — a slot is planned days before it is written.
   */
  thumbnailUrl: z.string().optional(),
  /**
   * The campaign this post belongs to. Absent for a one-off post made outside
   * any campaign (the Draft Panel's free draft, Ask Spark's "Create a Post").
   *
   * Returned so a brand running more than one campaign can tell whose post a
   * row is: the queue, the dashboard and the calendar all list a genome's
   * posts together, and with two campaigns live they were indistinguishable.
   */
  campaignId: z.string().optional(),
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

    /*
     * One query for every row's renders, not one per row.
     *
     * A failed read costs thumbnails and nothing else: the list is what the
     * calendar is built from, and losing a month of posts because a render
     * lookup failed would be a bad trade for a picture.
     */
    const rendersByItem = new Map<string, Array<{ aspect: string; storageUrl: string }>>();
    const renders = await ctx.db.content
      .listRendersForItems(rows.map((r) => r.id), input.genomeId, ctx.orgId)
      .catch(() => []);
    for (const render of renders) {
      const list = rendersByItem.get(render.contentItemId);
      if (list) list.push(render);
      else rendersByItem.set(render.contentItemId, [render]);
    }

    return {
      items: rows.map((r) => {
        const playbook = byId(r.playbookId);
        const parsed = z.array(ResolvedBeat).safeParse(r.copy);
        const beats = parsed.success ? parsed.data : [];
        const firstText = beats.find((b): b is Extract<ResolvedBeat, { kind: 'text' }> => b.kind === 'text');
        const thumbnail = thumbnailFor(rendersByItem.get(r.id) ?? [], beats);

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
          ...(thumbnail ? { thumbnailUrl: thumbnail } : {}),
          ...(r.campaignId ? { campaignId: r.campaignId } : {}),
        };
      }),
    };
  },
});

/**
 * The frame a list row shows itself by.
 *
 * **Portrait first**, which is the opposite of what the Draft Review modal
 * does and is right for both: that modal has a wide well and wants the square
 * render, and a calendar cell is a narrow tile — the prototype's own post
 * thumbnail is 38x64, which is 9:16. It is also the only place the vertical
 * render surfaces at all; before this it was produced on every render and then
 * shown nowhere.
 *
 * Then a beat's own generated media, then auto-illustration's backdrop. That
 * last one matters more than it looks: auto-illustration attaches a `backdrop`
 * and deliberately leaves the beat's `kind` as `text`, so a fully illustrated
 * post looks textual to anything matching on kind alone.
 *
 * Videos are not offered as thumbnails. A list cell cannot play one, and a
 * `<video>` poster for thirty cells is thirty clips fetched to show stills.
 */
export function thumbnailFor(
  renders: ReadonlyArray<{ aspect: string; storageUrl: string }>,
  beats: ReadonlyArray<z.infer<typeof ResolvedBeat>>,
): string | undefined {
  const tall = renders.find((r) => r.aspect === '9:16') ?? renders[0];
  if (tall) return tall.storageUrl;

  for (const beat of beats) {
    if (beat.kind === 'generated_image' && 'url' in beat && typeof beat.url === 'string') return beat.url;
    const backdrop = 'backdrop' in beat ? beat.backdrop : undefined;
    if (backdrop && backdrop.kind === 'image' && backdrop.urls[0]) return backdrop.urls[0];
  }

  return undefined;
}

function truncate(s: string): string {
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}
