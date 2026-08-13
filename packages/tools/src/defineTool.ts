import { z, ZodTypeAny } from 'zod';
import type {
  Role, Effect, Autonomy, AssetRole, RunStatus, RunTrigger, StepType, Explanation,
} from '@sparksocial/shared/types';
import type { Genome } from '@sparksocial/shared/genome';

/* ── Context handed to every handler ───────────────────────────────── */

export interface ToolCtx {
  orgId: string;
  brandId?: string;
  /** Required for anything touching assets, knowledge, memories, or content. */
  genomeId?: string;
  userId?: string;          // absent when SPARK acts on a schedule
  role: Role;
  runId?: string;           // agent_runs.id when called by SPARK
  approvalMode: 'autopublish' | 'review_first_week' | 'review_everything';
  brandCreatedAt?: Date;    // for review_first_week evaluation
  budget: { remainingCents: number; monthlyCapCents: number };
  db: ScopedDb;             // from packages/db — see scoped.ts
  logger: Logger;
  trace: Trace;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface Trace {
  span<T>(name: string, fn: () => Promise<T>): Promise<T>;
  event(name: string, meta?: Record<string, unknown>): void;
}

/**
 * The repository surface handed to handlers. Structural on purpose: the concrete
 * implementation comes from @sparksocial/db, and every accessor on it is already
 * genome-scoped (see `packages/db/src/scoped.ts`). Handlers never build raw queries.
 *
 * Grows one accessor at a time as tools land — keeping it explicit rather than
 * `unknown` is what makes "the handler is scoped through the repository layer"
 * checkable by the compiler instead of by review.
 */
export interface ScopedDb {
  genomes: {
    createDraft(args: {
      brandId: string;
      orgId: string;
      identity: unknown;
      dimensions: unknown;
      voice: unknown;
      source: 'user' | 'inference' | 'learning';
    }): Promise<{ id: string }>;
    patchDimensions(args: {
      genomeId: string;
      orgId: string;
      dimensions: unknown;
      avatarEnabled: boolean;
    }): Promise<{ id: string; version: number }>;
    /** Scoped read. Returns undefined rather than throwing when out of scope. */
    get(genomeId: string, orgId: string): Promise<Genome | undefined>;
    /**
     * Every genome in the org — the brand switcher's source, and the only way a
     * caller discovers which `genomeId` values it is entitled to. Deliberately
     * takes no `genomeId`: it answers "what may I ask for", so gating it on an
     * already-chosen genome would be circular.
     */
    listForOrg(orgId: string): Promise<Array<{ id: string; brandId: string; name: string; updatedAt: Date }>>;
  };
  assets: {
    /**
     * Counts by asset_role for the genome — the resolver's availability input.
     * Must reflect assets actually ingested via `create`; a store that returns
     * static counts here would make `playbook.resolve` lie about the Asset Graph.
     */
    inventory(genomeId: string, orgId: string): Promise<Partial<Record<AssetRole, number>>>;
    /** §4.3 retrieval — ranked by similarity minus recency/usage penalties. */
    retrieve(args: {
      genomeId: string;
      orgId: string;
      embedding: number[];
      requiredRoles?: AssetRole[];
      k: number;
    }): Promise<
      Array<{
        assetId: string;
        role: AssetRole;
        caption: string | null;
        score: number;
        usageCount: number;
        lastUsedAt: Date | null;
        rightsStatus: string;
      }>
    >;
    /** §4.1 ingest — the only way a new asset enters the graph. */
    create(args: {
      genomeId: string;
      orgId: string;
      url: string;
      assetRole: AssetRole;
      mediaType: 'image' | 'video' | 'audio';
      rightsStatus: 'cleared' | 'pending' | 'restricted';
      caption: string;
      embedding: number[];
      source: string;
    }): Promise<{ id: string }>;
    /** Concatenatable grounding text for `guard.claim_grounding` (§10). */
    captionsByRole(genomeId: string, orgId: string, roles: AssetRole[]): Promise<string[]>;
    /** Rights + reuse-cooldown lookup for `guard.rights` / `guard.duplicate` (§10). */
    info(
      ids: string[],
      genomeId: string,
      orgId: string,
    ): Promise<Record<string, { rightsStatus: string; lastUsedDaysAgo?: number }>>;
  };
  /** Published content history — the guardrail layer's only reader of it. */
  content: {
    /**
     * Trailing-window published items for `guard.avatar_saturation` and
     * `guard.duplicate` (§10). `embedding` is null for items that predate
     * embedding or aren't text-bearing.
     */
    recent(
      genomeId: string,
      orgId: string,
      windowDays: number,
    ): Promise<Array<{ isAvatarFormat: boolean; embedding: number[] | null }>>;
  };
  /**
   * Agent run history — the Agent Timeline's read side (plan §4.5). Read-only by
   * construction: runs are written by `RunRecorder` inside the agent loop, and
   * nothing a *tool* does should ever be able to rewrite the record of what the
   * agent did. The Timeline is the trust mechanism that makes autopublish
   * acceptable, so its history has to be append-only from every other angle.
   */
  /**
   * Campaigns and their calendars (§6.8). Reached through the same handle as
   * everything else so a handler has one injection point, though the campaign
   * row itself carries no confidential material — see {@link CampaignStore}.
   */
  campaigns: CampaignStore;
  /** The Review queue. See {@link ApprovalStore}. */
  approvals: ApprovalStore;
  /** The approval ladder's storage (PRD §7.1). */
  brands: BrandGovernanceStore;
  /** SPARK's questions to the owner and their answers. See {@link HumanLoopStore}. */
  humanLoop: HumanLoopStore;
  /**
   * Read-only view of the audit trail, for `agent.explain`.
   *
   * Deliberately read-only and deliberately narrow: `writeToolCall` in
   * `invoke.ts` is the only writer, and a tool able to rewrite the record of
   * what the agent did would undo the Timeline's entire purpose.
   */
  toolCalls: {
    /**
     * One recorded call. Returns undefined rather than throwing when the row
     * belongs to another org — the same "out of scope reads as not found" rule
     * as `genomes.get`, so probing ids leaks nothing.
     */
    get(callId: string, orgId: string): Promise<RecordedCall | undefined>;
  };
  runs: {
    /** Most recent runs for the brand, newest first. `limit` is enforced by the store. */
    list(brandId: string, limit: number): Promise<RunSummary[]>;
    /**
     * One run with its ordered steps. Returns undefined rather than throwing
     * when the run belongs to another brand — same "out of scope reads as not
     * found" rule as `genomes.get`, so probing ids leaks nothing.
     */
    get(runId: string, brandId: string): Promise<RunDetail | undefined>;
  };
}

export type ApprovalMode = 'autopublish' | 'review_first_week' | 'review_everything';

export interface BrandGovernance {
  brandId: string;
  name: string;
  approvalMode: ApprovalMode;
  /** `review_first_week` graduates seven days after this. */
  createdAt: Date;
  /** The kill switch. `policy.ts` denies every non-read agent call when true. */
  agentPaused: boolean;
  pausedAt?: Date;
  pausedBy?: string;
  pauseReason?: string;
  /**
   * Target posts per week — how loud the account is, set by the owner and read
   * by calendar generation. Distinct from the kill switch: pausing stops the
   * agent, frequency shapes what it does while running.
   */
  postsPerWeek: number;
}

/**
 * Where the approval ladder actually lives (PRD §7.1, §9).
 *
 * `policy.ts` has implemented every rung from the start; until this existed
 * there was nowhere to record which rung a brand was on, so both auth resolvers
 * returned a hardcoded `autopublish` and the ladder was real in tests and inert
 * in production.
 *
 * `get` upserts rather than returning undefined: a brand that has never had its
 * mode set must still land somewhere defined, and the safe default is the
 * conservative rung, not the permissive one.
 */
export interface BrandGovernanceStore {
  get(brandId: string, orgId: string, name?: string): Promise<BrandGovernance>;
  setApprovalMode(brandId: string, orgId: string, mode: ApprovalMode): Promise<BrandGovernance>;
  /**
   * Stops or restarts the agent for one brand.
   *
   * Scoped per brand rather than per org: in an agency workspace one client's
   * agent going wrong is not a reason to freeze the other thirty-nine.
   */
  setAgentPaused(args: {
    brandId: string;
    orgId: string;
    paused: boolean;
    by: string;
    reason?: string;
  }): Promise<BrandGovernance>;
  /** Target posts per week. Range is enforced by the tool, not here. */
  setFrequency(args: {
    brandId: string;
    orgId: string;
    postsPerWeek: number;
    by: string;
  }): Promise<BrandGovernance>;
}

/**
 * The subset of a `tool_calls` row `agent.explain` is allowed to return.
 *
 * Narrower than `ToolCallRecord` on purpose. That row carries `input` and
 * `output` verbatim — a genome draft, a recipient phone number, a caption — and
 * `agent.explain` answers "why did you do that", not "show me everything you
 * held at the time". Widening this is how an explainability feature becomes a
 * data-exfiltration one.
 */
export interface RecordedCall {
  id: string;
  tool: string;
  caller: 'user' | 'agent';
  decision: string;
  status: string;
  ruleId?: string;
  reason?: string;
  costCents: number;
  at: Date;
  runId?: string;
  /** Absent when the tool makes no user-visible decision, or the call never ran. */
  why?: Explanation;
}

/**
 * SPARK's side of the conversation with the owner (plan §3.2 `human.*`).
 *
 * The asymmetry that matters is in the schema, not the handlers: `body` is
 * written by us and `answer` comes from a person over WhatsApp, which is an
 * untrusted channel. An answer is recorded, shown and used as *content*; it can
 * never authorise a tool call. See `whatsapp.receive`.
 */
export interface HumanMessage {
  id: string;
  brandId: string;
  /** `ask` expects a reply and parks the run; `notify` does not. */
  kind: 'ask' | 'notify';
  body: string;
  /** Offered choices, for an `ask`. Free text is still accepted. */
  options?: string[];
  urgency: 'low' | 'normal' | 'high';
  runId?: string;
  createdAt: Date;
  /** UNTRUSTED. The owner's words, verbatim. */
  answer?: string;
  answeredAt?: Date;
  answeredBy?: string;
  /** Where it was delivered, e.g. `whatsapp`. Absent until sent. */
  channel?: string;
}

export interface HumanLoopStore {
  create(args: {
    brandId: string;
    orgId: string;
    kind: 'ask' | 'notify';
    body: string;
    options?: string[];
    urgency: 'low' | 'normal' | 'high';
    runId?: string;
  }): Promise<HumanMessage>;
  get(id: string, orgId: string): Promise<HumanMessage | undefined>;
  /** Unanswered `ask` items, oldest first — the owner's inbox. */
  listPending(brandId: string, orgId: string, limit: number): Promise<HumanMessage[]>;
  /**
   * Record the owner's reply. Returns undefined when the id is out of scope or
   * already answered, so a replayed webhook cannot overwrite a decision.
   */
  answer(args: {
    id: string;
    orgId: string;
    answer: string;
    by: string;
  }): Promise<HumanMessage | undefined>;
  /** Note the delivery channel once a transport has accepted it. */
  markDelivered(id: string, orgId: string, channel: string): Promise<void>;
}

/**
 * SPEND — plan §9. What `policy.ts` rule 4 has always been asking about.
 *
 * Deliberately **not** on `ScopedDb`. Handlers must not be able to read or
 * write the budget: spend is decided by the policy engine before a handler
 * runs and recorded by `invokeTool` after it returns, and a tool that could
 * touch its own balance mid-flight would make both meaningless. The resolver
 * reads it into `ToolCtx.budget`; `InvokeDeps.recordCost` writes it. Two
 * places, both outside the handler.
 */
export interface CreditStore {
  /**
   * Cap and spend for the current period, in one call.
   *
   * One call rather than two accessors because they are read together on every
   * single request, and two round-trips on the hot path to compute one
   * subtraction is a cost with no benefit.
   */
  budget(orgId: string, now: Date): Promise<{ monthlyCapCents: number; spentCents: number }>;

