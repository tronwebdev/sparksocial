import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Config } from 'drizzle-kit';

/**
 * `npm run generate` diffs `src/schema.ts` against `migrations/` and writes the
 * next SQL migration — no live database needed for that step. `npm run migrate`
 * applies pending migrations and does need `DATABASE_URL` (the Azure Flexible
 * Server connection string; CLAUDE.md § Infrastructure — Azure).
 *
 * ── Where DATABASE_URL comes from ─────────────────────────────────────────
 *
 * `apps/api/.env` in development; Key Vault via Container Apps env in Azure.
 * Nothing used to bridge the first case: this config read `process.env` only, so
 * `npm run migrate` in a fresh shell found nothing, fell back to a placeholder
 * host, and exited 1 having printed only that it had chosen the `pg` driver. The
 * actual problem — no connection string — was invisible.
 *
 * The loading happens here rather than in the npm script because drizzle-kit is
 * also run directly (`npx drizzle-kit migrate`, and by `generate`), and a script
 * wrapper only fixes the one entry point. Reading the file here makes every
 * entry point correct.
 */

/**
 * A deliberately small `.env` reader — `KEY=value`, `#` comments, optional
 * surrounding quotes. Not a dotenv replacement, and it must not become one: the
 * *only* consumer is this config, and `apps/api` parses its own env with Node's
 * `--env-file-if-exists`. If this ever needs `export` prefixes or multi-line
 * values, that is the signal to take the dependency rather than grow this.
 *
 * Values already present in `process.env` always win, so a real shell export and
 * Azure's injected environment both override the file rather than the reverse.
 */
function loadEnvFile(path: string): void {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    // Absent is normal, not an error: in Azure and in CI there is no file and
    // the values are already in the process env. Same reasoning as
    // `apps/api`'s `--env-file-if-exists`.
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    const raw = trimmed.slice(eq + 1).trim();
    process.env[key] =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(here, '../../apps/api/.env'));

export default {
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    /**
     * A getter, so this throws only when something actually needs a database.
     * `generate` legitimately runs without one, and an eager check would break
     * the command that is correct to run offline.
     *
     * Throwing rather than defaulting to `postgresql://placeholder/placeholder`
     * is the point: that fallback converted a missing configuration value into a
     * connection failure against a host that does not exist, which is the least
     * informative way to report it.
     */
    get url(): string {
      const url = process.env.DATABASE_URL;
      if (!url) {
        throw new Error(
          'DATABASE_URL is not set, so there is no database to migrate.\n' +
            '  • Local: set it in apps/api/.env — this config reads that file.\n' +
            '  • Azure: it comes from Key Vault via Container Apps, so run this from a ' +
            'machine that can reach the Flexible Server (CLAUDE.md: the sandbox cannot).',
        );
      }
      return url;
    },
  },
} satisfies Config;
