import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { BrandMemberStore, ReviewLinkStore } from '@sparksocial/tools/defineTool';
import type { Role } from '@sparksocial/shared';
import type { Database } from './client.js';
import { brandMembers, reviewLinks } from './schema.js';

/**
 * `brand_members` backed by Postgres — the agency isolation gap plan §6.9
 * describes: Clerk decides who is in the org at all, this decides which
 * specific brands within it each of them can reach. Not scoped through
 * `scoped.ts` — it *grants* access to a genome, so it cannot itself require
 * the access it grants; every query filters on `orgId` regardless.
 */
export function createBrandMemberRepository(db: Database): BrandMemberStore {
  return {
    async set({ orgId, brandId, userId, role }) {
      const [row] = await db
        .insert(brandMembers)
        .values({ orgId, brandId, userId, role })
        .onConflictDoUpdate({ target: [brandMembers.brandId, brandMembers.userId], set: { role } })
        .returning();
      return toMember(row!);
    },

    async remove({ orgId, brandId, userId }) {
      await db.delete(brandMembers).where(and(eq(brandMembers.orgId, orgId), eq(brandMembers.brandId, brandId), eq(brandMembers.userId, userId)));
    },

    async listForBrand(orgId, brandId) {
      const rows = await db.select().from(brandMembers).where(and(eq(brandMembers.orgId, orgId), eq(brandMembers.brandId, brandId)));
      return rows.map(toMember);
    },

    async listForUser(orgId, userId) {
      const rows = await db.select().from(brandMembers).where(and(eq(brandMembers.orgId, orgId), eq(brandMembers.userId, userId)));
      return rows.map(toMember);
    },
  };
}

function toMember(row: typeof brandMembers.$inferSelect) {
  return { userId: row.userId, brandId: row.brandId, role: row.role as Role, createdAt: row.createdAt };
}

/**
 * `review_links` backed by Postgres — `whitelabel.link.create`'s storage
 * (plan §6.9). The token is the credential (32 random bytes, hex-encoded —
 * 256 bits, not a guessable id), so `getByToken` is deliberately the only
 * read with no `orgId` predicate: an unauthenticated client review page has
 * nothing else to present.
 */
export function createReviewLinkRepository(db: Database): ReviewLinkStore {
  return {
    async create({ orgId, brandId, scope, targetId, createdBy, expiresAt }) {
      const [row] = await db
        .insert(reviewLinks)
        .values({
          orgId,
          brandId,
          token: randomBytes(32).toString('hex'),
          scope,
          createdBy,
          expiresAt,
          ...(targetId ? { targetId } : {}),
        })
        .returning();
      return toLink(row!);
    },

    async getByToken(token) {
      const [row] = await db
        .select()
        .from(reviewLinks)
        .where(and(eq(reviewLinks.token, token), isNull(reviewLinks.revokedAt), gt(reviewLinks.expiresAt, new Date())))
        .limit(1);
      return row ? toLink(row) : undefined;
    },

    async revoke({ orgId, id }) {
      await db.update(reviewLinks).set({ revokedAt: new Date() }).where(and(eq(reviewLinks.id, id), eq(reviewLinks.orgId, orgId)));
    },

    async listForBrand(orgId, brandId) {
      const rows = await db.select().from(reviewLinks).where(and(eq(reviewLinks.orgId, orgId), eq(reviewLinks.brandId, brandId)));
      return rows.map(toLink);
    },
  };
}

function toLink(row: typeof reviewLinks.$inferSelect) {
  return {
    id: row.id,
    token: row.token,
    brandId: row.brandId,
    scope: row.scope as 'calendar' | 'content_item',
    createdBy: row.createdBy,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    ...(row.targetId ? { targetId: row.targetId } : {}),
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
  };
}