  /**
   * Append one charge. Idempotent on `callId` — a second write for the same
   * call is silently ignored rather than raising, because the caller is
   * `invokeTool` finishing a successful call and failing it *after* the work
   * was done would be worse than a duplicate that never lands.
   */
  record(entry: {
    callId: string;
    orgId: string;
    brandId?: string;
    tool: string;
    costCents: number;
    at: Date;
  }): Promise<void>;
}

/** One item in the Review queue. */
export interface PendingApproval {
  id: string;
  /** The gated `tool_calls` row this is holding. */
  callId: string;
  tool: string;
  /** The original input, replayed verbatim on approve. */
  input: unknown;
  requestedAt: Date;
  ruleId?: string;
  reason?: string;
  genomeId?: string;
  requestedBy?: string;
  status?: string;
  brandId?: string;
}

/**
 * The Review queue (PRD §7.5, plan §4.4).
 *
 * Without this, `review_first_week` and `review_everything` gate calls into
 * nothing: the audit row records that a decision was held and there is no way
 * to act on it. The queue is what makes the approval ladder a product feature
 * rather than a policy outcome.
 */
export interface ApprovalStore {
  /** Called when a call is gated. Idempotent on `callId`. */
  enqueue(args: {
    callId: string;
    orgId: string;
    brandId?: string;
    tool: string;
    ruleId?: string;
    reason?: string;
  }): Promise<void>;
  pending(orgId: string, brandId: string | undefined, limit: number): Promise<PendingApproval[]>;
  /** Undefined rather than throwing when out of scope. */
  get(callId: string, orgId: string): Promise<PendingApproval | undefined>;
  /** Throws NOT_FOUND if it is not still pending — the concurrency guard. */
  resolve(callId: string, orgId: string, outcome: 'approved' | 'rejected', decidedBy: string): Promise<void>;
}

/** A campaign as stored — the outcome unit of §6.8. */
export interface CampaignRecord {
  id: string;
  genomeId: string;
  name: string;
  objective: string;
  windowDays: number;
  startAt: Date;
  status: string;
  /** The plan snapshot the owner approved. Deliberately opaque here. */
  plan: unknown;
}

export interface CampaignSlotInput {
  playbookId: string;
  mode: string;
  pillar: string;
  scheduledAt: Date;
}

/**
 * Campaign + calendar persistence (§6.8, `CMP-01.*`, `CAL-01`→`CAL-06`).
 *
 * Separate from `ScopedDb` on purpose: `ScopedDb` is the client-confidential
 * surface that `scoped.ts` fences, and a campaign is an objective over a window
 * — it holds no assets or copy. Its *slots* do, which is why `replaceSlots` and
 * `slots` take a `genomeId` and route through the scoped layer underneath.
 */
export interface CampaignStore {
  create(args: {
    orgId: string;
    genomeId: string;
    name: string;
    objective: string;
    windowDays: number;
    startAt: Date;
    plan: unknown;
  }): Promise<{ id: string }>;
  /** Undefined rather than throwing when out of scope. */
  get(campaignId: string, orgId: string): Promise<CampaignRecord | undefined>;
  listForGenome(genomeId: string, orgId: string, limit: number): Promise<CampaignRecord[]>;
  /** Replaces the campaign's unpublished slots. Regeneration is the normal path. */
  replaceSlots(args: {
    campaignId: string;
    orgId: string;
    genomeId: string;
    slots: CampaignSlotInput[];
  }): Promise<number>;
  slots(
    campaignId: string,
    orgId: string,
    genomeId: string,
  ): Promise<
    Array<{
      id: string;
      playbookId: string | null;
      mode: string | null;
      pillar: string | null;
      status: string;
      scheduledAt: Date | null;
    }>
  >;
  setStatus(campaignId: string, orgId: string, status: string): Promise<void>;
}

/** One row in the Timeline's run list. */
export interface RunSummary {
  id: string;
  agent: string;
  goal: string;
  trigger: RunTrigger;
  status: RunStatus;
  costCents: number;
  startedAt: Date;
  endedAt?: Date;
  /** Set on a delegated subagent run, pointing at the orchestrator's run. */
  parentRunId?: string;
}

/** A run plus the ordered steps that make up its timeline. */
export interface RunDetail extends RunSummary {
  tokens: { input: number; output: number };
  error?: { code: string; message: string };
  steps: Array<{
    /** Monotonic within the run — the render order, never sorted on time. */
    idx: number;
    type: StepType;
    payload: unknown;
    ms: number;
    at: Date;
  }>;
}

/* ── Guardrail identifiers (engine spec §10) ───────────────────────── */

export type GuardrailId =
  | 'claim_grounding'
  | 'compliance_profile'
  | 'brand_voice'
  | 'avatar_saturation'
  | 'duplicate'
  | 'platform_policy'
  | 'rights';

/* ── The contract ──────────────────────────────────────────────────── */

export interface ToolDef<I extends ZodTypeAny = ZodTypeAny, O extends ZodTypeAny = ZodTypeAny> {
  /** Dot-namespaced: "campaign.propose_plan". Family is the segment before the first dot. */
  name: string;
  version: number;

