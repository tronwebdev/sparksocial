import { z } from 'zod';

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
 * Every platform the product can publish to.
 *
 * ── Why this list grew ─────────────────────────────────────────────────────
 *
 * It was `['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts']` — five —
 * and **Facebook was not among them**, despite being the first channel on PRD
 * §9's must-have-at-GA list and free under the very same Meta app review as
 * Instagram (Track 1: *"apply to Meta once, unlock Facebook + Instagram +
 * Threads"*). Pinterest, Threads and the whole secondary list were absent too.
 *
 * That was not a routing gap, it was a *vocabulary* gap, and it made the
 * aggregator strategy incoherent: the Ayrshare adapter exists specifically to
 * cover "the long tail (Pinterest, Snapchat, Google Business, Reddit, Bluesky,
 * Threads) without waiting on every audit", and it could not be asked to
 * publish to any of them, because no caller could name one.
 *
 * ── Naming ─────────────────────────────────────────────────────────────────
 *
 * Surface-specific where the surfaces have genuinely different rules and
 * limits (`instagram_story` is 24 hours and vertical; `youtube_long` is not
 * Shorts; `facebook_group` posts under different permissions than a Page), and
 * plain where they do not. `youtube_shorts` keeps its name rather than becoming
 * `youtube` — renaming it would silently repoint every stored
 * `content_items.platform` value.
 *
 * A platform being nameable here does not mean it is reachable: `routeAdapters`
 * picks the first adapter claiming `supports()`, and an unconfigured platform
 * falls through to whatever is last in the list. What this fixes is that the
 * aggregator can now *be* asked.
 */
export const Platform = z.enum([
  // ── Core five: native adapters, own the relationship (PRD Part B, Tier 2) ──
  'instagram',
  'instagram_story',
  'tiktok',
  'linkedin',
  'x',
  'youtube_shorts',
  'youtube_long',
  // ── Meta's other surfaces, same App Review as Instagram ──
  'facebook',
  'facebook_group',
  'threads',
  // ── The aggregator's long tail (PRD §9 "Secondary / Optional") ──
  'pinterest',
  'google_business',
  'reddit',
  'bluesky',
]);
export type Platform = z.infer<typeof Platform>;

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
