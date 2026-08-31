import type { CreditStore, ScopedDb, ToolCtx } from '@sparksocial/tools';
import type { Role } from '@sparksocial/shared/types';
import { readBudget } from './budget.js';

/**
 * THE CONTEXT FOR WORK NOBODY REQUESTED — schedulers, watchers and webhooks.
 *
 * Five background paths need a `ToolCtx` with no signed-in person behind it: the
 * recipe scheduler, the connection watcher, the outcome observer, the WhatsApp
 * webhook and the engagement webhook. All five were building one by synthesising
 * a `Request` with `x-org-id`/`x-role` headers and handing it to
 * `makeDevResolveCtx`.
 *
 * ── What was and was not wrong with that ──────────────────────────────────
 *
 * Not a security hole, and worth saying plainly because it looks like one. The
 * `Request` is constructed in-process from values already read out of the
 * database; no caller-supplied data reaches those headers, so there is nothing to
 * forge. `dev-auth.ts` is dangerous as a *request* resolver — it trusts headers
 * an attacker writes — and that danger does not transfer to a request the server
 * writes to itself.
 *
 * Three things were wrong anyway:
 *
 * 1. **The dependency pointed the wrong way.** `dev-auth.ts` says "DEVELOPMENT
 *    AUTH ONLY" and "Delete it when the golden-set dev store goes (P3+)".
 *    Following its own instruction would have broken five production paths. A
 *    module marked for deletion should not be load-bearing.
 *
 * 2. **`role` arrived by default, not by decision.** `makeDevResolveCtx` falls
 *    back to `'owner'` when `x-role` is absent, so every caller set `'admin'` to
 *    avoid that — and `evaluate()` reads `ctx.role` directly, so the scheduler's
 *    policy decisions were all being taken at admin scope because of a default in
 *    a dev helper. It is now a required argument: the caller has to say what it
 *    is acting as, and the comment at each site has to justify it.
 *
 * 3. **`genomeId` was invented when omitted.** The dev resolver defaults it to
 *    `'gen_dev'`, and `whatsappWebhook.systemCtx` never set it — so every inbound
 *    WhatsApp message ran with a context claiming genome `gen_dev`. Nothing in
 *    that path currently reads it (`whatsapp.receive` works off brand-scoped
 *    tables), so no isolation was actually crossed. But it is a real value
 *    pointing at a real other tenant's id shape, one genome-scoped query away
 *    from being a leak, and it is exactly what the repository predicate exists to
 *    make impossible. Here `genomeId` is optional and absent means absent.
 *
 * ── What is deliberately not here ─────────────────────────────────────────
 *
 * No `userId`. Nobody signed in, and attributing scheduled work to a person would
 * put a name on a decision they did not take — the tools record
 * `whatsapp:<number>` or leave the field empty instead, which is the truthful
 * record.
 *
 * No `caller`. That is `invokeTool`'s argument and it differs per site: the
 * schedulers declare `agent`, and the WhatsApp webhook declares `user` because
 * the words genuinely came from a person and `whatsapp.receive` is `human_only`.
 * Returning a `caller` here would invite copying whichever one this file guessed.
 *
 * `approvalMode` is set to the conservative rung rather than the permissive one
 * the dev resolver hardcoded. It is currently inert — `evaluate()` reads
 * `brand.approvalMode`, which every caller loads separately through
 * `loadBrandGovernance` — so this is about not leaving a misleading value in a
 * context object, not about changing a decision. If anything ever does start
 * reading it, defaulting to `review_everything` fails toward asking.
 */
export interface SystemCtxArgs {
  db: ScopedDb;
  /** The real ledger. Omitting it would give background work an unmetered budget. */
  credits?: CreditStore;
  orgId: string;
  brandId: string;
  /** Omit when the work genuinely has no genome — do not substitute a placeholder. */
  genomeId?: string;
  /**
   * What this worker is acting as. Required, because `evaluate()` reads it and a
   * default here would be a policy decision made by a helper.
   */
  role: Role;
  runId?: string;
}

export async function makeSystemCtx(args: SystemCtxArgs): Promise<ToolCtx> {
  return {
    orgId: args.orgId,
    brandId: args.brandId,
    ...(args.genomeId ? { genomeId: args.genomeId } : {}),
    ...(args.runId ? { runId: args.runId } : {}),
    role: args.role,
    approvalMode: 'review_everything',
    budget: await readBudget(args.credits, args.orgId),
    db: args.db,
    logger: {
      info: (m, meta) => console.log(`[info] ${m}`, meta ?? ''),
      warn: (m, meta) => console.warn(`[warn] ${m}`, meta ?? ''),
      error: (m, meta) => console.error(`[error] ${m}`, meta ?? ''),
    },
    trace: {
      span: async (_name, fn) => fn(),
      event: () => {},
    },
  };
}
