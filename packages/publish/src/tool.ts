import { z } from 'zod';
import { defineTool, type PolicySubject, type ToolCtx } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { byId as playbookById } from '@sparksocial/playbooks';
import { Platform, PublishError, routeAdapters, type PlatformAdapter } from './adapter.js';
import { createRateLimiter, publishWithRetry, type RateLimiter } from './retry.js';

/**
 * The publish context `policy.ts` rule 7 evaluates — see `PolicySubject` in
 * `defineTool.ts` for why the tool derives this rather than the caller sending it.
 *
 * `contentType` is the playbook's own `output.media_type` (`video` · `image` ·
 * `carousel` · `text`). That is the vocabulary a workspace is actually choosing
 * from when it says "carousels need review", and it is a property of the format
 * rather than of the platform, so it survives the same post going to two places.
 *
 * `isAutomationOutput`/`reviewBeforePublish` come off the `content_items` row:
 * a post created by a recipe carries the recipe's id, and the recipe carries
 * whether its outputs are to be reviewed. Reading it here — before the handler,
 * on the tool's own initiative — is what makes AUTO-04.4's review checkbox
 * binding on the publish call rather than advisory.
 */
async function publishPolicySubject(
  input: { platform: string; playbookId: string; contentItemId: string; genomeId: string },
  ctx: ToolCtx,
): Promise<PolicySubject> {
  const playbook = playbookById(input.playbookId);
  const origin = await ctx.db.content.publishOrigin({
    id: input.contentItemId,
    genomeId: input.genomeId,
    orgId: ctx.orgId,
  });

  return {
    platform: input.platform,
    ...(playbook ? { contentType: playbook.output.media_type } : {}),
    ...(origin?.recipeId
      ? { isAutomationOutput: true, reviewBeforePublish: origin.reviewBeforePublish }
      : {}),
  };
}

/**
 * The rollback's own publish context. Same shape, different source: a rollback
 * names only the item, so platform and format come off the stored row rather
 * than the input. A brand that requires review before *posting* to a platform
 * has, if anything, a stronger claim to review before a public unpublish of the
 * same platform — an unpublish is visible too.
 */
async function rollbackPolicySubject(
  input: { contentItemId: string; genomeId: string },
  ctx: ToolCtx,
): Promise<PolicySubject> {
  const item = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
  const playbook = item?.playbookId ? playbookById(item.playbookId) : undefined;
  const origin = await ctx.db.content.publishOrigin({
    id: input.contentItemId,
    genomeId: input.genomeId,
    orgId: ctx.orgId,
  });

  return {
    ...(item?.platform ? { platform: item.platform } : {}),
    ...(playbook ? { contentType: playbook.output.media_type } : {}),
    ...(origin?.recipeId
      ? { isAutomationOutput: true, reviewBeforePublish: origin.reviewBeforePublish }
      : {}),
  };
}

/**
 * `publish.now` — the terminal step, and the highest-consequence tool in the
 * registry (plan §12 P4).
 *
 * Everything before it is reversible. This is not: a post on someone else's
 * feed has been seen by the time anyone notices it was wrong. Three
 * consequences follow, and all three are contract, not convention:
 *
 * **`effect: 'publish'`.** The policy engine has a dedicated branch for this
 * effect (`policy.ts`), which is what makes `review_first_week` and
 * `review_everything` mean anything. Declaring any other effect would route the
 * most dangerous call in the product around the approval ladder.
 *
 * **`idempotent: false`.** A retried call must not put the post up twice. The
 * key is threaded all the way to the adapter, so the platform can dedupe too —
 * our own replay only protects against *our* retries.
 *
 * **Guardrails declared here.** `rights`, `platform_policy` and
 * `claim_grounding` run before the call, not after: a claim that cannot be
 * grounded must never reach a feed, and unlike everything upstream there is no
 * later stage to catch it.
 */

/**
 * Draft-shaped on purpose. `makeRunGuardrails` parses the tool's *input* against
 * `GuardrailableDraft`, and blocks with `wiring_error` if it does not match —
 * loudly, rather than skipping enforcement. So `genomeId`, `playbookId` and
 * `referencedAssetIds` are not redundant with context: they are what makes the
 * guardrails actually run on the last irreversible step.
 *
 * `genomeId` is re-checked against the verified context in the handler. That
 * does not close the whole gap — guardrails run *before* the handler in
 * `invokeTool`, so a mismatched id would already have been used to gather
 * history. Cross-org is impossible (every gather read is filtered by
 * `ctx.orgId`), but inside one agency workspace a caller could name another
 * client's genome and have the checks evaluated against the wrong history. That
 * affects `guard.evaluate_draft` identically and belongs in `invokeTool`, not
 * here; recorded in docs/STATUS.md.
 */
