import { z, ZodTypeAny } from 'zod';
import type { Role, Effect, Autonomy, AssetRole } from '@sparksocial/shared/types';
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
  };
  assets: {
    /** Counts by asset_role for the genome — the resolver's availability input. */
    inventory(genomeId: string, orgId: string): Promise<Partial<Record<AssetRole, number>>>;
  };
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
