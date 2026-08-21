import { z } from 'zod';

/* ── Identity & access ─────────────────────────────────────────────── */

export const Role = z.enum(['owner', 'admin', 'editor', 'approver', 'viewer', 'client']);
export type Role = z.infer<typeof Role>;

/** Ordered most- to least-privileged. Used for `atLeast` comparisons. */
export const ROLE_RANK: Record<Role, number> = {
  owner: 5, admin: 4, editor: 3, approver: 2, viewer: 1, client: 0,
};

/* ── Tool taxonomy ─────────────────────────────────────────────────── */

/** What a tool does to the world. Drives policy, audit, and cost handling. */
export const Effect = z.enum([
  'read',        // no mutation
  'write',       // mutates our own state
  'external',    // calls a third party, no spend, no publish
  'spend',       // consumes credits / incurs vendor cost
  'publish',     // visible outside the workspace — always runs full guardrails
  'destructive', // irreversible
]);
export type Effect = z.infer<typeof Effect>;

/** Default gate for a tool, before workspace policy is applied. */
export const Autonomy = z.enum([
  'auto',       // SPARK may call unattended
  'confirm',    // needs an in-session human confirmation
  'approval',   // routes to the Review queue
  'human_only', // SPARK may never call it
]);
export type Autonomy = z.infer<typeof Autonomy>;

/* ── Explainability (PRD §7.3) ─────────────────────────────────────── */

/**
 * Returned by any tool whose output drives a user-visible agent decision.
 * Rendered by <WhyPopover />. This is a schema obligation, not prose.
 */
export const Explanation = z.object({
  summary: z.string(),                       // one sentence, user-facing
  factors: z.array(z.object({
    label: z.string(),
    weight: z.number().min(0).max(1).optional(),
    detail: z.string().optional(),
  })),
  evidence: z.array(z.object({
    kind: z.enum(['asset', 'knowledge_chunk', 'past_post', 'metric', 'rule', 'trend']),
    id: z.string(),
    note: z.string().optional(),
  })).default([]),
  alternatives: z.array(z.object({
    option: z.string(),
    rejectedBecause: z.string(),
  })).default([]),
});
export type Explanation = z.infer<typeof Explanation>;

/* ── Genome dimensions — THE routing key for the whole engine ──────── */

export const ProofAsset = z.enum([
  'person', 'product_ui', 'physical_craft', 'finished_work', 'physical_product', 'data_outcomes',
]);
export const CaptureCapability = z.enum(['screen', 'space', 'work_artifacts', 'product', 'nothing']);
export const Objective = z.enum(['leads', 'bookings', 'trials', 'sales', 'audience', 'hiring']);
export const TalentAvailability = z.enum(['yes_licensed', 'yes_unlicensed', 'no']);

/**
 * Inferred types alongside the schemas, matching `GenomeDimensions` below.
 * These four are the routing key for the whole engine, so code that switches on
 * them — the campaign planner, the resolver, the mix engine — wants the union,
 * not the Zod object. Declaring them here keeps one definition rather than a
 * `z.infer<typeof …>` repeated at each call site.
 */
export type ProofAsset = z.infer<typeof ProofAsset>;
export type CaptureCapability = z.infer<typeof CaptureCapability>;
export type Objective = z.infer<typeof Objective>;
export type TalentAvailability = z.infer<typeof TalentAvailability>;

export const GenomeDimensions = z.object({
  proof_asset: z.array(ProofAsset).min(1),
  capture_capability: z.array(CaptureCapability).min(1),
  objective: Objective,
  secondary_objectives: z.array(Objective).default([]),
  talent_availability: TalentAvailability,
});
export type GenomeDimensions = z.infer<typeof GenomeDimensions>;

export const GenerationMode = z.enum(['synthesize', 'assemble', 'direct_finish']);
export type GenerationMode = z.infer<typeof GenerationMode>;