export const PublishNowInput = z.object({
  /** The scheduled `content_items` row being published. */
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
  playbookId: z.string().min(1),
  platform: Platform,
  text: z.string().min(1).max(5_000),
  referencedAssetIds: z.array(z.string()).default([]),
  mediaUrls: z.array(z.string().url()).max(10).default([]),
});

export const PublishNowOutput = z.object({
  platform: Platform,
  externalId: z.string(),
  url: z.string().optional(),
  via: z.string(),
  publishedAt: z.string(),
  attempts: z.number(),
});

/**
 * Per-post platform cost, in cents — see `publish.now`'s `estimateCents`.
 *
 * X is the only one that bills per post today (the PRD's Track 3: pay-per-use,
 * ~$0.20 with a URL). The rest are free-with-quota, and are recorded at 1¢
 * rather than 0¢ deliberately: a zero estimate takes the call out of
 * `policy.ts` rule 4 entirely, including the spend-permission check, so "free"
 * and "unmetered" would become the same thing.
 */
const PLATFORM_COST_CENTS: Record<string, number> = {
  x: 20,
  instagram: 1,
  tiktok: 1,
  linkedin: 1,
  youtube_shorts: 1,
  default: 1,
};

export interface EmbedClient {
  embed(text: string): Promise<number[]>;
}

export interface PublishDeps {
  adapters: PlatformAdapter[];
  limiter?: RateLimiter;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Computes the copy's embedding for `content.markPublished` — the write
   * side of `guard.duplicate`/`guard.avatar_saturation`'s trailing-window
   * read. Same `EmbedClient` shape `makeRunGuardrails` takes, so a caller
   * that already has one (every one does, guardrails need it too) passes the
   * same instance rather than standing up a second embedding client.
   */
  embed: EmbedClient;
}

