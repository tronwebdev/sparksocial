import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError, RunStatus, RunTrigger, StepType } from '@sparksocial/shared/types';

/**
 * THE AGENT TIMELINE — master plan §4.5.
 *
 *   *"The Agent Timeline is the trust mechanism that makes autopublish
 *   acceptable, and it is a Phase-1 deliverable, not polish."*
 *
 * Two read tools, no write tool. Runs are recorded by `RunRecorder` from inside
 * the agent loop; nothing in the registry can amend that record afterward. A
 * timeline the agent could edit would answer the wrong question — the point is
 * to show what actually happened, including the parts that failed.
 *
 * Both are scoped on `ctx.brandId`, which comes from the verified session, and
 * an out-of-scope run reads as absent rather than forbidden (same rule as
 * `genomes.get`) so that probing run ids cannot confirm another brand's runs
 * exist.
 */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

const RunSummarySchema = z.object({
  runId: z.string(),
  agent: z.string(),
  goal: z.string(),
  trigger: RunTrigger,
  status: RunStatus,
  costCents: z.number(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  parentRunId: z.string().optional(),
  /** Wall-clock duration; null while the run is still going. */
  durationMs: z.number().nullable(),
});

export const AgentRunListInput = z.object({
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export const AgentRunListOutput = z.object({
  runs: z.array(RunSummarySchema),
});

export const agentRunList = defineTool({
  name: 'agent.run.list',
  version: 1,

  summary:
    'List recent SPARK runs for the current brand, newest first, with status, cost and duration. ' +
    'Use to answer "what has the agent been doing?". Free.',

  input: AgentRunListInput,
  output: AgentRunListOutput,

  effect: 'read',
  autonomy: 'auto',
  // Every role: the Timeline is the accountability surface. A viewer or client
  // who cannot see what the agent did on their brand has no basis to trust it.
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,

  async handler(input, ctx) {
    const brandId = requireBrand(ctx.brandId);
    const rows = await ctx.db.runs.list(brandId, input.limit);
    return { runs: rows.map(toSummary) };
  },
});

export const AgentRunGetInput = z.object({
  runId: z.string().min(1),
});

export const AgentRunGetOutput = RunSummarySchema.extend({
  tokens: z.object({ input: z.number(), output: z.number() }),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  steps: z.array(
    z.object({
      idx: z.number().int(),
      type: StepType,
      payload: z.unknown(),
      ms: z.number(),
      at: z.string(),
    }),
  ),
});

export const agentRunGet = defineTool({
  name: 'agent.run.get',
  version: 1,

  summary:
    'Replay one SPARK run: its ordered steps (thinking, tool calls, delegation, waits), token use, ' +
    'cost and outcome. Use to explain why the agent did something. Free.',

  input: AgentRunGetInput,
  output: AgentRunGetOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,

  async handler(input, ctx) {
    const brandId = requireBrand(ctx.brandId);
    const run = await ctx.db.runs.get(input.runId, brandId);
    if (!run) {
      throw new ToolError('NOT_FOUND', 'No such run.', { runId: input.runId });
    }
    return {
      ...toSummary(run),
      tokens: run.tokens,
      ...(run.error ? { error: run.error } : {}),
      // Ordered by `idx`, never by `at`: two steps inside the same millisecond
      // are common, and a timeline that reorders them misrepresents causality.
      steps: [...run.steps]
        .sort((a, b) => a.idx - b.idx)
        .map((s) => ({ idx: s.idx, type: s.type, payload: s.payload, ms: s.ms, at: s.at.toISOString() })),
    };
  },
});

/**
 * The Timeline is per-brand, and `brandId` is optional on `ToolCtx` because
 * plenty of tools (`genome.list`) legitimately run before a brand is chosen.
 * Failing loudly here beats defaulting to some "current" brand, which is how a
 * timeline ends up showing another client's runs inside an agency workspace.
 */
function requireBrand(brandId: string | undefined): string {
  if (!brandId) {
    throw new ToolError('INVALID_INPUT', 'A brand must be selected to read the agent timeline.');
  }
  return brandId;
}

function toSummary(r: {
  id: string;
  agent: string;
  goal: string;
  trigger: z.infer<typeof RunTrigger>;
  status: z.infer<typeof RunStatus>;
  costCents: number;
  startedAt: Date;
  endedAt?: Date;
  parentRunId?: string;
}) {
  return {
    runId: r.id,
    agent: r.agent,
    goal: r.goal,
    trigger: r.trigger,
    status: r.status,
    costCents: r.costCents,
    startedAt: r.startedAt.toISOString(),
    ...(r.endedAt ? { endedAt: r.endedAt.toISOString() } : {}),
    ...(r.parentRunId ? { parentRunId: r.parentRunId } : {}),
    durationMs: r.endedAt ? r.endedAt.getTime() - r.startedAt.getTime() : null,
  };
}