export const AssetRole = z.enum([
  'talent_likeness', 'product_screen', 'work_artifact', 'physical_capture',
  'product_shot', 'social_proof', 'knowledge', 'past_post', 'brand_kit',
]);
export type AssetRole = z.infer<typeof AssetRole>;

/**
 * Asset roles as words, for the sentences they appear in.
 *
 * Every `Explanation` is user-facing by invariant 4, and six of them
 * interpolated the enum value straight into prose — "needs physical_capture,
 * product_shot — film a capture brief", "physical_capture would unlock the
 * most". `snake_case` in a sentence is the tell that a screen is printing a
 * database value, and these are the sentences that are supposed to explain
 * SPARK's reasoning to somebody who has never seen the schema.
 *
 * Lowercase because that is how they read mid-sentence, which is where all six
 * uses are; `assetRoleLabel` capitalises for a heading. One record rather than
 * a per-package map, because the drift between copies is exactly the bug —
 * `apps/web`'s dropdown labels derive from this too, keeping only their own
 * ordering.
 */
export const ASSET_ROLE_WORDS: Record<AssetRole, string> = {
  talent_likeness: 'talent likeness',
  product_screen: 'product screen',
  work_artifact: 'work artifact',
  physical_capture: 'physical capture',
  product_shot: 'product shot',
  social_proof: 'social proof',
  knowledge: 'knowledge',
  past_post: 'past post',
  brand_kit: 'brand kit',
};

/**
 * How the owner gets an asset of this role, when they have none.
 *
 * `physical_capture` is the only role that needs a camera pointed at something
 * that is not already photographed — it is what the Direct+Finish capture loop
 * exists for. Every other role is a file the owner either already has or can
 * produce in a minute: a logo, a PDF, a screenshot of a review, a photo of
 * finished work.
 *
 * The resolver used to make this distinction by `mode === 'direct_finish'`
 * instead, and it drew the wrong conclusion from it: a playbook missing its
 * assets was kept as `unlockable` only if it could be *filmed*, and otherwise
 * rejected with "cannot be filmed to order". True, and irrelevant — a brand kit
 * cannot be filmed but can be supplied instantly. The consequence was that a
 * brand with an empty library had fourteen playbooks silently discarded, and
 * `asset.gaps` reported filming as the only way forward when uploading one logo
 * file would have unlocked six formats, one of which outscored every other
 * option available without a camera.
 *
 * Every golden fixture in `packages/playbooks/src/golden.ts` carries
 * `brand_kit: 1`, so the whole test suite modelled the world *after* a brand kit
 * exists. Onboarding never asks for one, which is why no test caught this and
 * opening the product did.
 */
export const ASSET_ROLE_SUPPLY: Record<AssetRole, 'upload' | 'capture'> = {
  brand_kit: 'upload',
  knowledge: 'upload',
  social_proof: 'upload',
  work_artifact: 'upload',
  product_screen: 'upload',
  product_shot: 'upload',
  past_post: 'upload',
  /** A likeness the brand holds rights to — a file, not a shoot. Still gated by `guard.rights`. */
  talent_likeness: 'upload',
  physical_capture: 'capture',
};

/**
 * Whether a set of missing roles can be closed by uploading, or needs filming.
 *
 * `capture` if *any* role needs a camera: a playbook missing both a brand kit
 * and footage is not unlocked by the logo alone, and telling someone to upload
 * would send them back for a second round.
 */
export function unlockRouteFor(roles: readonly AssetRole[]): 'upload' | 'capture' {
  return roles.some((r) => ASSET_ROLE_SUPPLY[r] === 'capture') ? 'capture' : 'upload';
}

