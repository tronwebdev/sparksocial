import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `whitelabel.link.create` — a signed, expiring, unauthenticated review link
 * for a client with no SparkSocial account (plan §6.9). The token
 * (`review_links.token`, 256 random bits — see `agencyRepository.ts`) is the
 * credential; whatever serves the public review page trusts the token
 * instead of a Clerk session, matching the WhatsApp capture loop's own
 * "unauthenticated channel, treated as untrusted input" posture for anything
 * that arrives over it.
 */

export const whitelabelLinkCreate = defineTool({
  name: 'whitelabel.link.create',
  version: 1,

  summary:
    'Create an unauthenticated, expiring review link for a client — the whole calendar, or one piece of ' +
    'content. Revocable at any time; the token itself carries no information about what it grants, only ' +
    'the id does, so a leaked link cannot be used to guess at other brands.',

  input: z.object({
    brandId: z.string().min(1),
    scope: z.enum(['calendar', 'content_item']),
    targetId: z.string().optional(),
    expiresInDays: z.number().int().min(1).max(90).default(14),
  }),
  output: z.object({ id: z.string(), token: z.string(), expiresAt: z.string() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: false,

  async handler(input, ctx) {
    if (input.scope === 'content_item' && !input.targetId) {
      throw new ToolError('INVALID_INPUT', 'A content_item link needs a targetId.', { scope: input.scope });
    }
    const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
    const link = await ctx.db.reviewLinks.create({
      orgId: ctx.orgId,
      brandId: input.brandId,
      scope: input.scope,
      createdBy: ctx.userId ?? 'agent',
      expiresAt,
      ...(input.targetId ? { targetId: input.targetId } : {}),
    });
    ctx.logger.info('review link created', { orgId: ctx.orgId, brandId: input.brandId, scope: input.scope });
    return { id: link.id, token: link.token, expiresAt: link.expiresAt.toISOString() };
  },
});
