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
import { embedClient } from './embed-client.js';
import { connectPostgresStore } from './pg-store.js';
import { createTelemetry } from './telemetry.js';
import { langfuseRecorder } from './langfuse-recorder.js';
import { createDevCreditStore } from './dev-credits.js';
import { createDevApprovalStore } from './dev-approvals.js';
import { makeApprovalExecutor, withApprovalQueue } from './approval-wiring.js';
import { registerApprovalTools } from './tools.js';
import { envList, envNum, envSet, envStr } from './env.js';

/**
 * Entrypoint. Azure Container Apps runs this behind Front Door.
 *
 * `PORT` is supplied by the platform; default 8080 matches the Container Apps
 * ingress convention. `REVISION` is stamped by the deploy workflow from the
 * commit SHA so `/health` can confirm which build is actually live — the cheapest
 * possible answer to "did the deploy land?".
 */

const port = envNum('PORT', 8080);
const env = envStr('NODE_ENV', 'development');

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

/**
 * Built before the store because the queue reads held inputs back out of the
 * audit rows, and in the in-memory path those rows live in `memoryInvokeDeps`.
 * Postgres joins `approvals` to `tool_calls` for the same reason — one copy of
 * what was called, never two that can disagree.
 */
const memoryDeps = memoryInvokeDeps({ runGuardrails: makeRunGuardrails(embedClient()) });
const devApprovals = createDevApprovalStore((callId) => memoryDeps.rows.find((r) => r.id === callId));

const scopedDb =
  pg?.scopedDb ??
  createDevStore({
    orgId: envStr('DEV_SEED_ORG_ID', 'org_dev'),
    runStore: devRuns,
    approvalStore: devApprovals,
    findCall: (callId) => memoryDeps.rows.find((r) => r.id === callId),
  });

/**
 * The ledger behind `policy.ts` rule 4 (plan §9). Postgres when it is
 * configured, in-memory otherwise — the same choice the scoped store makes, so
 * spend is enforced in local development instead of only in production.
 */
const credits = pg?.credits ?? createDevCreditStore();

const resolveCtx = clerkConfigured
  ? makeClerkResolveCtx({
      db: scopedDb,
      credits,
      authorizedParties: envList('CLERK_AUTHORIZED_PARTIES', ['http://localhost:3000']),
    })
  : makeDevResolveCtx(scopedDb, credits);

if (!clerkConfigured) {
  console.warn(
    '[warn] CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY not both set — using the header-trusting dev resolver. ' +
      'Never do this in production.',
  );
}
// Approval mode, the kill switch and spend all now read from storage, so every
// rung of `policy.ts` is reachable in a running system. What remains a
// placeholder is the *cap*: `org_budgets` defaults every organisation to the
// same figure because there is no billing integration to set it from.

const telemetry = createTelemetry();

