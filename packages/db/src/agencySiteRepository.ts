import { and, eq, isNotNull, ne } from 'drizzle-orm';
import type { AgencySiteRecord, AgencySiteStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { orgSettings } from './schema.js';

/**
 * `org_settings.site_*` — the agency's generated website.
 *
 * Not behind `scoped.ts`: it describes the agency, never a client brand, the
 * same as the rest of `org_settings`. `findPublished` is the one read that
 * starts from something other than an org id — a public request's slug or
 * host — and it only ever returns published rows.
 */
export function createAgencySiteRepository(db: Database): AgencySiteStore {
  const columns = {
    orgId: orgSettings.orgId,
    slug: orgSettings.siteSlug,
    domain: orgSettings.siteDomain,
    content: orgSettings.siteContent,
    publishedAt: orgSettings.sitePublishedAt,
  };

  type Row = { orgId: string; slug: string | null; domain: string | null; content: unknown; publishedAt: Date | null };

  const toRecord = (r: Row | undefined): AgencySiteRecord | undefined =>
    r && r.slug
      ? {
          orgId: r.orgId,
          slug: r.slug,
          ...(r.domain ? { domain: r.domain } : {}),
          content: r.content,
          ...(r.publishedAt ? { publishedAt: r.publishedAt } : {}),
        }
      : undefined;

  async function get(orgId: string) {
    const [row] = await db.select(columns).from(orgSettings).where(eq(orgSettings.orgId, orgId)).limit(1);
    return toRecord(row);
  }

  return {
    get,

    async save({ orgId, slug, content, publishedAt }) {
      await db
        .insert(orgSettings)
        .values({ orgId, siteSlug: slug, siteContent: content, sitePublishedAt: publishedAt })
        .onConflictDoUpdate({
          target: orgSettings.orgId,
          set: { siteSlug: slug, siteContent: content, sitePublishedAt: publishedAt },
        });
      return (await get(orgId))!;
    },

    async setDomain(orgId, domain) {
      await db.update(orgSettings).set({ siteDomain: domain }).where(eq(orgSettings.orgId, orgId));
      return get(orgId);
    },

    async slugTaken(slug, exceptOrgId) {
      const [row] = await db
        .select({ orgId: orgSettings.orgId })
        .from(orgSettings)
        .where(and(eq(orgSettings.siteSlug, slug), ne(orgSettings.orgId, exceptOrgId)))
        .limit(1);
      return Boolean(row);
    },

    async domainTaken(domain, exceptOrgId) {
      const [row] = await db
        .select({ orgId: orgSettings.orgId })
        .from(orgSettings)
        .where(and(eq(orgSettings.siteDomain, domain), ne(orgSettings.orgId, exceptOrgId)))
        .limit(1);
      return Boolean(row);
    },

    async findPublished(by) {
      const match = 'slug' in by ? eq(orgSettings.siteSlug, by.slug) : eq(orgSettings.siteDomain, by.domain);
      const [row] = await db
        .select(columns)
        .from(orgSettings)
        .where(and(match, isNotNull(orgSettings.sitePublishedAt)))
        .limit(1);
      return toRecord(row);
    },
  };
}
