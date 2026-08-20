import { eq } from 'drizzle-orm';
import type { OrgSettingsRecord, OrgSettingsStore } from '@sparksocial/tools/defineTool';
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
  async function getRecord(orgId: string): Promise<OrgSettingsRecord> {
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
          // Mirrors `schema.ts`'s column defaults. `retentionDays` is absent
          // rather than 0 — no policy means keep indefinitely.
          orgId,
          plan: 'starter' as const,
          defaultApprovalMode: 'review_first_week',
          ssoRequired: false,
          twoFactorRequired: false,
          dataResidency: 'any',
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

    /**
     * A merge patch, not a replace — §8.12's org layer has four independent
     * settings and they are changed at different times by different people. The
     * previous signature took one required field, so adding the other three
     * would otherwise have meant sending all four on every call.
     */
    async setGovernance({ orgId, defaultApprovalMode, twoFactorRequired, dataResidency, retentionDays }) {
      const set: Partial<typeof orgSettings.$inferInsert> = { updatedAt: new Date() };
      if (defaultApprovalMode !== undefined) set.defaultApprovalMode = defaultApprovalMode;
      if (twoFactorRequired !== undefined) set.twoFactorRequired = twoFactorRequired;
      if (dataResidency !== undefined) set.dataResidency = dataResidency;
      // `null` is meaningful here and is not the same as omitted: it clears the
      // policy back to "keep indefinitely".
      if (retentionDays !== undefined) set.retentionDays = retentionDays;

      await db
        .insert(orgSettings)
        .values({ orgId, ...set })
        .onConflictDoUpdate({ target: orgSettings.orgId, set });
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

function toRecord(row: typeof orgSettings.$inferSelect, monthlyCapCents: number): OrgSettingsRecord {
  return {
    orgId: row.orgId,
    plan: row.plan as 'starter' | 'growth' | 'agency',
    defaultApprovalMode: row.defaultApprovalMode,
    ssoRequired: row.ssoRequired,
    twoFactorRequired: row.twoFactorRequired,
    dataResidency: row.dataResidency,
    // Absent, not zero: no policy means keep indefinitely, and a 0 would read
    // as "delete everything immediately".
    ...(row.retentionDays !== null ? { retentionDays: row.retentionDays } : {}),
    monthlyCapCents,
    updatedAt: row.updatedAt,
  };
}
