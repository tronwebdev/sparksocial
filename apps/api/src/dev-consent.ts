import { randomUUID } from 'node:crypto';
import type { ConsentRecord, ConsentStore } from '@sparksocial/tools/defineTool';

/**
 * In-memory `consent_records` — the dev counterpart to the Postgres table
 * created for likeness consent (§10). Mirrors {@link createDevHumanLoopStore}:
 * the append-only / write-once-latch rule lives here rather than in a
 * handler, since it's a property of the record, not of any one caller.
 */
export function createDevConsentStore(): ConsentStore & { size(): number } {
  const rows = new Map<string, ConsentRecord>();

  return {
    size: () => rows.size,

    async grant({ genomeId, orgId, kind, subject, evidenceUrl, grantedBy }) {
      const row: ConsentRecord = {
        id: randomUUID(),
        genomeId,
        orgId,
        kind,
        subject,
        grantedBy,
        grantedAt: new Date(),
        ...(evidenceUrl ? { evidenceUrl } : {}),
      };
      rows.set(row.id, row);
      return row;
    },

    async revoke({ id, orgId, revokedBy }) {
      const row = rows.get(id);
      if (!row || row.orgId !== orgId) return undefined;
      if (row.revokedAt) return undefined;

      row.revokedBy = revokedBy;
      row.revokedAt = new Date();
      return row;
    },

    async hasActive(genomeId, orgId, kind, subject) {
      const matches = [...rows.values()]
        .filter(
          (r) =>
            r.genomeId === genomeId &&
            r.orgId === orgId &&
            r.kind === kind &&
            (subject === undefined || r.subject === subject),
        )
        .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());

      const newestBySubject = new Map<string, ConsentRecord>();
      for (const row of matches) {
        if (!newestBySubject.has(row.subject)) newestBySubject.set(row.subject, row);
      }
      return [...newestBySubject.values()].some((row) => !row.revokedAt);
    },

    async list(genomeId, orgId) {
      return [...rows.values()]
        .filter((r) => r.genomeId === genomeId && r.orgId === orgId)
        .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());
    },
  };
}
