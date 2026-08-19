import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `engage.ingest` — the inbox's one write side. PRD §8.8's feed consolidates
 * DMs, comments, and story replies; this is where any of the three lands,
 * regardless of source.
 *
 * ── Why this takes an already-normalized message, not a platform webhook ────
 * Same seam `direct.session.send`/`MessageTransport` used before the real
 * WhatsApp client existed (`packages/capture`): build the tool against a
 * normalized shape everything downstream can already work with, so the whole
 * ingest → classify → feed path runs end to end in development and under
 * test. The actual Meta Messenger/Instagram-comments webhooks — with their
 * own signature verification, same pattern `whatsapp-webhook.ts` already
 * establishes — are a separate piece behind this seam, not built here, and
 * genuinely blocked on the same platform approvals CLAUDE.md names for
 * publishing (§8), not on code.
 */

export const EngageIngestInput = z.object({
  genomeId: z.string().min(1),
  platform: z.enum(['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts']),
  /** The platform's own message/comment id — the upsert key that makes a webhook retry safe. */
  externalId: z.string().min(1),
  kind: z.enum(['comment', 'dm', 'story_reply']),
  authorHandle: z.string().min(1),
  authorName: z.string().optional(),
  text: z.string().min(1).max(5_000),
  /** The post this replies to, when known. */
  contentItemId: z.string().optional(),
  receivedAt: z.string().datetime().optional(),
});

export const EngageIngestOutput = z.object({
  id: z.string(),
  status: z.string(),
});

export const engageIngest = defineTool({
  name: 'engage.ingest',
  version: 1,

  summary: 'Record an inbound comment, DM, or story reply in the engagement inbox. Safe to call twice for the same message.',

  input: EngageIngestInput,
  output: EngageIngestOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // A webhook redelivering the same platform message must land the same
  // row, not a duplicate — enforced by the upsert key, not a caller-supplied
  // idempotency key.
  idempotent: true,

  async handler(input, ctx) {
    // Same check `publish.now`/`engage.classify` make: whoever built this
    // ctx (eventually a platform webhook route, resolving genome the same
    // way `whatsappWebhook.systemCtx` resolves brand) is the trust boundary,
    // not the input.
    if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
        claimed: input.genomeId,
        selected: ctx.genomeId,
      });
    }

    const message = await ctx.db.engagement.ingest({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      platform: input.platform,
      externalId: input.externalId,
      kind: input.kind,
      authorHandle: input.authorHandle,
      ...(input.authorName ? { authorName: input.authorName } : {}),
      text: input.text,
      ...(input.contentItemId ? { contentItemId: input.contentItemId } : {}),
      ...(input.receivedAt ? { receivedAt: new Date(input.receivedAt) } : {}),
    });

    return { id: message.id, status: message.status };
  },
});
