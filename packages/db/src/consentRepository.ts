import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { ConsentRecord, ConsentStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { consentRecords } from './schema.js';

/**
 * `consent_records` backed by Postgres — likeness consent for avatar/voice
 * cloning (§10), read by `guardrails.gather()` to fill `rights()`'s
 * `avatarEnabled` input.
 *
 * Not routed through `scoped.ts`: consent is addressed to a *genome* but
 * carries no confidential generated content, matching why `human_messages`
 * sits outside `SCOPED_TABLES`. Every query here still filters on `orgId`.
 */
export function createConsentRepository(db: Database): ConsentStore {
  return {
    async grant({ genomeId, orgId, kind, subject, evidenceUrl, grantedBy }) {
      const [row] = await db
        .insert(consentRecords)
        .values({
          id: randomUUID(),
          orgId,
          genomeId,
          kind,
          subject,
          grantedBy,
          ...(evidenceUrl ? { evidenceUrl } : {}),
        })
        .returning();

      return toRecord(row!);
    },

    async revoke({ id, orgId, revokedBy }) {
      // Same write-once-latch pattern as `humanLoopRepository.answer`: the
      // WHERE clause is the arbitrator, so a replayed revoke can't clobber
      // an earlier one or "un-revoke" by racing a second write.
      const [row] = await db
        .update(consentRecords)
        .set({ revokedBy, revokedAt: sql`now()` })
        .where(and(eq(consentRecords.id, id), eq(consentRecords.orgId, orgId), isNull(consentRecords.revokedAt)))
        .returning();

      return row ? toRecord(row) : undefined;
    },

    async hasActive(genomeId, orgId, kind, subject) {
      // "Active" is a property of each subject's *newest* row, not "does an
      // un-revoked row exist somewhere" — an older still-open grant must not
      // paper over a newer, deliberate revocation of that same subject+kind.
      // With `subject` omitted this asks "is anyone currently cleared", i.e.
      // an OR across each subject's own newest-row state — so the rows are
      // pulled and reduced per-subject in JS rather than as one MAX query,
      // since the table is genome-scoped and small.
      const rows = await db
        .select({ subject: consentRecords.subject, revokedAt: consentRecords.revokedAt, grantedAt: consentRecords.grantedAt })
        .from(consentRecords)
        .where(
          and(
            eq(consentRecords.genomeId, genomeId),
            eq(consentRecords.orgId, orgId),
            eq(consentRecords.kind, kind),
            ...(subject !== undefined ? [eq(consentRecords.subject, subject)] : []),
          ),
        )
        .orderBy(desc(consentRecords.grantedAt));

      const newestBySubject = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        if (!newestBySubject.has(row.subject)) newestBySubject.set(row.subject, row);
      }
      return [...newestBySubject.values()].some((row) => row.revokedAt === null);
    },

    async list(genomeId, orgId) {
      const rows = await db
        .select()
        .from(consentRecords)
        .where(and(eq(consentRecords.genomeId, genomeId), eq(consentRecords.orgId, orgId)))
        .orderBy(desc(consentRecords.grantedAt));

      return rows.map(toRecord);
    },
  };
}

function toRecord(row: typeof consentRecords.$inferSelect): ConsentRecord {
  return {
    id: row.id,
    genomeId: row.genomeId,
    orgId: row.orgId,
    kind: row.kind,
    subject: row.subject,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt,
    ...(row.evidenceUrl ? { evidenceUrl: row.evidenceUrl } : {}),
    ...(row.revokedBy ? { revokedBy: row.revokedBy } : {}),
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
  };
}
