import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
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
  status: z.string(),
  /** The first written beat, truncated — enough to recognise the post in a list row. */
  summary: z.string(),
  scheduledAt: z.string().optional(),
  createdAt: z.string(),
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
          status: r.status,
          summary: firstText ? truncate(firstText.text) : '(no copy yet)',
          ...(r.scheduledAt ? { scheduledAt: r.scheduledAt.toISOString() } : {}),
          createdAt: r.createdAt.toISOString(),
        };
      }),
    };
  },
});

function truncate(s: string): string {
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}
