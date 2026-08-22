import { serve } from '@hono/node-server';
import { makeRunGuardrails } from '@sparksocial/guardrails';
import {
  anthropicModelClient,
  broadcastingRecorder,
  memoryRunEventBus,
  runAgent,
} from '@sparksocial/spark';
import { createApp, memoryInvokeDeps } from './app.js';
import { createClerkClient } from '@clerk/backend';
import { registerAlphaTools, registerAgencyTools, localBlobStoreForRoutes } from './tools.js';
import { registerLocalStorageRoutes } from './local-storage-routes.js';
import { registerCanvaOAuthCallback } from './canva-oauth.js';
import { registerSocialOAuthCallback } from './social-oauth.js';
import { socialClientIds, socialClientSecrets } from './social-adapter-clients.js';
import { makeDevResolveCtx, makeBrandGovernance } from './dev-auth.js';
import { makeClerkResolveCtx } from './clerk-auth.js';
import { createDevStore } from './dev-store.js';
import { createDevRunStore } from './dev-runs.js';
import { embedClient } from './embed-client.js';
import { connectPostgresStore } from './pg-store.js';
import { startScheduler } from './scheduler.js';
import { startRecipeScheduler } from './recipe-scheduler.js';
import { startTrendObserver } from './trend-observer.js';
import { startConnectionWatcher } from './connection-watcher.js';
import { startOutcomeObserver } from './outcome-observer.js';
import { createTelemetry } from './telemetry.js';
import { langfuseRecorder } from './langfuse-recorder.js';
import { createDevCreditStore } from './dev-credits.js';
import { createDevApprovalStore } from './dev-approvals.js';
import { makeApprovalExecutor, withApprovalQueue } from './approval-wiring.js';
import { registerApprovalTools } from './tools.js';
import { envList, envNum, envSet, envStr } from './env.js';
import { describeModelVendors } from './model-client.js';
import { describeEngageWebhook } from './engage-webhook.js';

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
// §5). Unset → the in-memory dev store, empty until a real tool call writes to
// it. Independent of the auth choice below: a throwaway environment can point
// at real Postgres while still trusting headers for tenancy, or vice versa.
const pg = process.env.DATABASE_URL ? connectPostgresStore() : undefined;

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

// Captured separately from `scopedDb` below so the scheduler can still reach
// `.findDue` in dev mode — `scopedDb`'s declared type is the plain `ScopedDb`
// interface, which doesn't carry it.
const devStore = pg
  ? undefined
  : createDevStore({
      runStore: devRuns,
      approvalStore: devApprovals,
      findCall: (callId) => memoryDeps.rows.find((r) => r.id === callId),
      // PRD §5's publish-attempt/block/draft counts, read off the same rows
      // rather than a copy — same reasoning as `findCall` above.
      allCalls: () => memoryDeps.rows,
    });

const scopedDb = pg?.scopedDb ?? devStore!;

/**
 * The ledger behind `policy.ts` rule 4 (plan §9). Postgres when it is
 * configured, in-memory otherwise — the same choice the scoped store makes, so
 * spend is enforced in local development instead of only in production.
 */
const credits = pg?.credits ?? createDevCreditStore();

/**
 * `org.*`/`brand.*`/`team.*`/`whitelabel.*` (§6.9, §12 P6) need `credits`
 * (deliberately not reachable through `ScopedDb`, so `registerAlphaTools()`
 * above — which has no dependencies — cannot register them) and, for
 * `team.invite`/`team.role.set`, a real Clerk client. A second `ClerkClient`
 * instance, separate from the one `makeClerkResolveCtx` builds internally:
 * both are stateless HTTP wrappers around the same secret key, so two
 * instances cost nothing and neither needs the other's internals exposed.
 */
