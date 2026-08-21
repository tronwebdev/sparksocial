import { Hono } from 'hono';
import { registerWhatsappWebhook, type WhatsappWebhookDeps } from './whatsapp-webhook.js';
import { streamSSE } from 'hono/streaming';
import { ToolError } from '@sparksocial/shared/types';
import {
  agentManifest,
  allTools,
  getTool,
  invokeTool,
  type InvokeDeps,
  type ToolCallRecord,
  type ToolCtx,
} from '@sparksocial/tools';
import type { RunEvent, RunEventBus, RunAgentArgs, RunResult } from '@sparksocial/spark';

/**
 * SparkSocial API — the HTTP surface over the tool registry.
 *
 * There is deliberately no per-feature route here. Every capability is reached
 * through `POST /v1/tools/:name`, which enters the same `invokeTool` chain SPARK
 * uses. That is CLAUDE.md invariant 1 expressed in the transport layer: adding a
 * route by hand would mean adding a capability the agent cannot reach.
 *
 * `GET /v1/tools` is what SPARK reads to know what it can do, and what a generated
 * tRPC client would be built from — one list, both callers.
 *
 * Auth is a seam (`resolveCtx`) rather than middleware baked in here, so the
 * Clerk wiring can land without touching routing. Until it does, the server
 * refuses to start outside development unless a real resolver is supplied.
 */

export interface AppDeps {
  /** Meta's inbound webhook. Absent → the route does not exist. */
  whatsappWebhook?: WhatsappWebhookDeps;
  /** Resolve the caller's tenancy + role from the request. Replaced by Clerk. */
  resolveCtx: (req: Request) => Promise<ToolCtx & { caller: 'user' | 'agent' }>;
  /** Brand governance state for the policy engine. */
  loadBrandGovernance: (orgId: string, brandId?: string) => Promise<Parameters<typeof invokeTool>[0]['brand']>;
  invokeDeps: InvokeDeps;
  /** Build/commit identifier surfaced on /health for deploy verification. */
  revision?: string;
  /** Which telemetry sinks are live. Surfaced on /health so a misconfigured
   *  deploy is visible without reading logs that are not being collected. */
  telemetry?: Record<string, boolean>;
  /**
   * The SPARK runtime. Optional because the API is fully useful without it —
   * every tool is still reachable — and because wiring a live model client into
   * tests would make them slow and non-deterministic. Absent means
   * `/v1/agent/*` returns 501 rather than pretending to run an agent.
   */
  agent?: {
    run: (args: RunAgentArgs) => Promise<RunResult>;
    bus: RunEventBus;
  };
}

/** Heartbeat interval. Front Door and most proxies drop an idle stream near 60s. */
const SSE_HEARTBEAT_MS = 20_000;

