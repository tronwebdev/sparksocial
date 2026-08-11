import { ZodError } from 'zod';
import { ToolError, type Explanation, type Role } from '@sparksocial/shared/types';
import { getTool, type RegisteredTool } from './registry.js';
import { evaluate, type Decision } from './policy.js';
import type { GuardrailId, ToolCtx } from './defineTool.js';

/**
 * THE MIDDLEWARE CHAIN — the only path a tool runs through.
 *
 * Master plan §3.1. Applied *identically* to human and agent calls:
 *
 *   validate input → resolve cost → policy (role scope + autonomy + budget)
 *     → guardrails → idempotency → execute → validate output
 *     → audit (tool_calls) → cost record → explainability capture → trace
 *
 * The P1 exit criterion is that a UI click and a SPARK request for the same
 * capability write **identical `tool_calls` rows** with identical policy
 * evaluation. That only holds if there is exactly one implementation of this
 * chain and both callers enter through it — which is why `caller` is a parameter
 * here rather than two code paths. See invoke.test.ts.
 *
 * I/O arrives through {@link InvokeDeps}. This module opens no connections of its
 * own, so the whole chain is testable with fakes.
 */

/* ── The audit row (plan §5, `tool_calls`) ─────────────────────────── */

export interface ToolCallRecord {
  id: string;
  runId?: string;
  userId?: string;
  tool: string;
  version: number;
  caller: 'user' | 'agent';
  orgId: string;
  brandId?: string;
  genomeId?: string;
  role: Role;
  input: unknown;
  output?: unknown;
  effect: RegisteredTool['effect'];
  decision: Decision['kind'];
  ruleId?: string;
  reason?: string;
  costCents: number;
  idempotencyKey?: string;
  status: 'pending' | 'succeeded' | 'failed' | 'gated';
  error?: { code: string; message: string };
  why?: Explanation;
  at: Date;
}

/* ── Ports ─────────────────────────────────────────────────────────── */

export interface GuardrailVerdict {
  guard: GuardrailId;
  verdict: 'pass' | 'flag' | 'block';
  rule?: string;
  evidence?: unknown;
  fixAction?: string;
}

export interface InvokeDeps {
  /** Persist the audit row. Called for every outcome, including denials. */
  writeToolCall: (record: ToolCallRecord) => Promise<void>;
  /** Roll the cost into `credit_ledger`. Only called when a handler ran. */
  recordCost?: (record: ToolCallRecord) => Promise<void>;
  /**
   * Run the tool's declared guardrails against the input. A `block` aborts with
   * GUARDRAIL_BLOCKED; a `flag` is passed to the policy engine, which decides
   * whether it forces review.
   */
  runGuardrails?: (guards: GuardrailId[], input: unknown, ctx: ToolCtx) => Promise<GuardrailVerdict[]>;
  /** Returns a prior result for this key, if the call already succeeded. */
  lookupIdempotent?: (key: string) => Promise<ToolCallRecord | undefined>;
  /** Emit to the queue/event fan-out. */
  emit?: (event: string, record: ToolCallRecord) => void;
  newId?: () => string;
  now?: () => Date;
}

/** Everything the caller supplies. `caller` is the ONLY difference between UI and SPARK. */
export interface InvokeRequest {
  tool: string;
  input: unknown;
  caller: 'user' | 'agent';
  ctx: ToolCtx;
  /** Required when the tool declares `idempotent: false`. */
  idempotencyKey?: string;
  /**
   * A human approval already granted for this call, replayed by
   * `approval.decide`. Only `approval.decide` may set it, and only after
   * reading a `gated` audit row it has scope-checked — a caller that could
   * attach this to an arbitrary request would have found a way to approve its
   * own actions.
   */
  approval?: { grantedBy: string; grantedAt: Date };
  /** Publish-effect context the policy engine reads (platform, content type, …). */
  subject?: {
    platform?: string;
    contentType?: string;
    isAutomationOutput?: boolean;
    reviewBeforePublish?: boolean;
    /**
     * Flags raised by the *caller* about this invocation's context, merged with
     * whatever the tool's own declared guardrails produce.
     *
     * This exists because guardrail flags that describe the *situation* rather
     * than the *content* — prompt-injection containment being the case that
     * forced it (plan §10) — must not depend on the tool having declared a
     * `guardrails` list. `runGuardrails` is only consulted when the tool
     * declares one, so a `publish.now` whose author forgot the declaration would
     * otherwise silently lose containment. Context-level risk belongs on the
     * request, where no tool author can drop it.
     */
    guardrailFlags?: string[];
  };
  /** Engagement eligibility, for the `engage.*` family. */
  engagement?: { eligible: boolean; autonomyConfigured: boolean };
  /** Brand governance state the policy engine reads. */
  brand: Parameters<typeof evaluate>[0]['brand'];
  spentTodayCents?: number;
}

