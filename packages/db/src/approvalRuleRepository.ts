import { and, asc, eq } from 'drizzle-orm';
import type { ApprovalRuleRecord, ApprovalRuleStore } from '@sparksocial/tools/defineTool';
import type { Role } from '@sparksocial/shared/types';
import type { Database } from './client.js';
import { approvalRules } from './schema.js';

/**
 * `approval_rules` backed by Postgres — the workspace's "Approval flows".
 *
 * Not routed through `scoped.ts` for the same reason `team_groups` is not: a rule
 * is organisation governance, not genome-confidential material. Every query
 * filters on `orgId`.
 */
export function createApprovalRuleRepository(db: Database): ApprovalRuleStore {
  const shape = (r: typeof approvalRules.$inferSelect): ApprovalRuleRecord => ({
    id: r.id,
    orgId: r.orgId,
    trigger: r.trigger,
    ...(r.thresholdCents === null ? {} : { thresholdCents: r.thresholdCents }),
    requiresRole: r.requiresRole as Role,
    groupIds: r.groupIds,
    enabled: r.enabled,
    ...(r.createdBy === null ? {} : { createdBy: r.createdBy }),
    updatedAt: r.updatedAt,
  });

  return {
    async list(orgId) {
      const rows = await db
        .select()
        .from(approvalRules)
        .where(eq(approvalRules.orgId, orgId))
        // Oldest first, so the list on the settings screen does not reorder
        // itself when somebody edits a rule.
        .orderBy(asc(approvalRules.createdAt));
      return rows.map(shape);
    },

    async active(orgId) {
      const rows = await db
        .select()
        .from(approvalRules)
        .where(and(eq(approvalRules.orgId, orgId), eq(approvalRules.enabled, true)))
        .orderBy(asc(approvalRules.createdAt));
      return rows.map(shape);
    },

    async upsert({ orgId, id, trigger, thresholdCents, requiresRole, groupIds, enabled, createdBy }) {
      const values = {
        orgId,
        trigger,
        // Explicit null, not omitted: switching a rule from `spend_over` to
        // `publish` has to clear the threshold, and an omitted key would leave
        // the old one behind on the row.
        thresholdCents: thresholdCents ?? null,
        requiresRole,
        groupIds,
        enabled,
        updatedAt: new Date(),
        ...(createdBy ? { createdBy } : {}),
      };

      if (id) {
        const [updated] = await db
          .update(approvalRules)
          .set(values)
          .where(and(eq(approvalRules.id, id), eq(approvalRules.orgId, orgId)))
          .returning();
        // An id that matches nothing in this org falls through to an insert
        // rather than silently doing nothing — but with a fresh id, so it cannot
        // be used to write into another org's row.
        if (updated) return shape(updated);
      }

      const [created] = await db.insert(approvalRules).values(values).returning();
      return shape(created!);
    },

    async remove({ orgId, id }) {
      const deleted = await db
        .delete(approvalRules)
        .where(and(eq(approvalRules.id, id), eq(approvalRules.orgId, orgId)))
        .returning({ id: approvalRules.id });
      return deleted.length > 0;
    },
  };
}