export function createApp(deps: AppDeps) {
  const app = new Hono();

  /* ── Liveness. Azure Container Apps probes this. ─────────────────── */
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      revision: deps.revision ?? 'dev',
      tools: allTools().length,
      ...(deps.telemetry ? { telemetry: deps.telemetry } : {}),
      at: new Date().toISOString(),
    }),
  );

  /**
   * Inbound WhatsApp. Registered only when an app secret is configured — see
   * `whatsapp-webhook.ts`: an unsigned-write endpoint is worse than a missing
   * one, because the missing one fails visibly during setup.
   */
  if (deps.whatsappWebhook) registerWhatsappWebhook(app, deps.whatsappWebhook);

  /* ── The tool manifest. SPARK's view and the UI's view are this one list. ── */
  app.get('/v1/tools', (c) => c.json({ tools: agentManifest() }));

  app.get('/v1/tools/:name', (c) => {
    const tool = getTool(c.req.param('name'));
    if (!tool) return c.json({ error: { code: 'NOT_FOUND', message: 'No such tool.' } }, 404);
    return c.json({
      name: tool.name,
      version: tool.version,
      summary: tool.summary,
      effect: tool.effect,
      autonomy: tool.autonomy,
      scopes: tool.scopes,
      idempotent: tool.idempotent,
      surfaces: tool.surfaces ?? [],
      guardrails: tool.guardrails ?? [],
    });
  });

  /* ── The single door. Both the React client and SPARK post here. ──── */
  app.post('/v1/tools/:name', async (c) => {
    const name = c.req.param('name');

    let ctx: ToolCtx & { caller: 'user' | 'agent' };
    try {
      ctx = await deps.resolveCtx(c.req.raw);
    } catch (e) {
      return c.json(errorBody(e, 'FORBIDDEN'), authFailureStatus(e));
    }

    const body = await c.req.json().catch(() => ({}));
    const brand = await deps.loadBrandGovernance(ctx.orgId, ctx.brandId);

    const result = await invokeTool(
      {
        tool: name,
        input: body.input,
        caller: ctx.caller,
        ctx,
        brand,
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
        // Only `guardrailFlags` survives on `subject`; everything else the
        // policy engine reads about a publish or a reply is derived by the tool
        // itself (`ToolDef.policySubject`), because a request-level field for a
        // restriction is a request-level opt-out.
        ...(body.subject ? { subject: body.subject } : {}),
      },
      deps.invokeDeps,
    );

    /* The HTTP status mirrors the governance decision, so a client cannot
     * mistake "held for approval" for "done". */
    switch (result.status) {
      case 'succeeded':
        return c.json({ status: 'succeeded', callId: result.call.id, output: result.output, why: result.why });
      case 'gated':
        return c.json(
          {
            status: 'gated',
            callId: result.call.id,
            decision: result.decision,
          },
          result.decision.kind === 'deny' ? 403 : 202, // 202: staged, awaiting a human
        );
      case 'failed':
        return c.json(
          { status: 'failed', callId: result.call.id, error: { code: result.error.code, message: result.error.message } },
          httpStatusFor(result.error.code),
        );
    }
  });

  /* ── The SPARK runtime ────────────────────────────────────────────
   *
   * Not a tool, and deliberately not reachable through `/v1/tools/:name`:
   * the agent is the thing that *calls* tools, so exposing it as one would let
   * an agent invoke itself recursively through its own registry. Invariant 1 is
   * about capabilities; the runtime is the caller.
   */
  app.post('/v1/agent/runs', async (c) => {
    // Authenticate before answering anything about how this deployment is
    // configured. Whether a runtime is wired is low-value on its own, but
    // "401 before 501" is the rule that keeps configuration probing off the
    // unauthenticated surface as more of it accumulates.
    let ctx: ToolCtx & { caller: 'user' | 'agent' };
    try {
      ctx = await deps.resolveCtx(c.req.raw);
    } catch (e) {
      return c.json(errorBody(e, 'FORBIDDEN'), authFailureStatus(e));
    }

    if (!deps.agent) {
      return c.json({ error: { code: 'UPSTREAM_FAILED', message: 'Agent runtime is not configured.' } }, 501);
    }

    const body = await c.req.json().catch(() => ({}));
    const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
    if (!goal) {
      return c.json({ error: { code: 'INVALID_INPUT', message: '`goal` is required.' } }, 400);
    }
    if (!ctx.brandId) {
      return c.json({ error: { code: 'INVALID_INPUT', message: 'A brand must be selected.' } }, 400);
    }

    const brand = await deps.loadBrandGovernance(ctx.orgId, ctx.brandId);

    try {
      const result = await deps.agent.run({
        // The agent is always addressed by name from a fixed set; an arbitrary
        // string from the body would let a caller pick an agent whose tool
        // scopes it was never granted.
        agent: body.agent === undefined ? 'spark' : body.agent,
        goal,
        brandId: ctx.brandId,
        trigger: 'user',
        // Passed as-is. Attribution is not this route's to decide: `runAgent`
        // stamps `caller: 'agent'` on every tool call it makes, because the
        // request authenticated a *user* but the calls that follow are SPARK's,
        // and the audit row has to say so. Re-stamping it here would be a
        // second source of truth for the field the P1 exit criterion compares.
        ctx,
        brand,
      });
      return c.json(result);
    } catch (e) {
      return c.json(errorBody(e, 'UPSTREAM_FAILED'), 502);
    }
  });

  /* ── Live run stream (plan §2.1 "SSE (agent + job stream)") ─────────
   *
   * Authorisation happens *before* the stream opens, against the same scoped
   * read the Timeline tool uses: an out-of-scope run is 404, never a stream
   * that silently emits nothing. Then the backlog is replayed from the
   * database before live events attach, so a client that connects mid-run sees
   * the whole timeline and not just the tail.
   */
  app.get('/v1/agent/runs/:runId/events', async (c) => {
    // Auth first — same reason as the route above.
    let ctx: ToolCtx & { caller: 'user' | 'agent' };
    try {
      ctx = await deps.resolveCtx(c.req.raw);
    } catch (e) {
      return c.json(errorBody(e, 'FORBIDDEN'), authFailureStatus(e));
    }

    if (!deps.agent) {
      return c.json({ error: { code: 'UPSTREAM_FAILED', message: 'Agent runtime is not configured.' } }, 501);
    }

    const runId = c.req.param('runId');
    if (!ctx.brandId) {
      return c.json({ error: { code: 'INVALID_INPUT', message: 'A brand must be selected.' } }, 400);
    }

    const existing = await ctx.db.runs.get(runId, ctx.brandId);
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'No such run.' } }, 404);
    }

    const bus = deps.agent.bus;

    return streamSSE(c, async (stream) => {
      const queue: RunEvent[] = [];
      let notify: (() => void) | undefined;
      const unsubscribe = bus.subscribe(runId, (event) => {
        queue.push(event);
        notify?.();
      });

      // Replay first. Subscribing *before* the replay (above) rather than after
      // is what closes the gap where a step lands between reading the backlog
      // and attaching the listener — duplicates are filtered by `idx` on the
      // client, a missing step could not be recovered.
      try {
        for (const step of existing.steps) {
          await stream.writeSSE({
            event: 'step',
            data: JSON.stringify({
              kind: 'step', runId, idx: step.idx, type: step.type,
              payload: step.payload, ms: step.ms, at: step.at.toISOString(),
            }),
          });
        }
        if (existing.status !== 'running') {
          await stream.writeSSE({
            event: 'finished',
            data: JSON.stringify({ kind: 'finished', runId, status: existing.status }),
          });
          return; // Nothing further can arrive for a terminal run.
        }

        let open = true;
        stream.onAbort(() => {
          open = false;
          notify?.();
        });

        while (open) {
          while (queue.length > 0) {
            const event = queue.shift()!;
            await stream.writeSSE({ event: event.kind, data: JSON.stringify(event) });
            if (event.kind === 'finished') return;
          }
          // Park until a publish or the heartbeat, rather than spinning.
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, SSE_HEARTBEAT_MS);
            notify = () => {
              clearTimeout(timer);
              notify = undefined;
              resolve();
            };
          });
          if (open && queue.length === 0) {
            // A comment frame: keeps proxies from reaping an idle connection
            // without the client having to treat it as data.
            await stream.writeSSE({ event: 'ping', data: '{}' });
          }
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'No such route.' } }, 404));

  return app;
}

