import { eq } from 'drizzle-orm';
import type { OrgSettingsStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { orgBudgets, orgSettings } from './schema.js';

const DEFAULT_MONTHLY_CAP_CENTS = 500_00;

/**
 * `org_settings` + `org_budgets` backed by Postgres — `org.governance.set`,
 * `org.billing.plan.set`, `org.security.sso.configure` (plan §12 P6).
 *
 * Two tables, one store: `org.billing.plan.set` is the one caller that
 * legitimately needs to move both the plan label *and* the spend cap
 * `policy.ts` rule 4 reads, in the same call. Not scoped through `scoped.ts`
 * — governance/billing configuration, not client-confidential material, same
 * rationale as `brands` and `org_budgets` itself.
 */
export function createOrgSettingsRepository(db: Database): OrgSettingsStore {
  async function getRecord(orgId: string) {
    const [settings] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId)).limit(1);
    const [budget] = await db.select().from(orgBudgets).where(eq(orgBudgets.orgId, orgId)).limit(1);

    if (settings) {
      return toRecord(settings, budget?.monthlyCapCents ?? DEFAULT_MONTHLY_CAP_CENTS);
    }

    // Upsert on first read, like `brands.get` — a missing row must resolve to
    // the schema defaults, never to "unset".
    await db.insert(orgSettings).values({ orgId }).onConflictDoNothing();
    const [created] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId)).limit(1);
    return created
      ? toRecord(created, budget?.monthlyCapCents ?? DEFAULT_MONTHLY_CAP_CENTS)
      : {
          orgId,
          plan: 'starter' as const,
          defaultApprovalMode: 'review_first_week',
          ssoRequired: false,
          monthlyCapCents: DEFAULT_MONTHLY_CAP_CENTS,
          updatedAt: new Date(),
        };
  }

  return {
    get: getRecord,

    async setPlan({ orgId, plan, monthlyCapCents }) {
      await db
        .insert(orgSettings)
        .values({ orgId, plan })
        .onConflictDoUpdate({ target: orgSettings.orgId, set: { plan, updatedAt: new Date() } });
      await db
        .insert(orgBudgets)
        .values({ orgId, monthlyCapCents })
        .onConflictDoUpdate({ target: orgBudgets.orgId, set: { monthlyCapCents, updatedAt: new Date() } });
      return getRecord(orgId);
    },

    async setGovernance({ orgId, defaultApprovalMode }) {
      await db
        .insert(orgSettings)
        .values({ orgId, defaultApprovalMode })
        .onConflictDoUpdate({ target: orgSettings.orgId, set: { defaultApprovalMode, updatedAt: new Date() } });
      return getRecord(orgId);
    },

    async setSso({ orgId, required }) {
      await db
        .insert(orgSettings)
        .values({ orgId, ssoRequired: required })
        .onConflictDoUpdate({ target: orgSettings.orgId, set: { ssoRequired: required, updatedAt: new Date() } });
      return getRecord(orgId);
    },
  };
}

function toRecord(row: typeof orgSettings.$inferSelect, monthlyCapCents: number) {
  return {
    orgId: row.orgId,
    plan: row.plan as 'starter' | 'growth' | 'agency',
    defaultApprovalMode: row.defaultApprovalMode,
    ssoRequired: row.ssoRequired,
    monthlyCapCents,
    updatedAt: row.updatedAt,
  };
}
