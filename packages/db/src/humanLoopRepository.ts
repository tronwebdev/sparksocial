import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { HumanLoopStore, HumanMessage } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { humanMessages } from './schema.js';

/**
 * `human_messages` backed by Postgres — SPARK's questions to the owner.
 *
 * Not routed through `scoped.ts`: a question is addressed to a *brand*, and
 * `human_messages` carries no genome-confidential material, so it sits outside
 * `SCOPED_TABLES` for the same reason `brands` and `campaigns` do. Every query
 * here still filters on `orgId`.
 */
export function createHumanLoopRepository(db: Database): HumanLoopStore {
  return {
    async create({ brandId, orgId, kind, body, options, urgency, runId }) {
      const [row] = await db
        .insert(humanMessages)
        .values({
          id: `hm_${randomUUID()}`,
          orgId,
          brandId,
          kind,
          body,
          urgency,
          ...(options?.length ? { options } : {}),
          ...(runId ? { runId } : {}),
        })
        .returning();

      return toMessage(row!);
    },

    async get(id, orgId) {
      const [row] = await db
        .select()
        .from(humanMessages)
        .where(and(eq(humanMessages.id, id), eq(humanMessages.orgId, orgId)))
        .limit(1);

      return row ? toMessage(row) : undefined;
    },

    async listPending(brandId, orgId, limit) {
      const rows = await db
        .select()
        .from(humanMessages)
        .where(
          and(
            eq(humanMessages.orgId, orgId),
            eq(humanMessages.brandId, brandId),
            eq(humanMessages.kind, 'ask'),
            isNull(humanMessages.answeredAt),
          ),
        )
        // Oldest first: the question blocking longest is the one costing most.
        .orderBy(asc(humanMessages.createdAt))
        .limit(limit);

      return rows.map(toMessage);
    },

    async listNotifications(brandId, orgId, { limit, unreadOnly }) {
      const rows = await db
        .select()
        .from(humanMessages)
        .where(
          and(
            eq(humanMessages.orgId, orgId),
            eq(humanMessages.brandId, brandId),
            eq(humanMessages.kind, 'notify'),
            ...(unreadOnly ? [isNull(humanMessages.readAt)] : []),
          ),
        )
        /**
         * Newest first, the opposite of `listPending`. A blocking question is
         * ordered oldest-first because the one waiting longest costs most; a
         * notification is ordered newest-first because the most recent thing
         * that happened is the one worth reading. Same table, opposite sorts,
         * for the same reason.
         */
        .orderBy(desc(humanMessages.createdAt))
        .limit(limit);

      return rows.map(toMessage);
    },

    async unreadNotificationCount(brandId, orgId) {
      const [row] = await db
        .select({ n: count() })
        .from(humanMessages)
        .where(
          and(
            eq(humanMessages.orgId, orgId),
            eq(humanMessages.brandId, brandId),
            eq(humanMessages.kind, 'notify'),
            isNull(humanMessages.readAt),
          ),
        );
      return Number(row?.n ?? 0);
    },

    async markNotificationsRead({ brandId, orgId, ids }) {
      /**
       * `isNull(readAt)` is in the WHERE clause, not just for correctness but so
       * the returned count means "how many were newly read". Without it, marking
       * an already-read list would report rows changed and a badge would flicker
       * a number nobody caused.
       *
       * An empty `ids` array is not "all" — it is "none", and matching nothing is
       * the honest reading. Marking everything read because a caller sent an
       * empty selection would silently clear an inbox somebody was looking at.
       */
      if (ids && ids.length === 0) return 0;

      const rows = await db
        .update(humanMessages)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(humanMessages.orgId, orgId),
            eq(humanMessages.brandId, brandId),
            eq(humanMessages.kind, 'notify'),
            isNull(humanMessages.readAt),
            ...(ids ? [inArray(humanMessages.id, ids)] : []),
          ),
        )
        .returning({ id: humanMessages.id });

      return rows.length;
    },

    async answer({ id, orgId, answer, by }) {
      /**
       * The write-once latch, enforced in the WHERE clause rather than by a
       * read-then-write.
       *
       * WhatsApp retries webhooks, and two deliveries of the same reply can be
       * in flight at once. A check-then-update would let both pass the check
       * and the second overwrite the first — changing an answer SPARK may have
       * already acted on. `isNull(answeredAt)` makes the database the
       * arbitrator: exactly one update matches, the loser returns nothing, and
       * `whatsapp.receive` treats that as "already answered" rather than an
       * error.
       */
      const [row] = await db
        .update(humanMessages)
        .set({ answer, answeredBy: by, answeredAt: sql`now()` })
        .where(
          and(
            eq(humanMessages.id, id),
            eq(humanMessages.orgId, orgId),
            eq(humanMessages.kind, 'ask'),
            isNull(humanMessages.answeredAt),
          ),
        )
        .returning();

      return row ? toMessage(row) : undefined;
    },

    async markDelivered(id, orgId, channel) {
      await db
        .update(humanMessages)
        .set({ channel })
        .where(and(eq(humanMessages.id, id), eq(humanMessages.orgId, orgId)));
    },
  };
}

function toMessage(row: typeof humanMessages.$inferSelect): HumanMessage {
  return {
    id: row.id,
    brandId: row.brandId,
    kind: row.kind === 'notify' ? 'notify' : 'ask',
    body: row.body,
    urgency: (row.urgency === 'low' || row.urgency === 'high' ? row.urgency : 'normal'),
    createdAt: row.createdAt,
    ...(row.options?.length ? { options: row.options } : {}),
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.answer !== null ? { answer: row.answer } : {}),
    ...(row.answeredAt ? { answeredAt: row.answeredAt } : {}),
    ...(row.answeredBy ? { answeredBy: row.answeredBy } : {}),
    ...(row.channel ? { channel: row.channel } : {}),
    ...(row.readAt ? { readAt: row.readAt } : {}),
  };
}