export function makePublishNow(deps: PublishDeps) {
  const router = routeAdapters(deps.adapters);
  const limiter = deps.limiter ?? createRateLimiter();

  return defineTool({
    name: 'publish.now',
    version: 1,

    summary:
      'Publish a scheduled post to one platform, now. Irreversible — the post is live and visible. ' +
      'Requires an idempotency key. Costs a rate-budget slot.',

    input: PublishNowInput,
    output: PublishNowOutput,

    effect: 'publish',
    // `auto` is the *default before workspace policy*. The policy engine still
    // routes this through review under `review_first_week` /
    // `review_everything`; autonomy here is what makes autopublish possible at
    // all, not what makes it unconditional.
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false,
    /**
     * Publishing costs money on at least one platform and cost nothing here.
     *
     * The PRD's own integrations register prices X at *"~$0.20/post w/ URL"*
     * (Track 3), and this tool declared no `estimateCents`, so every post was
     * recorded at 0¢. Two consequences, and the second is worse than the
     * accounting one: `policy.ts` rule 4 keys on `estimatedCents > 0`, so a
     * zero estimate also skipped the `permissions.spendCredits === false`
     * check — a workspace with credit spending switched off could still publish
     * to a paid platform indefinitely.
     *
     * Per-platform because the prices are not comparable. The figures are
     * deliberately coarse and named as estimates: the ledger's job here is to
     * make spend *visible and enforceable*, and a coarse non-zero number does
     * that where an exact zero does not.
     */
    estimateCents: (raw) => {
      const parsed = PublishNowInput.safeParse(raw);
      if (!parsed.success) return PLATFORM_COST_CENTS.default;
      return PLATFORM_COST_CENTS[parsed.data.platform] ?? PLATFORM_COST_CENTS.default;
    },
    /**
     * All seven, not three.
     *
     * This declared `['rights', 'platform_policy', 'claim_grounding']` and was
     * the *only* tool in the registry declaring any guardrails at all — so
     * `brand_voice`, `duplicate`, `avatar_saturation`, `compliance_profile` and
     * (once it existed) `restricted_topics` were fully implemented, unit-tested,
     * and run by no code path in the product.
     *
     * `compliance_profile` was the sharp end of that. Its own module comment
     * quotes the engine spec — *"Do not ship these verticals without this in
     * place — we would be generating liability for customers at scale"* — and it
     * was not on the publish path. A health brand's "cures" claim reached a feed.
     *
     * Cost is a real consideration and does not change the answer: `duplicate`
     * embeds the copy, which is one embedding call on the last irreversible step
     * of a post that already cost dollars to produce. `gather.ts` runs all of
     * them concurrently.
     */
    guardrails: [
      'rights',
      'platform_policy',
      'claim_grounding',
      'compliance_profile',
      'restricted_topics',
      'brand_voice',
      'duplicate',
      'avatar_saturation',
    ],
    policySubject: publishPolicySubject,
    surfaces: ['CAL-05'],

    async handler(input, ctx) {
      const brandId = ctx.brandId;
      if (!brandId) {
        throw new ToolError('INVALID_INPUT', 'A brand must be selected to publish.');
      }

      // The genome in the input exists for the guardrail contract; the verified
      // one is `ctx.genomeId`. Publishing a post attributed to a genome the
      // caller did not select is not something to resolve silently.
      if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
          claimed: input.genomeId,
          selected: ctx.genomeId,
        });
      }

      const now = new Date();
      if (!(await limiter.tryConsume(brandId, input.platform, now))) {
        // A budget refusal is not an error in the post — it is the throttle
        // working. RATE_LIMITED tells the caller to reschedule rather than to
        // fix and retry.
        throw new ToolError(
          'RATE_LIMITED',
          `${input.platform} posting budget for this brand is spent for now.`,
          { platform: input.platform, remaining: 0 },
        );
      }

      const adapter = router.for(input.platform);
      let attempts = 0;

      // Resolved straight from `oauth_connections` rather than through an
      // injected deps function — `ctx.db` is already the right seam for a
      // per-request lookup, and adding an indirection here would only be
      // one more thing every caller of `makePublishNow` has to wire.
      // `undefined` for a platform whose connection this brand never made
      // (or for the aggregator/stub, which need no per-brand token at all)
      // — the adapter itself decides whether that's fatal.
      const connection = await ctx.db.oauthConnections.get(input.genomeId, ctx.orgId, input.platform);
      const accessToken = connection?.accessToken;

      try {
        const receipt = await publishWithRetry(
          {
            platform: input.platform,
            text: input.text,
            mediaUrls: input.mediaUrls,
            // The content item is the natural key: the same scheduled post must
            // resolve to the same publish, whoever retried it and however.
            idempotencyKey: `${input.contentItemId}:${input.platform}`,
            ...(accessToken ? { accessToken } : {}),
          },
          {
            publish: (r) => adapter.publish(r),
            ...(deps.sleep ? { sleep: deps.sleep } : {}),
            onAttempt: (n, error) => {
              attempts = n;
              ctx.logger.warn('publish attempt failed', {
                platform: input.platform,
                attempt: n,
                retryable: error.retryable,
                message: error.message,
              });
            },
          },
        );

        ctx.logger.info('published', {
          platform: receipt.platform,
          externalId: receipt.externalId,
          via: receipt.via,
        });

        // The write side of `recent()` (§10's duplicate/avatar_saturation
        // checks) and the only place `platform`/the receipt land on the row.
        // Best-effort: the post is already live by this point, so a store
        // failure here must not be reported as a publish failure — it would
        // invite a retry that posts a second time. Logged loudly instead,
        // same trade-off as `recordCost`'s swallowed failure in invoke.ts.
        try {
          await ctx.db.content.markPublished({
            id: input.contentItemId,
            orgId: ctx.orgId,
            platform: receipt.platform,
            embedding: await deps.embed.embed(input.text),
            externalId: receipt.externalId,
            via: receipt.via,
            ...(receipt.url ? { url: receipt.url } : {}),
            publishedAt: receipt.publishedAt,
          });
        } catch (e) {
          ctx.logger.error('failed to record the publish receipt — the post is live but content_items was not updated', {
            contentItemId: input.contentItemId,
            error: e instanceof Error ? e.message : String(e),
          });
        }

        // Best-effort for the same reason as `markPublished` above: the post
        // is already live, so a store failure here must not fail the call.
        // Without this, `usageCount`/`lastUsedAt` never move off their
        // insert-time defaults on the one path that accounts for nearly
        // every real use — see `asset.reuse`'s own comment.
        await Promise.all(
          input.referencedAssetIds.map((assetId) =>
            ctx.db.assets.recordUsage({ id: assetId, genomeId: input.genomeId, orgId: ctx.orgId }).catch((e: unknown) => {
              ctx.logger.error('failed to record asset usage — the post is live but usageCount was not updated', {
                contentItemId: input.contentItemId,
                assetId,
                error: e instanceof Error ? e.message : String(e),
              });
            }),
          ),
        );

        return {
          platform: receipt.platform,
          externalId: receipt.externalId,
          ...(receipt.url ? { url: receipt.url } : {}),
          via: receipt.via,
          publishedAt: receipt.publishedAt.toISOString(),
          attempts: attempts + 1,
        };
      } catch (e) {
        if (e instanceof PublishError) {
          throw new ToolError('UPSTREAM_FAILED', e.message, {
            platform: e.platform,
            retryable: e.retryable,
          });
        }
        throw e;
      }
    },
  });
}

/* ── Rollback (plan §10: "publish.rollback for platforms that support deletion, plus an incident runbook for those that don't") ── */

