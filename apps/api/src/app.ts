import { Hono } from 'hono';
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
  /** Resolve the caller's tenancy + role from the request. Replaced by Clerk. */
  resolveCtx: (req: Request) => Promise<ToolCtx & { caller: 'user' | 'agent' }>;
  /** Brand governance state for the policy engine. */
  loadBrandGovernance: (orgId: string, brandId?: string) => Promise<Parameters<typeof invokeTool>[0]['brand']>;
  invokeDeps: InvokeDeps;
  /** Build/commit identifier surfaced on /health for deploy verification. */
  revision?: string;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  /* ── Liveness. Azure Container Apps probes this. ─────────────────── */
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      revision: deps.revision ?? 'dev',
      tools: allTools().length,
      at: new Date().toISOString(),
    }),
  );

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
      return c.json(errorBody(e, 'FORBIDDEN'), 401);
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
        ...(body.subject ? { subject: body.subject } : {}),
        ...(body.engagement ? { engagement: body.engagement } : {}),
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

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'No such route.' } }, 404));

  return app;
}

function httpStatusFor(code: ToolError['code']): 400 | 403 | 404 | 429 | 502 {
  switch (code) {
    case 'INVALID_INPUT':
      return 400;
    case 'FORBIDDEN':
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

/** In-memory audit sink. Development and tests only — production writes Postgres. */
export function memoryInvokeDeps(): InvokeDeps & { rows: ToolCallRecord[] } {
  const rows: ToolCallRecord[] = [];
  return {
    rows,
    writeToolCall: async (r) => void rows.push(r),
  };
}
