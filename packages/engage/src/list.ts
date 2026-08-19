import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { EngagementCategory } from './classifier.js';

/**
 * `engage.list` — the inbox feed's read (`ENG-02`'s four tabs: Needs Review /
 * Suggested Replies / Auto-Handled / Sales Opportunities), newest first.
 *
 * An enumeration, not a decision `engage.classify` already made — same
 * reasoning `genome.list`/`content.list` give for skipping a `why` on the
 * tool itself. Each returned row still carries its own `why` (set once by
 * `engage.classify`) so the feed UI can surface *that* decision's rationale
 * per-card; this tool just passes it through unread.
 *
 * `category` is left optional and unconstrained to a subset of
 * `EngagementCategory` on purpose: a message SPARK hasn't classified yet has
 * `category: null` in the store, and there is no tab that legitimately means
 * "unclassified" in the PRD's four-tab list. The frontend's decision (see
 * `apps/web/src/app/(app)/command-center/page.tsx`) is to fold unclassified
 * rows into the Needs Review tab by leaving `category` unset on that one
 * request rather than adding a fifth tab this tool would have to support.
 */

export const EngageListInput = z.object({
  genomeId: z.string().min(1),
  status: z.string().optional(),
  category: EngagementCategory.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

const EngageListItem = z.object({
  id: z.string(),
  platform: z.string(),
  kind: z.string(),
  authorHandle: z.string(),
  authorName: z.string().optional(),
  text: z.string(),
  receivedAt: z.string(),
  status: z.string(),
  category: z.string().optional(),
  intentScore: z.number().optional(),
  suggestedReply: z.string().optional(),
  why: Explanation.optional(),
});

export const EngageListOutput = z.object({ items: z.array(EngageListItem) });

export const engageList = defineTool({
  name: 'engage.list',
  version: 1,

  summary: 'List engagement inbox messages for a genome, newest first — the feed the Needs Review / Suggested Replies / Auto-Handled / Sales Opportunities tabs read. Free.',

  input: EngageListInput,
  output: EngageListOutput,

  effect: 'read',
  autonomy: 'auto',
  // Same read scopes as `engage.eligibility.check`: seeing the feed is not
  // gated tighter than seeing whether the feed is even active yet.
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,

  async handler(input, ctx) {
    // Same check every other `engage.*` tool makes (`ingest`/`classify`):
    // whoever built this ctx is the trust boundary, not the input.
    if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
        claimed: input.genomeId,
        selected: ctx.genomeId,
      });
    }

    const rows = await ctx.db.engagement.list(input.genomeId, ctx.orgId, {
      ...(input.status ? { status: input.status } : {}),
      ...(input.category ? { category: input.category } : {}),
      limit: input.limit,
    });

    return {
      items: rows.map((r) => ({
        id: r.id,
        platform: r.platform,
        kind: r.kind,
        authorHandle: r.authorHandle,
        ...(r.authorName ? { authorName: r.authorName } : {}),
        text: r.text,
        receivedAt: r.receivedAt.toISOString(),
        status: r.status,
        ...(r.category ? { category: r.category } : {}),
        ...(r.intentScore !== undefined ? { intentScore: r.intentScore } : {}),
        ...(r.suggestedReply ? { suggestedReply: r.suggestedReply } : {}),
        ...(r.why ? { why: r.why } : {}),
      })),
    };
  },
});
