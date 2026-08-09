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

export const Platform = z.enum(['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts']);
export type Platform = z.infer<typeof Platform>;

export interface PublishRequest {
  platform: Platform;
  /** Caption/body. Already guardrail-checked before it reaches an adapter. */
  text: string;
  /** Public media URLs. Empty for a text-only post. */
  mediaUrls: string[];
  /** Passed to the platform for genuine dedupe, not only for our own retries. */
  idempotencyKey: string;
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
  opts: { name?: string; supports?: Platform[] } = {},
): PlatformAdapter & { sent: PublishRequest[] } {
  const sent: PublishRequest[] = [];
  const name = opts.name ?? 'aggregator:stub';
  const supported = new Set<Platform>(opts.supports ?? Platform.options);
  let n = 0;

  return {
    name,
    sent,
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
  };
}
