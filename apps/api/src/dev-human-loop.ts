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