/**
 * `brand.oauth.connect` (the Canva half of the Bulk Connector, §12 P5) needs
 * all three of an app registration and a dedicated signing secret for its
 * `state` param — unset → not registered, same rule as `team.invite` above.
 * `CANVA_REDIRECT_URI` defaults to this API's own callback route on the
 * loopback IP so local dev works without setting it, matching the redirect
 * URI that must also be registered in the Canva developer app itself.
 * **127.0.0.1, not localhost** — Canva's redirect-URI validation rejects
 * `localhost` outright (confirmed against their current dashboard
 * requirements); a default of `localhost` here would register a URI in
 * `.env` that can never match what the developer app requires.
 */
const canvaOAuthConfigured = envSet('CANVA_CLIENT_ID') && envSet('CANVA_CLIENT_SECRET') && envSet('OAUTH_STATE_SECRET');
const canvaRedirectUri = envStr('CANVA_REDIRECT_URI', `http://127.0.0.1:${port}/oauth/canva/callback`);

/**
 * `integration.connect` (native publishing platforms — Instagram, TikTok,
 * LinkedIn, X, YouTube) shares `OAUTH_STATE_SECRET` with Canva's flow —
 * one signing secret for every PKCE handshake in this API, not a
 * per-provider one, since it signs an envelope and never touches a vendor.
 * `SOCIAL_REDIRECT_URI` defaults to this API's own callback route the same
 * way `CANVA_REDIRECT_URI` does, same loopback-IP reasoning. Registered
 * whenever the secret is set, regardless of which (if any) individual
 * platform's client id/secret is configured — `integration.connect`'s own
 * handler refuses a specific unconfigured provider by name rather than the
 * whole tool being absent.
 */
const socialOAuthConfigured = envSet('OAUTH_STATE_SECRET');
const socialRedirectUri = envStr('SOCIAL_REDIRECT_URI', `http://127.0.0.1:${port}/oauth/social/callback`);

registerAgencyTools({
  credits,
  ...(clerkConfigured
    ? { clerk: createClerkClient({ secretKey: envStr('CLERK_SECRET_KEY', ''), publishableKey: envStr('CLERK_PUBLISHABLE_KEY', '') }) }
    : {}),
  ...(canvaOAuthConfigured
    ? { canvaOAuth: { clientId: envStr('CANVA_CLIENT_ID', ''), redirectUri: canvaRedirectUri, stateSecret: envStr('OAUTH_STATE_SECRET', '') } }
    : {}),
  ...(socialOAuthConfigured
    ? { socialOAuth: { clientIds: socialClientIds(), redirectUri: socialRedirectUri, stateSecret: envStr('OAUTH_STATE_SECRET', '') } }
    : {}),
});

if (!canvaOAuthConfigured) {
  console.warn(
    '[warn] CANVA_CLIENT_ID / CANVA_CLIENT_SECRET / OAUTH_STATE_SECRET not all set — brand.oauth.connect is not ' +
      "registered, so the Bulk Connector's canva source cannot be connected. Its drive/csv sources are unaffected.",
  );
}
if (!socialOAuthConfigured) {
  console.warn('[warn] OAUTH_STATE_SECRET unset — integration.connect is not registered, so no brand can connect a native publishing account.');
}

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

/**
 * Inbound engagement (§8.8) — the inbox's writer.
 *
 * Unlike WhatsApp, tenant resolution here is a real query rather than an env
 * mapping: a platform event names the account it happened on, and
 * `oauth_connections.account_id` maps that to a genome. That is what makes this
 * webhook multi-tenant from the start — and why it refuses rather than guesses
 * when one account resolves to two genomes.
 */
