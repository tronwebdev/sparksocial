import { serve } from '@hono/node-server';
import { makeRunGuardrails } from '@sparksocial/guardrails';
import { createApp, memoryInvokeDeps } from './app.js';
import { registerAlphaTools } from './tools.js';
import { makeDevResolveCtx, devBrandGovernance } from './dev-auth.js';
import { makeClerkResolveCtx } from './clerk-auth.js';
import { createDevStore } from './dev-store.js';
import { devEmbedClient } from './dev-vendors.js';
import { connectPostgresStore } from './pg-store.js';

/**
 * Entrypoint. Azure Container Apps runs this behind Front Door.
 *
 * `PORT` is supplied by the platform; default 8080 matches the Container Apps
 * ingress convention. `REVISION` is stamped by the deploy workflow from the
 * commit SHA so `/health` can confirm which build is actually live — the cheapest
 * possible answer to "did the deploy land?".
 */

const port = Number(process.env.PORT ?? 8080);
const env = process.env.NODE_ENV ?? 'development';

registerAlphaTools();

const clerkConfigured = Boolean(process.env.CLERK_SECRET_KEY);

if (env === 'production' && !clerkConfigured && process.env.ALLOW_DEV_AUTH !== 'true') {
  // Without Clerk the only resolver left trusts request headers for tenancy,
  // which makes genome isolation forgeable by any caller. Refuse to start rather
  // than serve something that looks like it works.
  throw new Error(
    'Refusing to start: production requires a real auth resolver. Set CLERK_SECRET_KEY, ' +
      'or ALLOW_DEV_AUTH=true for a throwaway environment.',
  );
}

// `DATABASE_URL` set → Postgres persists genomes/assets/content/tool_calls (plan
// §5). Unset → the in-memory dev store, seeded with the golden set. Independent
// of the auth choice below: a throwaway environment can point at real Postgres
// while still trusting headers for tenancy, or vice versa.
const pg = process.env.DATABASE_URL ? connectPostgresStore() : undefined;

/**
 * The dev store seeds the golden set under one org id. Locally that must be the
 * *caller's* Clerk org, or every genome lookup 403s against a store that does
 * contain the genome — a confusing failure that looks like a bug in the resolver.
 */
const scopedDb = pg?.scopedDb ?? createDevStore(process.env.DEV_SEED_ORG_ID ?? 'org_dev');

const resolveCtx = clerkConfigured
  ? makeClerkResolveCtx({
      db: scopedDb,
      authorizedParties: (process.env.CLERK_AUTHORIZED_PARTIES ?? 'http://localhost:3000')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    })
  : makeDevResolveCtx(scopedDb);

if (!clerkConfigured) {
  console.warn('[warn] CLERK_SECRET_KEY unset — using the header-trusting dev resolver. Never do this in production.');
}
// Budget and approval mode are still placeholders in both resolvers: there are no
// `brands` / `autonomy_policies` tables yet and credits land in P3, so the policy
// engine's spend limits are effectively a no-op. Tracked in docs/STATUS.md.

const app = createApp({
  resolveCtx,
  loadBrandGovernance: devBrandGovernance,
  // Wired now so the moment a tool declares `guardrails: [...]` on itself,
  // enforcement is live — no plumbing to add later.
  invokeDeps: pg
    ? { ...pg.auditDeps, runGuardrails: makeRunGuardrails(devEmbedClient()) }
    : memoryInvokeDeps({ runGuardrails: makeRunGuardrails(devEmbedClient()) }),
  ...(process.env.REVISION ? { revision: process.env.REVISION } : {}),
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SparkSocial API listening on :${info.port} (${env})${pg ? ' [postgres]' : ' [in-memory]'}`);
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close(async () => {
      await pg?.close();
      process.exit(0);
    });
  });
}