export type InvokeResult =
  | { status: 'succeeded'; call: ToolCallRecord; output: unknown; why?: Explanation }
  | { status: 'gated'; call: ToolCallRecord; decision: Decision }
  | { status: 'failed'; call: ToolCallRecord; error: ToolError };

/* ── The chain ─────────────────────────────────────────────────────── */

export async function invokeTool(req: InvokeRequest, deps: InvokeDeps): Promise<InvokeResult> {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const at = now();

  const tool = getTool(req.tool);
  if (!tool) {
    return fail(
      skeleton(newId(), req, { version: 0, effect: 'read' }, at),
      new ToolError('NOT_FOUND', `No tool named "${req.tool}".`, { tool: req.tool }),
      deps,
    );
  }

  /* 1 ── Input validation. Nothing reaches policy or the handler unvalidated. */
  let input: unknown;
  try {
    input = tool.input.parse(req.input);
  } catch (e) {
    return fail(
      skeleton(newId(), req, tool, at),
      new ToolError('INVALID_INPUT', zodMessage(e), { issues: (e as ZodError).issues }),
      deps,
    );
  }

  /* 2 ── Idempotency. A non-idempotent tool must carry a key; a replayed key
   *      returns the prior result rather than repeating the side effect. */
  if (!tool.idempotent && !req.idempotencyKey) {
    return fail(
      skeleton(newId(), req, tool, at, input),
      new ToolError('INVALID_INPUT', `"${tool.name}" is not idempotent and requires an idempotency key.`),
      deps,
    );
  }
  if (req.idempotencyKey && deps.lookupIdempotent) {
    const prior = await deps.lookupIdempotent(req.idempotencyKey);
    if (prior?.status === 'succeeded') {
      return { status: 'succeeded', call: prior, output: prior.output, ...(prior.why ? { why: prior.why } : {}) };
    }
  }

  /* 3 ── Genome isolation precondition. Tools that touch client-confidential
   *      tables cannot run without a genome in context — the query layer would
   *      throw anyway, but failing here keeps the audit row honest. */
  const estimatedCents = tool.estimateCents?.(input) ?? 0;

  /* 4 ── Guardrails. Run before policy so a flag can escalate the decision, per
   *      PRD §9 ("approval required when flagged by guardrails").
   *
   *      Caller-supplied flags seed the list: they describe this invocation's
   *      *context* (see `subject.guardrailFlags`) and must apply whether or not
   *      the tool declared any guardrails of its own. */
  let guardrailFlags: string[] = [...(req.subject?.guardrailFlags ?? [])];
  if (tool.guardrails?.length && deps.runGuardrails) {
    const verdicts = await deps.runGuardrails(tool.guardrails, input, req.ctx);
    const blocked = verdicts.find((v) => v.verdict === 'block');
    if (blocked) {
      return fail(
        skeleton(newId(), req, tool, at, input, estimatedCents),
        new ToolError('GUARDRAIL_BLOCKED', blocked.rule ?? `Blocked by ${blocked.guard}.`, {
          guard: blocked.guard,
          fixAction: blocked.fixAction,
          evidence: blocked.evidence,
        }),
        deps,
      );
    }
    guardrailFlags = [...guardrailFlags, ...verdicts.filter((v) => v.verdict === 'flag').map((v) => v.guard)];
  }

  /* 5 ── Policy. Role scope, autonomy, budget, quiet windows, approval mode —
   *      all resolved in the one pure function. */
  const decision = evaluate({
    tool: { name: tool.name, effect: tool.effect, autonomy: tool.autonomy, scopes: tool.scopes },
    caller: req.caller,
    role: req.ctx.role,
    now: at,
    brand: req.brand,
    subject: { ...req.subject, guardrailFlags },
    budget: {
      remainingCents: req.ctx.budget.remainingCents,
      estimatedCents,
    },
    ...(req.engagement ? { engagement: req.engagement } : {}),
    ...(req.approval ? { approval: req.approval } : {}),
  });

  const base = skeleton(newId(), req, tool, at, input, estimatedCents);
  base.decision = decision.kind;
  if (decision.kind !== 'allow') {
    base.ruleId = decision.ruleId;
    base.reason = decision.reason;
  }

  /* 6 ── Gate. Anything other than `allow` is audited and returned without
   *      running the handler — the Review queue is built from these rows. */
  if (decision.kind !== 'allow') {
    const gated: ToolCallRecord = { ...base, status: 'gated' };
    await deps.writeToolCall(gated);
    deps.emit?.(`tool.${decision.kind}`, gated);
    return { status: 'gated', call: gated, decision };
  }

  /* 7 ── Execute. */
  try {
    const raw = await tool.handler(input, req.ctx);

    /* 8 ── Output validation, before anything escapes the boundary. */
    const output = tool.output.parse(raw);
    const why = extractWhy(output);

    const settled: ToolCallRecord = {
      ...base,
      status: 'succeeded',
      output,
      ...(why ? { why } : {}),
    };

    /* 9 ── Audit, cost, fan-out. */
    await deps.writeToolCall(settled);
    if (estimatedCents > 0) await deps.recordCost?.(settled);
    deps.emit?.('tool.succeeded', settled);
    req.ctx.trace.event('tool.succeeded', { tool: tool.name, costCents: estimatedCents });

    return { status: 'succeeded', call: settled, output, ...(why ? { why } : {}) };
  } catch (e) {
    const err =
      e instanceof ToolError
        ? e
        : e instanceof ZodError
          ? new ToolError('UPSTREAM_FAILED', `"${tool.name}" returned a malformed result: ${zodMessage(e)}`)
          : new ToolError('UPSTREAM_FAILED', e instanceof Error ? e.message : String(e));
    return fail(base, err, deps);
  }
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function skeleton(
  id: string,
  req: InvokeRequest,
  tool: Pick<RegisteredTool, 'version' | 'effect'>,
  at: Date,
  input: unknown = req.input,
  costCents = 0,
): ToolCallRecord {
  return {
    id,
    ...(req.ctx.runId ? { runId: req.ctx.runId } : {}),
    ...(req.ctx.userId ? { userId: req.ctx.userId } : {}),
    tool: req.tool,
    version: tool.version,
    caller: req.caller,
    orgId: req.ctx.orgId,
    ...(req.ctx.brandId ? { brandId: req.ctx.brandId } : {}),
    ...(req.ctx.genomeId ? { genomeId: req.ctx.genomeId } : {}),
    role: req.ctx.role,
    input,
    effect: tool.effect,
    decision: 'deny',
    costCents,
    ...(req.idempotencyKey ? { idempotencyKey: req.idempotencyKey } : {}),
    status: 'pending',
    at,
  };
}

async function fail(base: ToolCallRecord, error: ToolError, deps: InvokeDeps): Promise<InvokeResult> {
  const record: ToolCallRecord = {
    ...base,
    status: 'failed',
    error: { code: error.code, message: error.message },
  };
  await deps.writeToolCall(record);
  deps.emit?.('tool.failed', record);
  return { status: 'failed', call: record, error };
}

/**
 * The `why` is a field on the tool's own output schema (CLAUDE.md invariant 4),
 * so it is lifted onto the audit row rather than being reported separately —
 * that is what lets `<WhyPopover />` render from one place everywhere.
 */
function extractWhy(output: unknown): Explanation | undefined {
  if (output && typeof output === 'object' && 'why' in output) {
    return (output as { why: Explanation }).why;
  }
  return undefined;
}

function zodMessage(e: unknown): string {
  if (e instanceof ZodError) {
    return e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  }
  return e instanceof Error ? e.message : String(e);
}
