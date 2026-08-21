import type { ZodTypeAny } from 'zod';
import type { Autonomy, Effect, Role } from '@sparksocial/shared/types';
import type { GuardrailId, PolicySubject, ToolCtx, ToolDef } from './defineTool.js';
import { toolFamily } from './defineTool.js';

/**
 * THE TOOL REGISTRY — the only door to every capability.
 *
 * The tRPC router is *generated* from this map (CLAUDE.md invariant 1), and SPARK's
 * tool manifest is derived from the same records. That is what makes it structurally
 * impossible for the UI to do something the agent cannot, or vice versa: there is one
 * list, and both callers read it.
 *
 * Registration is explicit rather than filesystem-scanned so that the set of
 * capabilities is reviewable in one diff.
 */

/**
 * A tool with its schema generics erased.
 *
 * `ToolDef<I, O>` cannot be stored in a heterogeneous collection: `handler` and
 * `estimateCents` take `z.infer<I>` in an argument position, which makes the type
 * contravariant, so `ToolDef<ZodObject<…>>` is not assignable to
 * `ToolDef<ZodTypeAny>`. Rather than spraying `any` through the call chain
 * (CLAUDE.md forbids it in `packages/*`), the erasure happens exactly once, at
 * {@link register}, and everything downstream works against this honest shape:
 * inputs are `unknown` and get validated by `input.parse()` before any handler
 * sees them, which is what the middleware chain does anyway.
 */
export interface RegisteredTool {
  name: string;
  version: number;
  summary: string;
  input: ZodTypeAny;
  output: ZodTypeAny;
  effect: Effect;
  autonomy: Autonomy;
  scopes: Role[];
  guardrails?: GuardrailId[];
  estimateCents?: (input: unknown) => number;
  policySubject?: (input: unknown, ctx: ToolCtx) => Promise<PolicySubject>;
  producesMedia?: boolean;
  idempotent: boolean;
  surfaces?: string[];
  handler: (input: unknown, ctx: ToolCtx) => Promise<unknown>;
}

const tools = new Map<string, RegisteredTool>();

export function register<I extends ZodTypeAny, O extends ZodTypeAny>(def: ToolDef<I, O>): ToolDef<I, O> {
  if (tools.has(def.name)) {
    throw new Error(`Tool "${def.name}" is already registered.`);
  }
  // The one erasure point. Safe because the middleware chain validates against
  // `def.input` before calling `def.handler`, so the handler still only ever
  // receives a value its own schema accepted.
  tools.set(def.name, def as unknown as RegisteredTool);
  return def;
}

export const getTool = (name: string): RegisteredTool | undefined => tools.get(name);

export const allTools = (): RegisteredTool[] => [...tools.values()];

export const toolsByFamily = (family: string): RegisteredTool[] =>
  allTools().filter((t) => toolFamily(t.name) === family);

/** Reset hook for tests only — never call from application code. */
export const __resetRegistry = (): void => tools.clear();

/**
 * The manifest handed to SPARK. `summary` is prompt surface: the model selects a
 * tool by reading it, which is why `defineTool` treats it as a first-class field.
 */
export interface ManifestEntry {
  name: string;
  version: number;
  summary: string;
  effect: Effect;
  autonomy: Autonomy;
}

export const agentManifest = (): ManifestEntry[] =>
  allTools().map((t) => ({
    name: t.name,
    version: t.version,
    summary: t.summary,
    effect: t.effect,
    autonomy: t.autonomy,
  }));
