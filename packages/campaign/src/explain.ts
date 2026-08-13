import { z } from 'zod';
import { defineTool, type RecordedCall } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';

/**
 * `agent.explain` — PRD §7.3, plan §3.2.
 *
 * Invariant 4 says every agent-visible decision carries a structured `why`, and
 * `invokeTool` has been writing them to `tool_calls` since P1. Until now nothing
 * could read one back: `WhyPopover` renders whatever the originating response
 * happened to contain, so the explanation lived exactly as long as the tab did.
 * Ask "why did you post that?" the next morning and there was no answer, even
 * though the answer was sitting in the database.
 *
 * ── It reports, it does not compose ────────────────────────────────────────
 *
 * This tool never generates an explanation. If the row has no `why`, it says so.
 * The temptation is obvious — an LLM could write a fluent paragraph about any
 * tool call from its name and inputs — and it is exactly the thing invariant 4
 * exists to forbid: a plausible reconstruction is indistinguishable from a real
 * record right up until it contradicts one. The `why` is a schema obligation
 * discharged at decision time, not a narration produced on demand.
 *
 * ── Denials explain themselves ─────────────────────────────────────────────
 *
 * The most-asked question is not "why did you publish this" but "why didn't
 * you". Those rows carry no `why` — nothing ran — but they do carry `ruleId`
 * and `reason` from the policy engine, and that *is* the explanation. Returning
 * "no explanation recorded" for a call the policy engine deliberately stopped
 * would be technically true and useless.
 */

const ExplainOutput = z.object({
  callId: z.string(),
  tool: z.string(),
  at: z.string(),
  caller: z.enum(['user', 'agent']),
  decision: z.string(),
  status: z.string(),
  costCents: z.number(),
  runId: z.string().optional(),
  /** One line, always present, safe to render on its own. */
  summary: z.string(),
  /** The recorded explanation. Absent when the call never made a decision. */
  why: Explanation.optional(),
  /** True when nothing was recorded — the UI should not imply one exists. */
  unexplained: z.boolean(),
});

export const agentExplain = defineTool({
  name: 'agent.explain',
  version: 1,

  summary:
    'Why SPARK did — or did not do — a specific thing, read back from the recorded decision. ' +
    'Takes the call id shown on a Timeline entry. Read-only, free.',

  input: z.object({ callId: z.string().min(1) }),
  output: ExplainOutput,

  effect: 'read',
  autonomy: 'auto',
  /**
   * Everyone, including `client`. An agency's client seeing why a post went out
   * is the entire argument for the Timeline; gating the explanation to staff
   * would leave the person with the most doubt holding the least evidence.
   */
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,
  surfaces: ['CC-01', 'AT-01'],

  async handler(input, ctx) {
    const call = await ctx.db.toolCalls.get(input.callId, ctx.orgId);

    // Out of scope and non-existent are the same answer, deliberately: a
    // distinguishable "exists but not yours" turns this into an oracle for
    // enumerating another org's activity.
    if (!call) {
      throw new ToolError('NOT_FOUND', 'No such call in this workspace.', { callId: input.callId });
    }

    const why = call.why;
    const denial = !why && (call.decision === 'deny' || call.status === 'gated');

    return {
      callId: call.id,
      tool: call.tool,
      at: call.at.toISOString(),
      caller: call.caller,
      decision: call.decision,
      status: call.status,
      costCents: call.costCents,
      ...(call.runId ? { runId: call.runId } : {}),
      summary: summarise(call, why, denial),
      ...(why ? { why } : denial ? { why: fromPolicy(call) } : {}),
      unexplained: !why && !denial,
    };
  },
});

function summarise(call: RecordedCall, why: Explanation | undefined, denial: boolean): string {
  if (why) return why.summary;
  if (denial) {
    return call.status === 'gated'
      ? `${call.tool} is waiting for approval${call.ruleId ? ` (${call.ruleId})` : ''}.`
      : `${call.tool} was refused${call.reason ? `: ${call.reason}` : ''}.`;
  }
  // Honest, not apologetic. Most tools are plumbing and correctly record no
  // decision; saying so beats implying something went missing.
  return `${call.tool} ran without recording a decision — it makes none a user would see.`;
}

/**
 * Turn a policy outcome into the same `Explanation` shape everything else
 * returns, so `WhyPopover` needs no second rendering path for refusals.
 *
 * The `ruleId` is cited as evidence rather than paraphrased. "Blocked by
 * `agent.paused`" is checkable against `policy.ts`; "SPARK decided not to" is
 * not, and the difference is what makes the Timeline evidence rather than
 * reassurance.
 */
function fromPolicy(call: RecordedCall): Explanation {
  const gated = call.status === 'gated';
  return {
    summary: gated
      ? `Held for approval before ${call.tool} could run.`
      : `Refused ${call.tool} before it ran.`,
    factors: [
      { label: 'decision', detail: call.decision },
      ...(call.ruleId ? [{ label: 'rule', detail: call.ruleId }] : []),
      ...(call.reason ? [{ label: 'reason', detail: call.reason }] : []),
    ],
    evidence: call.ruleId
      ? [{ kind: 'rule' as const, id: call.ruleId, note: 'evaluated in the policy engine, before the handler ran' }]
      : [],
    alternatives: gated
      ? [{ option: 'Run it anyway', rejectedBecause: 'this brand’s approval mode requires a person to decide' }]
      : [],
  };
}
