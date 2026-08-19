import type { CtaLinkStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/** `ScopedDb['ctaLinks']` backed by Postgres — see `content_links`'s own comment in schema.ts. */
export function createCtaLinkRepository(db: Database): CtaLinkStore {
  return {
    async create({ genomeId, orgId, contentItemId, dubLinkId, shortUrl, destinationUrl }) {
      return scoped.createContentLink(db, { orgId, brandId: orgId, genomeId }, { contentItemId, dubLinkId, shortUrl, destinationUrl });
    },

    async listForItems(contentItemIds, orgId, genomeId) {
      return scoped.listContentLinksForItems(db, { orgId, brandId: orgId, genomeId }, contentItemIds);
    },
  };
}