/** `ASSET_ROLE_WORDS`, capitalised for a label or heading rather than a sentence. */
export function assetRoleLabel(role: AssetRole): string {
  const words = ASSET_ROLE_WORDS[role];
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A list of roles as it should read inside a sentence.
 *
 * The six call sites all did `missingRoles.join(', ')`, which for two roles
 * produced "needs physical_capture, product_shot" — a list a person reads as
 * possibly incomplete. Oxford-comma "and" for the last item says it is the
 * whole list.
 */
export function assetRoleWordList(roles: readonly AssetRole[]): string {
  const words = roles.map((r) => ASSET_ROLE_WORDS[r]);
  if (words.length <= 1) return words[0] ?? '';
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export const ContentPillar = z.enum([
  'educational', 'product', 'proof', 'personality', 'community',
]);
export type ContentPillar = z.infer<typeof ContentPillar>;

/* ── Agent runs (plan §4.5 — the Agent Timeline) ───────────────────── */

/**
 * The run vocabulary lives here, not in `packages/spark`, because both ends of
 * the Timeline need it and they sit on opposite sides of the build order:
 * `packages/spark` *writes* runs through `RunRecorder`, `packages/tools` *reads*
 * them through `ScopedDb.runs`, and tools is built long before spark. Declaring
 * it twice would let the writer and the reader drift, which on a timeline shows
 * up as steps that silently render in the wrong order or not at all.
 */
export const RunTrigger = z.enum(['user', 'schedule', 'event']);
export type RunTrigger = z.infer<typeof RunTrigger>;

export const RunStatus = z.enum(['running', 'succeeded', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;

/**
 * `think` and `wait` are the reason this is not derived from `tool_calls`: the
 * reasoning between calls, and the time spent parked on a human, are exactly
 * what answers "why is this here?".
 */
export const StepType = z.enum(['think', 'tool', 'delegate', 'wait']);
export type StepType = z.infer<typeof StepType>;

/* ── Untrusted input containment ───────────────────────────────────── */

const UNTRUSTED = Symbol('untrusted');

export type Untrusted<T = string> = { readonly [UNTRUSTED]: true; value: T; source: string };

/**
 * Wrap anything that came from outside the workspace before it reaches a model
 * prompt: crawled pages, RSS items, social comments, inbound WhatsApp media captions.
 * Prompt builders must render these inside explicit data delimiters and must never
 * treat their contents as instructions.
 */
export const untrusted = <T>(value: T, source: string): Untrusted<T> =>
  ({ [UNTRUSTED]: true, value, source } as Untrusted<T>);

export const isUntrusted = (v: unknown): v is Untrusted<unknown> =>
  typeof v === 'object' && v !== null && UNTRUSTED in v;

/* ── Errors ────────────────────────────────────────────────────────── */

export type ToolErrorCode =
  | 'FORBIDDEN' | 'NEEDS_APPROVAL' | 'NEEDS_CONFIRMATION' | 'GUARDRAIL_BLOCKED'
  | 'BUDGET_EXCEEDED' | 'RATE_LIMITED' | 'NOT_FOUND' | 'INVALID_INPUT'
  | 'UPSTREAM_FAILED' | 'ISOLATION_VIOLATION'
  /**
   * Authenticated, but the session carries no organization.
   *
   * Distinct from `FORBIDDEN` because the remedy is different and only the
   * caller can act on it: `FORBIDDEN` means sign in again, this means finish
   * choosing a workspace. Collapsing the two is what made a stuck Clerk session
   * task present as `401 Not signed in` to a user who was demonstrably signed
   * in — the client could not tell which recovery to offer, so it offered none.
   */
  | 'NO_ORGANIZATION'
  /**
   * Another call is already running under this idempotency key.
   *
   * Distinct from `RATE_LIMITED` (slow down) and from `UPSTREAM_FAILED` (it
   * broke): nothing is wrong, the work is simply already in flight, and the
   * correct response is to wait and read the result rather than to send the
   * request again. `invoke.ts` returns this instead of executing a second side
   * effect — see `InvokeDeps.reserveIdempotent`.
   */
  | 'IN_FLIGHT';

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
