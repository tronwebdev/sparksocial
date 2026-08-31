import {
  connect,
  createPostgresScopedDb,
  createAuditRepository,
  createCreditRepository,
  createRunRecorder,
  createDueContentSource,
  createOutcomeCandidateSource,
  createAccountLookup,
  lookupToolCall,
  type DueContentItem,
  type OutcomeCandidateSource,
  type AccountLookup,
} from '@sparksocial/db';
import type { CreditStore, InvokeDeps, ToolCallRecord } from '@sparksocial/tools';
import type { ScopedDb } from '@sparksocial/tools/defineTool';
import type { RunRecorder } from '@sparksocial/spark';

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
  credits: CreditStore;
  runRecorder: RunRecorder;
  /** Replay source for the Review queue — see approval-wiring.ts. */
  lookupCall: (callId: string, orgId: string) => Promise<ToolCallRecord | undefined>;
  /** The scheduler's read — see scheduler.ts. */
  findDue: (before: Date, limit: number) => Promise<DueContentItem[]>;
  /** The learning loop's two cross-tenant reads — see outcome-observer.ts. */
  outcomes: OutcomeCandidateSource;
  /** The engagement webhook's tenant resolution — see engage-webhook.ts. */
  accounts: AccountLookup;
  close: () => Promise<void>;
} {
  const { db, pool } = connect();
  return {
    scopedDb: createPostgresScopedDb(db),
    auditDeps: createAuditRepository(db),
    credits: createCreditRepository(db),
    runRecorder: createRunRecorder(db),
    lookupCall: (callId, orgId) => lookupToolCall(db, callId, orgId),
    findDue: createDueContentSource(db).findDue,
    outcomes: createOutcomeCandidateSource(db),
    accounts: createAccountLookup(db),
    close: () => pool.end(),
  };
}
