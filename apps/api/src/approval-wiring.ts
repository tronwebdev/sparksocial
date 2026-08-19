import { ToolError } from '@sparksocial/shared';
import { getTool, invokeTool, type InvokeDeps, type InvokeResult, type ToolCallRecord, type ToolCtx } from '@sparksocial/tools';

/**
 * The two halves that connect the policy engine's `gated` outcome to the Review
 * queue, kept here because both need application-level wiring (`invokeDeps`,
 * the brand governance loader) that `packages/tools` deliberately does not have.
 */

/**
 * Enqueues a review item whenever a call is held.
 *
 * Decorates `writeToolCall` for the same reason telemetry does: `invokeTool`
 * writes exactly one audit row per invocation, so this is the only place that
 * sees every gated decision and cannot be forgotten by the author of the next
 * tool. Enqueuing from inside handlers would mean remembering it 26 times.
 *
 * Only `decision === 'approval'` is enqueued. A `confirm` is a question for the
 * *actor* — SPARK asking "are you sure?" mid-run — and belongs in the agent
 * loop, not in a queue a different person works through later. A `deny` is
 * final and has nothing to decide.
 *
 * The audit write happens first and the enqueue never throws into it: a queue
 * that can fail an audit row would trade a durable record for a projection.
 */
export function withApprovalQueue(deps: InvokeDeps, enqueue: EnqueueFn): InvokeDeps {
  return {
    ...deps,
    writeToolCall: async (record: ToolCallRecord) => {
      await deps.writeToolCall(record);
      if (record.status !== 'gated' || record.decision !== 'approval') return;
      try {
        await enqueue({
          callId: record.id,
          orgId: record.orgId,
          tool: record.tool,
          ...(record.brandId ? { brandId: record.brandId } : {}),
          ...(record.ruleId ? { ruleId: record.ruleId } : {}),
          ...(record.reason ? { reason: record.reason } : {}),
        });
      } catch {
        /* the audit row is the durable record; the queue is a projection */
      }
    },
  };
}

type EnqueueFn = (args: {
  callId: string;
  orgId: string;
  brandId?: string;
  tool: string;
  ruleId?: string;
  reason?: string;
}) => Promise<void>;

/**
 * Replays a held call after a human approves it.
 *
 * ── Why the original input is re-read rather than passed in ────────────────
 * The approver names a `callId`, nothing more. Everything about what runs — the
 * tool, the input, the genome — comes from the audit row that was gated. If the
 * caller could supply any of it, "approve call X" would become "run anything,
 * citing call X", and the queue would be an authorisation bypass rather than a
 * gate.
 *
 * The replay carries `approval: { grantedBy, grantedAt }`, which `policy.ts`
 * applies as a post-filter that can only turn `approval` into `allow`. Every
 * other rule runs again from scratch — so a call approved an hour ago still
 * fails now if the budget has since run out, the agent has been paused, or the
 * brand has entered a quiet window. Approval releases one specific hold; it is
 * not a pass through the rest of the policy engine.
 */
export function makeApprovalExecutor(args: {
  deps: InvokeDeps;
  loadBrandGovernance: (orgId: string, brandId?: string) => Promise<Parameters<typeof invokeTool>[0]['brand']>;
  /** Reads the original audit row. Scoped by org at the store. */
  lookupCall: (callId: string, orgId: string) => Promise<ToolCallRecord | undefined>;
}) {
  return async ({ callId, grantedBy, ctx }: { callId: string; grantedBy: string; ctx: unknown }): Promise<InvokeResult> => {
    const approverCtx = ctx as ToolCtx;
    const original = await args.lookupCall(callId, approverCtx.orgId);
    if (!original) throw new ToolError('NOT_FOUND', 'The held call no longer exists.', { callId });

    const tool = getTool(original.tool);
    if (!tool) {
      // A tool can be removed from the registry between a call being held and
      // a reviewer getting to it. Failing clearly beats a confusing 404 later.
      throw new ToolError('NOT_FOUND', `"${original.tool}" is no longer registered.`, { tool: original.tool });
    }

    const brand = await args.loadBrandGovernance(original.orgId, original.brandId);

    return invokeTool(
      {
        tool: original.tool,
        input: original.input,
        // Preserved from the original row, not taken from the approver. The
        // audit trail has to keep saying SPARK asked for this; the approver's
        // identity is recorded on the approval, not smuggled onto the call.
        caller: original.caller,
        ctx: {
          ...approverCtx,
          // Scope comes from the held call, so approving cannot move work into
          // a different brand or genome than the one that was reviewed.
          ...(original.brandId ? { brandId: original.brandId } : {}),
          ...(original.genomeId ? { genomeId: original.genomeId } : {}),
          role: original.role,
          ...(original.userId ? { userId: original.userId } : {}),
        },
        brand,
        approval: { grantedBy, grantedAt: new Date() },
        // Non-idempotent tools require a key. Deriving it from the call id
        // makes double-clicking Approve replay the first result rather than
        // publishing twice.
        ...(tool.idempotent ? {} : { idempotencyKey: `approval:${callId}` }),
      },
      args.deps,
    );
  };
}
