import { serve } from '@hono/node-server';
import { makeRunGuardrails } from '@sparksocial/guardrails';
import { createApp, memoryInvokeDeps } from './app.js';
import { registerAlphaTools } from './tools.js';
import { devResolveCtx, makeDevResolveCtx, devBrandGovernance } from './dev-auth.js';
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

if (env === 'production' && process.env.ALLOW_DEV_AUTH !== 'true') {
  // The dev resolver trusts request headers for tenancy. Shipping that to
  // production would make genome isolation forgeable by any caller, so refuse to
  // start rather than serve something that looks like it works.
  throw new Error(
    'Refusing to start: production requires a real auth resolver (Clerk). ' +
      'Set ALLOW_DEV_AUTH=true only for a throwaway environment.',
  );
}

// `DATABASE_URL` set → Postgres persists genomes/assets/content/tool_calls (plan
// §5). Unset → the in-memory dev store, seeded with the golden set, same as
// before this wiring existed. Independent of the auth-resolver guard above: a
// throwaway environment can point at real Postgres while still trusting
// headers for tenancy, or vice versa.
const pg = process.env.DATABASE_URL ? connectPostgresStore() : undefined;

const app = createApp({
  resolveCtx: pg ? makeDevResolveCtx(pg.scopedDb) : devResolveCtx,
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