/**
 * Status for a failure in `resolveCtx`, before any tool runs.
 *
 * Everything here used to be 401. That is right for an unverifiable session and
 * wrong for a verified one that simply has no organization yet: the caller *is*
 * authenticated, so 401 tells the browser to re-authenticate — which does not
 * fix it, and loops. A stuck Clerk `choose-organization` task therefore
 * presented as `401 Not signed in` to a signed-in user, on every panel at once.
 *
 * 403 says the right thing: your identity is fine, you may not do this yet.
 */
function authFailureStatus(e: unknown): 401 | 403 {
  return e instanceof ToolError && e.code === 'NO_ORGANIZATION' ? 403 : 401;
}

function httpStatusFor(code: ToolError['code']): 400 | 403 | 404 | 409 | 429 | 502 {
  switch (code) {
    case 'INVALID_INPUT':
      return 400;
    // Not an error the caller should fix — the same work is already running.
    // 409 rather than 429 because retrying later is right and slowing down is not.
    case 'IN_FLIGHT':
      return 409;
    case 'FORBIDDEN':
    case 'NO_ORGANIZATION':
    case 'GUARDRAIL_BLOCKED':
    case 'ISOLATION_VIOLATION':
    case 'BUDGET_EXCEEDED':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'RATE_LIMITED':
      return 429;
    default:
      return 502;
  }
}

function errorBody(e: unknown, fallback: ToolError['code']) {
  if (e instanceof ToolError) return { error: { code: e.code, message: e.message } };
  return { error: { code: fallback, message: e instanceof Error ? e.message : String(e) } };
}

/**
 * In-memory audit sink. Development and tests only — production writes Postgres.
 *
 * `lookupIdempotent` is implemented here, not just `writeToolCall`, because
 * `invokeTool` only replays a key when the dependency exists
 * (`invoke.ts`: `if (req.idempotencyKey && deps.lookupIdempotent)`). Omitting it
 * left development in a state where a non-idempotent tool *required* a key and
 * then ignored it — so `direct.session.send` happily sent the same weekly
 * capture session twice, which is precisely the nagging §6.3 says makes owners
 * stop responding. The behaviour was correct under Postgres and wrong in dev,
 * which is the worst combination: it cannot be found until it is live.
 *
 * Mirrors `createAuditRepository`: most recent row for the key, and only a
 * `succeeded` one counts as a replay (a prior failure should be retryable).
 *
 * `reserveIdempotent`/`releaseIdempotent` are implemented here for the same
 * reason `lookupIdempotent` is, and the comment above is the precedent: a
 * concurrency guard that holds under Postgres and is absent in development is
 * a bug that cannot be found until it is live. A `Set` is a faithful model of
 * the reservation table's uniqueness within one process, which is the whole of
 * what a single dev process can race against.
 */
export function memoryInvokeDeps(over: Partial<InvokeDeps> = {}): InvokeDeps & { rows: ToolCallRecord[] } {
  const rows: ToolCallRecord[] = [];
  const claimed = new Set<string>();
  return {
    rows,
    writeToolCall: async (r) => void rows.push(r),
    lookupIdempotent: async (key) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i]!.idempotencyKey === key) return rows[i];
      }
      return undefined;
    },
    reserveIdempotent: async (key) => {
      if (claimed.has(key)) return 'in_flight';
      claimed.add(key);
      return 'reserved';
    },
    releaseIdempotent: async (key) => void claimed.delete(key),
    ...over,
  };
}