const baseInvokeDeps = pg
  ? { ...pg.auditDeps, runGuardrails: makeRunGuardrails(embedClient()) }
  : memoryDeps;

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
const withTelemetry = {
  ...baseInvokeDeps,
  writeToolCall: async (record: Parameters<typeof baseInvokeDeps.writeToolCall>[0]) => {
    await baseInvokeDeps.writeToolCall(record);
    telemetry.toolCall(record);
  },

  /**
   * Spend, appended to the ledger (plan §9).
   *
   * `invokeTool` calls this only when a handler actually ran and only when the
   * estimate was non-zero, and returns early on an idempotent replay before
   * reaching it — so this fires once per real charge. The unique index on
   * `call_id` is the backstop for retries introduced elsewhere later.
   *
   * Failures are swallowed for the same reason telemetry's are, but the
   * trade-off is the opposite way round and worth stating: dropping a charge
   * loses money, and throwing here would fail a call whose side effects already
   * happened — a post is already public, a video already rendered. Reporting
   * that as a failure invites a retry that does it all again. Losing the charge
   * is the cheaper error, and it is logged loudly enough to reconcile.
   */
  recordCost: async (record: Parameters<typeof baseInvokeDeps.writeToolCall>[0]) => {
    try {
      await credits.record({
        callId: record.id,
        orgId: record.orgId,
        tool: record.tool,
        costCents: record.costCents,
        at: record.at,
        ...(record.brandId ? { brandId: record.brandId } : {}),
      });
    } catch (e) {
      console.error('[error] credit ledger write failed — charge lost', {
        callId: record.id,
        orgId: record.orgId,
        costCents: record.costCents,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
};

// Held calls land in the Review queue. Without this, `review_first_week` and
// `review_everything` gate work into nothing anyone can act on.
const invokeDeps = withApprovalQueue(withTelemetry, (a) => scopedDb.approvals.enqueue(a));

registerApprovalTools(
  makeApprovalExecutor({
    deps: invokeDeps,
    loadBrandGovernance: makeBrandGovernance(scopedDb),
    lookupCall: pg
      ? pg.lookupCall
      : async (callId, orgId) => memoryDeps.rows.find((r) => r.id === callId && r.orgId === orgId),
  }),
);

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
const agentConfigured = envSet('ANTHROPIC_API_KEY') || envSet('ANTHROPIC_AUTH_TOKEN');
const bus = memoryRunEventBus();
/**
 * Order matters. Langfuse wraps the durable recorder first, then the SSE
 * broadcaster wraps that — so a trace is only emitted for a step that actually
 * persisted, and the browser is only told about steps that both persisted and
 * traced.
 */
const durableRecorder = pg?.runRecorder ?? devRuns.recorder;
const tracedRecorder = telemetry.langfuse
  ? langfuseRecorder(durableRecorder, telemetry.langfuse)
  : durableRecorder;
const recorder = broadcastingRecorder(tracedRecorder, bus);

/**
 * Inbound WhatsApp, only when Meta is actually configured.
 *
 * `resolveTenant` is the honest gap: Meta gives us a phone number and nothing
 * else, and no table maps a number to a brand yet — `whatsapp.send` does not
 * record which brand a recipient belongs to. Until it does, a single-tenant
 * mapping via env makes the loop testable end to end without pretending the
 * lookup exists. Multi-tenant inbound needs that column first.
 */
const whatsappWebhook = envSet('WHATSAPP_APP_SECRET')
  ? {
      invokeDeps,
      loadBrandGovernance: makeBrandGovernance(scopedDb),
      appSecret: envStr('WHATSAPP_APP_SECRET', ''),
      verifyToken: envStr('WHATSAPP_VERIFY_TOKEN', ''),
      async resolveTenant() {
        const orgId = envStr('WHATSAPP_ORG_ID', '');
        const brandId = envStr('WHATSAPP_BRAND_ID', '');
        return orgId && brandId ? { orgId, brandId } : undefined;
      },
      async systemCtx({ orgId, brandId }: { orgId: string; brandId: string }) {
        const base = await makeDevResolveCtx(scopedDb, credits)(
          new Request('http://localhost/', {
            headers: { 'x-org-id': orgId, 'x-brand-id': brandId, 'x-role': 'admin' },
          }),
        );
        // No `userId`: nobody signed in. The tool attributes the answer to
        // `whatsapp:<number>` instead, which is the truthful record — a person
        // texted, they did not authenticate.
        const { userId: _drop, caller: _caller, ...ctx } = base;
        return ctx;
      },
    }
  : undefined;

if (!envSet('WHATSAPP_APP_SECRET')) {
  console.warn(
    '[warn] WHATSAPP_APP_SECRET unset — the inbound webhook is not registered. Owners can be sent ' +
      'capture sessions but their replies cannot reach SPARK.',
  );
}

const app = createApp({
  resolveCtx,
  loadBrandGovernance: makeBrandGovernance(scopedDb),
  // Wired now so the moment a tool declares `guardrails: [...]` on itself,
  // enforcement is live — no plumbing to add later.
  invokeDeps,
  telemetry: telemetry.status(),
  ...(whatsappWebhook ? { whatsappWebhook } : {}),
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
