import { connect, createPostgresScopedDb, createAuditRepository } from '@sparksocial/db';
import type { InvokeDeps } from '@sparksocial/tools';
import type { ScopedDb } from '@sparksocial/tools/defineTool';

/**
 * POSTGRES-BACKED STORE — plan §5.
 *
 * Stands in for `dev-store.ts` once `DATABASE_URL` is set: the same `ScopedDb`
 * shape, backed by Azure Database for PostgreSQL instead of an in-memory Map.
 * `index.ts` picks between the two based on whether `DATABASE_URL` is present —
 * connecting is not itself a statement about whether the deployment is
 * "production"; that's still gated by `ALLOW_DEV_AUTH` on the auth resolver,
 * which this module has no opinion on.
 */
export function connectPostgresStore(): {
  scopedDb: ScopedDb;
  auditDeps: Pick<InvokeDeps, 'writeToolCall' | 'lookupIdempotent'>;
  close: () => Promise<void>;
} {
  const { db, pool } = connect();
  return {
    scopedDb: createPostgresScopedDb(db),
    auditDeps: createAuditRepository(db),
    close: () => pool.end(),
  };
}
