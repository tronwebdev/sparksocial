import { serve } from '@hono/node-server';
import { makeRunGuardrails } from '@sparksocial/guardrails';
import {
  anthropicModelClient,
  broadcastingRecorder,
  memoryRunEventBus,
  runAgent,
} from '@sparksocial/spark';
import { createApp, memoryInvokeDeps } from './app.js';
import { registerAlphaTools } from './tools.js';
import { makeDevResolveCtx, makeBrandGovernance } from './dev-auth.js';
import { makeClerkResolveCtx } from './clerk-auth.js';
import { createDevStore } from './dev-store.js';
import { createDevRunStore } from './dev-runs.js';
import { devEmbedClient } from './dev-vendors.js';
import { connectPostgresStore } from './pg-store.js';
import { createTelemetry } from './telemetry.js';

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

// Both keys, because `authenticateRequest` needs both. Treating a half-configured
// Clerk as "configured" would boot an API that 500s on every authenticated
// request; treating it as "unconfigured" would silently fall back to the
// header-trusting dev resolver, which is worse. Failing the check here means the
// dev resolver is used and the warning below is printed — visibly wrong rather
// than quietly insecure.
const clerkConfigured = Boolean(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);

if (env === 'production' && !clerkConfigured && process.env.ALLOW_DEV_AUTH !== 'true') {
  // Without Clerk the only resolver left trusts request headers for tenancy,
  // which makes genome isolation forgeable by any caller. Refuse to start rather
  // than serve something that looks like it works.
  throw new Error(
    'Refusing to start: production requires a real auth resolver. Set CLERK_SECRET_KEY and ' +
      'CLERK_PUBLISHABLE_KEY, or ALLOW_DEV_AUTH=true for a throwaway environment.',
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
// One run store, both halves. The dev reader and the dev recorder must share
// arrays or the Timeline renders empty while runs are being recorded beside it.
const devRuns = createDevRunStore();
const scopedDb = pg?.scopedDb ?? createDevStore(process.env.DEV_SEED_ORG_ID ?? 'org_dev', devRuns);

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
  console.warn(
    '[warn] CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY not both set — using the header-trusting dev resolver. ' +
      'Never do this in production.',
  );
}
// Budget and approval mode are still placeholders in both resolvers: there are no
// `brands` / `autonomy_policies` tables yet and credits land in P3, so the policy
// engine's spend limits are effectively a no-op. Tracked in docs/STATUS.md.

const telemetry = createTelemetry();

const baseInvokeDeps = pg
  ? { ...pg.auditDeps, runGuardrails: makeRunGuardrails(devEmbedClient()) }
  : memoryInvokeDeps({ runGuardrails: makeRunGuardrails(devEmbedClient()) });

/**
 * Telemetry rides on `writeToolCall` rather than being called from handlers.
 *
 * `invokeTool` writes exactly one audit row per invocation, for every outcome
 * including denials — so decorating it is the only place that sees all of them
 * and cannot be forgotten by the author of the next tool. Instrumenting
 * handlers instead would mean 26 call sites and a 27th that gets missed.
 *
 * The durable write happens first. A telemetry outage must never cost an audit
 * row, and `telemetry.toolCall` swallows its own failures.
 */
const invokeDeps = {
  ...baseInvokeDeps,
  writeToolCall: async (record: Parameters<typeof baseInvokeDeps.writeToolCall>[0]) => {
    await baseInvokeDeps.writeToolCall(record);
    telemetry.toolCall(record);
  },
};

// Anything that escapes the request path. `ToolError`s are decisions and are
// already on the audit row, so they are deliberately not reported here.
process.on('uncaughtException', (err) => telemetry.error(err, { kind: 'uncaughtException' }));
process.on('unhandledRejection', (err) => telemetry.error(err, { kind: 'unhandledRejection' }));

/**
 * The SPARK runtime is wired only when there is an API key to drive it. Without
 * one, `/v1/agent/runs` answers 501 — an honest "not configured" rather than a
 * run that starts, records a `started` row, and dies on the first model call.
 * The Timeline still works either way: it reads recorded runs, and 501 is not a
 * run.
 */
const agentConfigured = Boolean(process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN);
const bus = memoryRunEventBus();
const recorder = broadcastingRecorder(pg?.runRecorder ?? devRuns.recorder, bus);

const app = createApp({
  resolveCtx,
  loadBrandGovernance: makeBrandGovernance(scopedDb),
  // Wired now so the moment a tool declares `guardrails: [...]` on itself,
  // enforcement is live — no plumbing to add later.
  invokeDeps,
  telemetry: telemetry.status(),
  ...(process.env.REVISION ? { revision: process.env.REVISION } : {}),
  ...(agentConfigured
    ? {
        agent: {
          bus,
          run: (args) => runAgent(args, { model: anthropicModelClient(), invoke: invokeDeps, recorder }),
        },
      }
    : {}),
});

if (!agentConfigured) {
  console.warn('[warn] ANTHROPIC_API_KEY unset — /v1/agent/runs will answer 501. Timeline reads still work.');
}

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SparkSocial API listening on :${info.port} (${env})${pg ? ' [postgres]' : ' [in-memory]'}`);
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close(async () => {
      // Flush before exit: containers are killed without warning, and a
      // dropped buffer is exactly the trace you wanted for the crash.
      await telemetry.shutdown();
      await pg?.close();
      process.exit(0);
    });
  });
}