export const PublishRollbackInput = z.object({
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
  /** Not persisted anywhere yet (no column for it) — logged, for the audit trail's own record of why. */
  reason: z.string().max(500).optional(),
});

export const PublishRollbackOutput = z.object({
  contentItemId: z.string(),
  platform: Platform,
  rolledBackAt: z.string(),
});

export function makePublishRollback(deps: PublishDeps) {
  const router = routeAdapters(deps.adapters);

  return defineTool({
    name: 'publish.rollback',
    version: 1,

    summary:
      'Delete a published post from the platform and mark it rolled back. Only works where the adapter ' +
      'actually serving that platform supports deletion — refuses cleanly, naming the platform, when it ' +
      "doesn't, rather than pretending the post came down.",

    input: PublishRollbackInput,
    output: PublishRollbackOutput,

    // Deleting something already public is its own kind of irreversible
    // (the deletion itself can't be undone, and a fast unpublish/republish
    // reads as suspicious on most platforms) — same effect class as the
    // publish it reverses, so it goes through the identical guardrail gate.
    effect: 'publish',
    autonomy: 'auto',
    scopes: ['owner', 'admin'],
    idempotent: false,
    policySubject: rollbackPolicySubject,

    async handler(input, ctx) {
      const item = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
      if (!item) throw new ToolError('NOT_FOUND', 'That content item is not open.', { contentItemId: input.contentItemId });
      if (item.status !== 'published' || !item.platform || !item.externalId) {
        throw new ToolError('INVALID_INPUT', 'This post is not currently published — nothing to roll back.', {
          contentItemId: input.contentItemId,
          status: item.status,
        });
      }

      const platform = item.platform as Platform;
      const adapter = router.for(platform);
      if (!adapter.delete) {
        // Not a caller mistake in the ordinary sense — the request is well-formed,
        // the adapter serving this platform just has no delete endpoint. No
        // dedicated code for "unsupported by the current adapter" exists in the
        // shared union, and inventing one here would mean every caller's switch
        // has to learn it too; INVALID_INPUT is the closest existing code whose
        // remedy (don't retry this the same way) matches.
        throw new ToolError(
          'INVALID_INPUT',
          `${adapter.name} has no delete capability for ${platform} — this platform has to be taken down manually.`,
          { platform, via: adapter.name },
        );
      }

      const connection = await ctx.db.oauthConnections.get(input.genomeId, ctx.orgId, platform);

      try {
        await adapter.delete(item.externalId, platform, connection?.accessToken);
      } catch (e) {
        if (e instanceof PublishError) {
          throw new ToolError('UPSTREAM_FAILED', e.message, { platform: e.platform, retryable: e.retryable });
        }
        throw e;
      }

      await ctx.db.content.markRolledBack({ id: input.contentItemId, orgId: ctx.orgId });

      ctx.logger.info('publish rolled back', {
        contentItemId: input.contentItemId,
        platform,
        via: adapter.name,
        ...(input.reason ? { reason: input.reason } : {}),
      });

      return { contentItemId: input.contentItemId, platform, rolledBackAt: new Date().toISOString() };
    },
  });
}

/* ── Health (plan §12 P4: "scheduling, retry, health, rate budgets") ── */

export const PublishStatusInput = z.object({});

export const PublishStatusOutput = z.object({
  platforms: z.array(
    z.object({
      platform: Platform,
      supported: z.boolean(),
      via: z.string().nullable(),
      remainingToday: z.number(),
    }),
  ),
});

export function makePublishStatus(deps: PublishDeps) {
  const router = routeAdapters(deps.adapters);
  const limiter = deps.limiter ?? createRateLimiter();

  return defineTool({
    name: 'publish.status',
    version: 1,

    summary:
      'Which platforms this workspace can publish to right now, through which adapter, and how much ' +
      'posting budget is left today. Read-only, free.',

    input: PublishStatusInput,
    output: PublishStatusOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
    idempotent: true,

    async handler(_input, ctx) {
      const brandId = ctx.brandId;
      if (!brandId) throw new ToolError('INVALID_INPUT', 'A brand must be selected.');

      const now = new Date();
      const supported = new Set(router.supported());

      return {
        // `Promise.all`, not a sequential loop: these are five independent
        // reads against the same store and the health panel waits for all of
        // them. Round-tripping in series would make the slowest surface in the
        // product the one whose whole job is to load quickly.
        platforms: await Promise.all(
          Platform.options.map(async (platform) => {
            const isSupported = supported.has(platform);
            return {
              platform,
              supported: isSupported,
              // Naming the adapter is what makes "LinkedIn is on the aggregator
              // until approval clears" visible rather than folklore.
              via: isSupported ? router.for(platform).name : null,
              remainingToday: isSupported ? await limiter.remaining(brandId, platform, now) : 0,
            };
          }),
        ),
      };
    },
  });
}
