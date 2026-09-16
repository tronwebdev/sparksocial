import { Platform } from '@sparksocial/shared';

/**
 * `PlatformAdapter` — the one publishing seam (plan §8).
 *
 *   *"Build one `PlatformAdapter` interface with both native and aggregator
 *   implementations so the swap is a config change."*
 *
 * The strategic split behind it: native on the core five (Meta, X, LinkedIn,
 * TikTok, YouTube) where data depth and margin matter; an aggregator
 * (Ayrshare / Blotato class) for the long tail, so GA does not wait on every
 * platform audit. Both sit behind this interface, and which one serves a given
 * platform is a routing decision — not something any caller knows about.
 *
 * That matters for the Aug 29 alpha specifically: LinkedIn approval is
 * weeks-to-months (§8) and will not clear. Aggregator-first means publishing
 * ships without it, and the native adapter replaces one entry in the routing
 * table when the approval lands.
 */

/**
 * The platform vocabulary now lives in `@sparksocial/shared`.
 *
 * It was declared here, which made it unreachable from `packages/campaign`,
 * `engage` and `trends` — none of which depend on the publishing layer, and none
 * of which should have to in order to name a platform. `trends` had already
 * worked around it by declaring its own `InfluencerPlatform` subset, and
 * `EngagementPlatform` — a *subset* of this — was in `shared` while the superset
 * was not, which is backwards.
 *
 * Re-exported so the thirty call sites in this package, and anything importing
 * `Platform` from `@sparksocial/publish`, keep working.
 */
export { Platform };

/**
 * Which platform's OAuth connection a platform actually publishes with.
 *
 * Four of the fourteen are not separate accounts. They are a different way of
 * posting to an account the brand has already connected, and asking for a second
 * connection would be asking the same question twice:
 *
 *   instagram_story  the Instagram account, posted as a story rather than a feed
 *                    post. One account, one token, a different media container.
 *   youtube_long     the same YouTube channel and the same Google token as
 *                    `youtube_shorts`. "Shorts" is a duration and an aspect
 *                    ratio, not a destination.
 *   facebook         the Page behind the Instagram Business account. Meta issues
 *                    both from one login, and `exchangeInstagram` already reads
 *                    `/me/accounts` to find it.
 *   facebook_group   a Group administered by that same Page identity.
 *
 * Before this map, each of those four rendered its own Connect button, and every
 * one of them was a dead end: `integration.connect` refused with
 * "isn't configured for native publishing yet" because there is no such thing as
 * an `instagram_story` developer app to configure.
 *
 * Resolution is one level deep by design. A chain would let a typo make a cycle,
 * and nothing here needs one — `connectionPlatform` asserts that by never
 * looping.
 */
export const PARENT_PLATFORM: Partial<Record<Platform, Platform>> = {
  instagram_story: 'instagram',
  youtube_long: 'youtube_shorts',
  facebook: 'instagram',
  facebook_group: 'instagram',
};

/**
 * The platform whose `oauth_connections` row serves this one — itself for the
 * ten that own their connection, the parent for the four that borrow it.
 */
export function connectionPlatform(platform: Platform): Platform {
  return PARENT_PLATFORM[platform] ?? platform;
}

/** Whether this platform borrows another's connection rather than owning one. */
export function isDerivedPlatform(platform: Platform): boolean {
  return platform in PARENT_PLATFORM;
}



export interface PublishRequest {
  platform: Platform;
  /** Caption/body. Already guardrail-checked before it reaches an adapter. */
  text: string;
  /** Public media URLs. Empty for a text-only post. */
  mediaUrls: string[];
  /** Passed to the platform for genuine dedupe, not only for our own retries. */
  idempotencyKey: string;
  /**
   * The connecting brand's OAuth access token, resolved by the caller
   * (`makePublishNow`'s handler reads `ctx.db.oauthConnections` directly)
   * from `oauth_connections` before the adapter is invoked — never looked
   * up by the adapter itself, so every native adapter stays a pure
   * vendor-HTTP wrapper, testable with nothing but an injected `fetchImpl`,
   * the same contract `ayrshareAdapter.ts` already established.
   *
   * Absent for an adapter using one credential shared across every brand
   * (the aggregator, whose app-level API key is set once via env and never
   * varies per genome). Required in practice for every native adapter —
   * each brand connects its own account via `integration.connect`, so
   * there is no shared token a native adapter could fall back to. A native
   * adapter that receives no token throws a `PublishError` naming the
   * missing connection rather than guessing.
   */
  accessToken?: string;

