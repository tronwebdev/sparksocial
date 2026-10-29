import { eq } from 'drizzle-orm';
import type { AgencyProfileStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { orgSettings } from './schema.js';

/**
 * `org_settings.agency_profile` — the Agency Portal wizard's answers.
 *
 * A column on `org_settings` rather than its own table: it is one value per
 * org, read on one screen, and `org_settings` is already the org's row. Not
 * routed through `scoped.ts` for the same reason as the rest of that table —
 * it describes the agency, not any client brand inside it.
 */
export function createAgencyProfileRepository(db: Database): AgencyProfileStore {
  return {
    async get(orgId) {
      const [row] = await db
        .select({ profile: orgSettings.agencyProfile, updatedAt: orgSettings.agencyProfileUpdatedAt })
        .from(orgSettings)
        .where(eq(orgSettings.orgId, orgId))
        .limit(1);
      if (!row || row.profile === null || row.profile === undefined) return undefined;
      return { profile: row.profile, updatedAt: row.updatedAt ?? new Date(0) };
    },

    async set(orgId, profile) {
      const updatedAt = new Date();
      await db
        .insert(orgSettings)
        .values({ orgId, agencyProfile: profile, agencyProfileUpdatedAt: updatedAt })
        .onConflictDoUpdate({
          target: orgSettings.orgId,
          set: { agencyProfile: profile, agencyProfileUpdatedAt: updatedAt },
        });
      return { profile, updatedAt };
    },
  };
}
