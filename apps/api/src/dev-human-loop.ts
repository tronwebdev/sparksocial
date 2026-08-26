import { randomUUID } from 'node:crypto';
import type { HumanLoopStore, HumanMessage } from '@sparksocial/tools/defineTool';

/**
 * In-memory `human.*` storage — the dev counterpart to the Postgres
 * `human_messages` table.
 *
 * Two rules are enforced here rather than in the handlers, because both are
 * properties of the *record* and a second caller must not be able to bypass
 * them by writing its own handler:
 *
 * 1. **An answer is written once.** `answer()` returns undefined on an already
 *    answered message. WhatsApp webhooks retry, and a retry that overwrites the
 *    owner's first reply with their second — or with a replayed copy of the
 *    first — silently changes a decision SPARK has already acted on.
 * 2. **`notify` is never answerable.** A notification is not a question; a
 *    reply to one must not read back as a decision.
 * 3. **`readAt` is set once and only on a `notify`.** Marking read is idempotent
 *    — a second pass reports zero rows changed rather than re-stamping a later
 *    timestamp over the moment the owner actually saw it.
 */
export function createDevHumanLoopStore(): HumanLoopStore & { size(): number } {
  const rows = new Map<string, HumanMessage & { orgId: string }>();

  return {
    size: () => rows.size,

    async create({ brandId, orgId, kind, body, options, urgency, runId }) {
      const row: HumanMessage & { orgId: string } = {
        id: `hm_${randomUUID()}`,
        orgId,
        brandId,
        kind,
        body,
        urgency,
        createdAt: new Date(),
        ...(options?.length ? { options } : {}),
        ...(runId ? { runId } : {}),
      };
      rows.set(row.id, row);
      return row;
    },

    async get(id, orgId) {
      const row = rows.get(id);
      return row && row.orgId === orgId ? row : undefined;
    },

    async listPending(brandId, orgId, limit) {
      return [...rows.values()]
        .filter((r) => r.orgId === orgId && r.brandId === brandId && r.kind === 'ask' && !r.answeredAt)
        // Oldest first: the question that has been blocking longest is the one
        // costing the most, and a newest-first inbox buries it.
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit);
    },

    async listNotifications(brandId, orgId, { limit, unreadOnly }) {
      return [...rows.values()]
        .filter(
          (r) =>
            r.orgId === orgId &&
            r.brandId === brandId &&
            r.kind === 'notify' &&
            (!unreadOnly || !r.readAt),
        )
        // Newest first, the opposite of `listPending` — see the Postgres
        // repository for why the two sorts differ on the same table.
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },

    async unreadNotificationCount(brandId, orgId) {
      return [...rows.values()].filter(
        (r) => r.orgId === orgId && r.brandId === brandId && r.kind === 'notify' && !r.readAt,
      ).length;
    },

    async markNotificationsRead({ brandId, orgId, ids }) {
      // An empty selection is "none", not "all" — see the Postgres repository.
      if (ids && ids.length === 0) return 0;
      const wanted = ids ? new Set(ids) : undefined;
      let changed = 0;
      for (const row of rows.values()) {
        if (row.orgId !== orgId || row.brandId !== brandId) continue;
        if (row.kind !== 'notify' || row.readAt) continue;
        if (wanted && !wanted.has(row.id)) continue;
        row.readAt = new Date();
        changed += 1;
      }
      return changed;
    },

    async answer({ id, orgId, answer, by }) {
      const row = rows.get(id);
      if (!row || row.orgId !== orgId) return undefined;
      if (row.kind !== 'ask') return undefined;
      if (row.answeredAt) return undefined;

      row.answer = answer;
      row.answeredAt = new Date();
      row.answeredBy = by;
      return row;
    },

    async markDelivered(id, orgId, channel) {
      const row = rows.get(id);
      if (row && row.orgId === orgId) row.channel = channel;
    },
  };
}
