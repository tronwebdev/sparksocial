import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { Platform, PublishError, routeAdapters, type PlatformAdapter } from './adapter.js';
import { createRateLimiter, publishWithRetry, type RateLimiter } from './retry.js';

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

export interface PublishDeps {
  adapters: PlatformAdapter[];
  limiter?: RateLimiter;
  sleep?: (ms: number) => Promise<void>;
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
    guardrails: ['rights', 'platform_policy', 'claim_grounding'],
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

      try {
        const receipt = await publishWithRetry(
          {
            platform: input.platform,
            text: input.text,
            mediaUrls: input.mediaUrls,
            // The content item is the natural key: the same scheduled post must
            // resolve to the same publish, whoever retried it and however.
            idempotencyKey: `${input.contentItemId}:${input.platform}`,
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