const engageWebhook =
  envSet('META_APP_SECRET') || envSet('ENGAGE_WEBHOOK_SECRET')
    ? {
        invokeDeps,
        loadBrandGovernance: makeBrandGovernance(scopedDb),
        ...(envSet('META_APP_SECRET') ? { metaAppSecret: envStr('META_APP_SECRET', '') } : {}),
        ...(envSet('META_VERIFY_TOKEN') ? { metaVerifyToken: envStr('META_VERIFY_TOKEN', '') } : {}),
        ...(envSet('ENGAGE_WEBHOOK_SECRET') ? { aggregatorSecret: envStr('ENGAGE_WEBHOOK_SECRET', '') } : {}),
        lookupAccount: pg ? pg.accounts.byAccount : devStore!.byAccount,
        async brandForGenome(genomeId: string, orgId: string) {
          const genome = await scopedDb.genomes.get(genomeId, orgId);
          return genome?.workspace_id;
        },
        async systemCtx({ orgId, brandId, genomeId }: { orgId: string; brandId: string; genomeId: string }) {
          const base = await makeDevResolveCtx(scopedDb, credits)(
            new Request('http://localhost/', {
              headers: {
                'x-org-id': orgId,
                'x-brand-id': brandId,
                // The genome the account resolved to. This is what puts every
                // subsequent query back inside the scoped layer.
                'x-genome-id': genomeId,
                'x-role': 'admin',
              },
            }),
          );
          // No `userId`: nobody signed in. A member of the public commented.
          const { userId: _drop, caller: _caller, ...ctx } = base;
          return ctx;
        },
      }
    : undefined;

if (!envSet('META_APP_SECRET') && !envSet('ENGAGE_WEBHOOK_SECRET')) {
  console.warn(
    '[warn] neither META_APP_SECRET nor ENGAGE_WEBHOOK_SECRET is set \u2014 the engagement inbox has no ' +
      'writer. Comments and DMs will not arrive, so the feed, the classifier and auto-reply have ' +
      'nothing to work on.',
  );
}

if (!envSet('WHATSAPP_APP_SECRET')) {
  console.warn(
    '[warn] WHATSAPP_APP_SECRET unset — the inbound webhook is not registered. Owners can be sent ' +
      'capture sessions but their replies cannot reach SPARK.',
  );
}

/**
 * The scheduler — closes the "content.schedule sets scheduledAt and nothing
 * ever reads it back" gap (P4 survey). No queue infra exists yet, so this is
 * a poll loop, same trade-off `scheduler.ts`'s own comment explains. Started
 * unconditionally: it costs one no-op query per tick when nothing is due,
 * and gating it on an env flag would just be one more way to forget to turn
 * it on.
 */
const scheduler = startScheduler(
  {
    source: pg ? { findDue: pg.findDue } : { findDue: devStore!.findDue },
    db: scopedDb,
    invoke: invokeDeps,
    loadBrandGovernance: makeBrandGovernance(scopedDb),
    credits,
  },
  envNum('SCHEDULER_INTERVAL_MS', 60_000),
);

/**
 * The recipe scheduler (§12 P5) — same poll-loop trade-off as the publish
 * scheduler above, started unconditionally for the same reason: gating it on
 * an env flag is one more way to forget to turn it on, and one no-op query
 * per tick when nothing is due costs nothing.
 */
const recipeScheduler = startRecipeScheduler(
  {
    db: scopedDb,
    invoke: invokeDeps,
    loadBrandGovernance: makeBrandGovernance(scopedDb),
  },
  envNum('RECIPE_SCHEDULER_INTERVAL_MS', 300_000),
);

/**
 * The trend observer (§8.9) — samples the trend source on a clock so the
 * `DISC-02` time series does not go blank overnight. Hourly by default, which
 * is the resolution the store buckets to; a shorter interval would write no
 * extra rows.
 */
const trendObserver = startTrendObserver(
  {
    db: scopedDb,
    invoke: invokeDeps,
  },
  envNum('TREND_OBSERVER_INTERVAL_MS', 3_600_000),
);

/**
 * The connection watcher (§10) — warns the owner before a platform token
 * expires, so an expiring connection is not discovered by a week of posts
 * silently failing. Every six hours: the warning window is seven days, so a
 * tighter interval only re-reads the same rows.
 */
const connectionWatcher = startConnectionWatcher(
  {
    db: scopedDb,
    invoke: invokeDeps,
    loadBrandGovernance: makeBrandGovernance(scopedDb),
  },
  envNum('CONNECTION_WATCHER_INTERVAL_MS', 21_600_000),
);

