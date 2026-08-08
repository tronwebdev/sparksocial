import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

/**
 * CONNECTION FACTORY — Azure Database for PostgreSQL Flexible Server.
 *
 * A plain `pg.Pool` rather than a serverless/edge driver: the API runs on Azure
 * Container Apps (CLAUDE.md), a long-lived container, so there is no cold-start
 * pressure pushing toward an HTTP-based driver, and `pg` is what every migration
 * tool and admin script in this repo already assumes.
 *
 * `pgvector` must be allow-listed as a server parameter on the Flexible Server
 * before `CREATE EXTENSION vector` succeeds — see CLAUDE.md's Azure section. This
 * factory does not create the extension; that is a one-time migration concern
 * (`drizzle.config.ts` + the generated SQL), not a per-connection one.
 */

export type Database = NodePgDatabase<typeof schema>;

export interface ConnectOptions {
  /** Defaults to `process.env.DATABASE_URL`. Azure Flexible Server requires `sslmode=require`. */
  connectionString?: string;
  /**
   * Connections **per replica**, not in total — the number that matters is
   * `max × maxReplicas`. `infra/azure/bootstrap.sh` currently scales to 3, so
   * the default 10 means a ceiling of 30 server-side connections, comfortably
   * inside a Flexible Server's limit (a small B-series tier allows ~50).
   *
   * Raise `maxReplicas` and this stops being true quietly: Postgres refuses new
   * connections with "too many clients", which surfaces as the API failing
   * *every* request rather than degrading. If replicas go past ~5, either lower
   * this or put PgBouncer in front — the pool size is not an isolated knob.
   */
  max?: number;
}

export function connect(opts: ConnectOptions = {}): { db: Database; pool: Pool } {
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Azure Database for PostgreSQL connection string is required ' +
        'to run against Postgres — see CLAUDE.md § Infrastructure — Azure.',
    );
  }

  const pool = new Pool({
    connectionString,
    max: opts.max ?? 10,
    // Azure Flexible Server terminates idle connections; keep the pool from
    // holding onto ones the server has already dropped.
    idleTimeoutMillis: 30_000,
  });

  return { db: drizzle(pool, { schema }), pool };
}

export { schema };
