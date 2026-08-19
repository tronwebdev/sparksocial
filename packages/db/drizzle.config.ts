import type { Config } from 'drizzle-kit';

/**
 * `npm run generate` diffs `src/schema.ts` against `migrations/` and writes the
 * next SQL migration — no live database needed for that step. `npm run migrate`
 * applies pending migrations and does need `DATABASE_URL` (the Azure Flexible
 * Server connection string; CLAUDE.md § Infrastructure — Azure).
 */
export default {
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder/placeholder',
  },
} satisfies Config;