  /**
   * Written FOR THE MODEL. This string is prompt surface — SPARK selects tools by
   * reading it. Say what it does, when to use it, and what it costs. Keep it under
   * ~40 words and avoid implementation detail.
   */
  summary: string;

  input: I;
  /** Include a `why: Explanation` field for any user-visible agent decision. */
  output: O;

  effect: Effect;
  autonomy: Autonomy;
  scopes: Role[];

  /** Run before the handler; any block aborts the call with GUARDRAIL_BLOCKED. */
  guardrails?: GuardrailId[];

  /** Pre-flight cost estimate in cents, checked against remaining budget. */
  estimateCents?: (input: z.infer<I>) => number;

  /** When false, callers must supply an idempotency key. */
  idempotent: boolean;

  /** PRD UI flow IDs this tool backs, e.g. ['CAL-03', 'CC-02']. Documentation only. */
  surfaces?: string[];

  handler: (input: z.infer<I>, ctx: ToolCtx) => Promise<z.infer<O>>;
}

export const defineTool = <I extends ZodTypeAny, O extends ZodTypeAny>(
  def: ToolDef<I, O>,
): ToolDef<I, O> => {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(def.name)) {
    throw new Error(`Tool name must be dot-namespaced lowercase: got "${def.name}"`);
  }
  if (def.effect === 'publish' && def.autonomy === 'human_only') {
    throw new Error(`"${def.name}": publish tools must be gateable, not human_only`);
  }
  if ((def.effect === 'spend') && !def.estimateCents) {
    throw new Error(`"${def.name}": spend tools must provide estimateCents`);
  }
  return def;
};

export const toolFamily = (name: string): string => name.split('.')[0];