  /**
   * Which destination *inside* the connected account this post goes to.
   *
   * Four platforms have one, and it is not the account: a Pinterest pin needs a
   * board, a Reddit post needs a subreddit, a Google Business post needs a
   * location, and a Facebook Group post needs the group. All four authenticate
   * as the connected account and then publish somewhere that account can reach,
   * which is a second identifier and not a second connection.
   *
   * Absent for the ten platforms where the account *is* the destination. An
   * adapter that needs one and does not get it refuses by name rather than
   * picking a default — publishing to the wrong board is worse than not
   * publishing.
   */
  target?: string;
}

export interface PublishReceipt {
  platform: Platform;
  /** The platform's own id, for later metric reconciliation. */
  externalId: string;
  url?: string;
  /** Which implementation actually delivered — `aggregator:ayrshare`, `native:x`. */
  via: string;
  publishedAt: Date;
}

/**
 * A failure the adapter classifies for the caller.
 *
 * `retryable` is the adapter's judgement, not the caller's guess: only the
 * implementation knows whether a 429 carries a Retry-After it intends to
 * honour, or whether a 400 means the caption was too long and will fail
 * identically forever. Retrying a permanent failure burns rate budget that a
 * genuinely transient one needs.
 */
export class PublishError extends Error {
  constructor(
    readonly platform: Platform,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

export interface PlatformAdapter {
  /** Identifies the implementation in receipts and audit rows. */
  readonly name: string;
  /** Platforms this implementation can serve. */
  supports(platform: Platform): boolean;
  publish(req: PublishRequest): Promise<PublishReceipt>;
  /**
   * Deletes a live post. Optional and deliberately so — plan §10: "rollback
   * for platforms that support deletion, plus an incident runbook for those
   * that don't." Some platforms (and some aggregator plans) genuinely have no
   * delete endpoint; `publish.rollback` checks for this method rather than
   * assuming every adapter has one, and refuses cleanly when it's absent
   * instead of pretending a no-op succeeded.
   */
  /** `accessToken` carries the same per-brand-resolution contract `PublishRequest.accessToken` does — see its doc comment. */
  delete?(externalId: string, platform: Platform, accessToken?: string): Promise<void>;
}

/**
 * Routes each platform to the implementation that serves it, native first.
 *
 * Ordering is the whole point: as native adapters clear approval they are
 * prepended, and the aggregator quietly stops receiving that platform without
 * any caller changing. A platform nothing supports fails loudly rather than
 * silently falling through to a default — publishing to the wrong place is
 * worse than not publishing.
 */
export function routeAdapters(adapters: PlatformAdapter[]) {
  return {
    for(platform: Platform): PlatformAdapter {
      const adapter = adapters.find((a) => a.supports(platform));
      if (!adapter) {
        throw new PublishError(platform, `No adapter is configured for ${platform}.`, false);
      }
      return adapter;
    },
    /** Every platform any configured adapter can reach — what the UI offers. */
    supported(): Platform[] {
      return Platform.options.filter((p) => adapters.some((a) => a.supports(p)));
    },
  };
}

/**
 * Stub aggregator. Records what would have been published and returns a
 * well-formed receipt.
 *
 * Deliberately not a throwing stub, for the same reason as the capture loop's
 * `MessageTransport`: the entire path — calendar → guardrails → policy →
 * publish → receipt — runs end to end in development and under test, so
 * swapping in a real Ayrshare client is a one-line change against a path
 * already known to work.
 *
 * `sent` is exposed for assertions; nothing in production reads it.
 */
export function createStubAdapter(
  opts: { name?: string; supports?: Platform[]; deletable?: boolean } = {},
): PlatformAdapter & { sent: PublishRequest[]; deleted: string[] } {
  const sent: PublishRequest[] = [];
  const deleted: string[] = [];
  const name = opts.name ?? 'aggregator:stub';
  const supported = new Set<Platform>(opts.supports ?? Platform.options);
  let n = 0;

  return {
    name,
    sent,
    deleted,
    supports: (platform) => supported.has(platform),
    async publish(req) {
      // Honour the idempotency key locally too: a stub that double-posts would
      // hide exactly the bug the key exists to prevent.
      const prior = sent.find((s) => s.idempotencyKey === req.idempotencyKey);
      sent.push(req);
      const externalId = prior ? `stub_${req.platform}_replay` : `stub_${req.platform}_${++n}`;
      return {
        platform: req.platform,
        externalId,
        url: `https://example.invalid/${req.platform}/${externalId}`,
        via: name,
        publishedAt: new Date(),
      };
    },
    // Defaults to deletable so the end-to-end path (publish -> rollback) is
    // exercisable in dev without a real account; `deletable: false` is how a
    // test stands in for the platforms that genuinely have no delete endpoint.
    ...(opts.deletable === false
      ? {}
      : {
          async delete(externalId: string) {
            deleted.push(externalId);
          },
        }),
  };
}