/**
 * The outcome observer (§6.7) — the clock the learning loop never had.
 *
 * `analytics.sync` and `learning.record_outcome` were both built and registered
 * and nothing called either, so every genome's Thompson-sampling arms sat at
 * their cold-start priors indefinitely. Started unconditionally for the same
 * reason as the schedulers above: one no-op query per tick costs nothing, and an
 * env flag is one more way to forget to turn it on.
 *
 * Every fifteen minutes. The tightest resync cadence is three hours and the
 * maturation window is measured in days, so a shorter interval finds nothing new
 * — the frequency is here so a post published between ticks is picked up
 * promptly on its first sync, not to re-read the same rows.
 */
const outcomeObserver = startOutcomeObserver(
  {
    source: pg ? pg.outcomes : devStore!,
    db: scopedDb,
    invoke: invokeDeps,
    loadBrandGovernance: makeBrandGovernance(scopedDb),
  },
  envNum('OUTCOME_OBSERVER_INTERVAL_MS', 900_000),
);

const app = createApp({
  resolveCtx,
  loadBrandGovernance: makeBrandGovernance(scopedDb),
  // Wired now so the moment a tool declares `guardrails: [...]` on itself,
  // enforcement is live — no plumbing to add later.
  invokeDeps,
  telemetry: telemetry.status(),
  ...(whatsappWebhook ? { whatsappWebhook } : {}),
  ...(engageWebhook ? { engageWebhook } : {}),
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

if (canvaOAuthConfigured) {
  registerCanvaOAuthCallback(app, {
    clientId: envStr('CANVA_CLIENT_ID', ''),
    clientSecret: envStr('CANVA_CLIENT_SECRET', ''),
    redirectUri: canvaRedirectUri,
    stateSecret: envStr('OAUTH_STATE_SECRET', ''),
    webAppUrl: envStr('WEB_APP_URL', 'http://localhost:3000'),
    db: scopedDb,
  });
}

if (socialOAuthConfigured) {
  registerSocialOAuthCallback(app, {
    clientIds: socialClientIds(),
    clientSecrets: socialClientSecrets(),
    redirectUri: socialRedirectUri,
    stateSecret: envStr('OAUTH_STATE_SECRET', ''),
    webAppUrl: envStr('WEB_APP_URL', 'http://localhost:3000'),
    db: scopedDb,
  });
}

// Mounts the PUT/GET routes local-disk storage's presigned URLs point at.
// `undefined` once AZURE_STORAGE_ACCOUNT is set — those URLs are real Blob
// Storage SAS links and need no local route.
const localStorage = localBlobStoreForRoutes();
if (localStorage) {
  registerLocalStorageRoutes(app, localStorage);
  console.warn(
    '[warn] AZURE_STORAGE_ACCOUNT unset — assets upload to local disk, not real object storage. Fine for ' +
      'development; not for anything shared or deployed.',
  );
}

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SparkSocial API listening on :${info.port} (${env})${pg ? ' [postgres]' : ' [in-memory]'}`);
  // Which vendor is actually reachable, because a silent fallback means an
  // instance can write every post with the substitute model and read as healthy.
  console.log(`  language models: ${describeModelVendors()}`);
  // Which inbound routes are live. An engagement inbox with no writer looks
  // exactly like a quiet week, so it is worth saying at boot rather than
  // leaving somebody to wonder why the feed never fills.
  console.log(`  engagement inbound: ${describeEngageWebhook(engageWebhook ?? {})}`);
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    scheduler.stop();
    recipeScheduler.stop();
    trendObserver.stop();
    connectionWatcher.stop();
    outcomeObserver.stop();
    server.close(async () => {
      // Flush before exit: containers are killed without warning, and a
      // dropped buffer is exactly the trace you wanted for the crash.
      await telemetry.shutdown();
      await pg?.close();
      process.exit(0);
    });
  });
}
