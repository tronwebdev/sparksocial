/**
 * `ReplySender` — the outbound half of the loop `engage.reply.send` needs:
 * deliver one reply to the comment/DM/story reply it answers.
 *
 * ── Why not `PlatformAdapter` (`packages/publish/src/adapter.ts`) ──────────
 * That interface publishes a *new* top-level post — `PublishRequest` has no
 * field for "the existing platform object this replies to" (a comment id, a
 * DM thread). Replying is a different call on every platform's API from
 * posting (and on some platforms, a different call for a comment reply than
 * for a DM), so it earns its own seam rather than being squeezed into one
 * that was built for something else.
 *
 * ── Why a stub, not a real per-platform client, yet ─────────────────────────
 * No "reply to a comment/DM" integration exists yet — the same platform
 * approvals blocker CLAUDE.md names for native publish adapters (§8), not a
 * code gap. `createStubReplySender` follows the same "unset → stub fallback"
 * DI convention `whatsapp-transport-client.ts` and `ayrshare-adapter-client.ts`
 * already establish for exactly this situation: the whole
 * draft → approve → send path runs end to end in development and under test
 * against this interface, so wiring a real client in later is a swap behind
 * it, not a rewrite of `engage.reply.send`.
 */
export interface ReplySendRequest {
  platform: string;
  kind: string;
  /** The platform's own id of the message being replied to. */
  externalId: string;
  authorHandle: string;
  /** Sent exactly as given — the tool never re-derives this from a draft. */
  text: string;
}

export interface ReplySendReceipt {
  /** The outbound reply's own id from whichever implementation sent it. */
  externalId: string;
  /** Which implementation actually delivered — `stub`, eventually e.g. `native:instagram`. */
  via: string;
  sentAt: Date;
}

export interface ReplySender {
  /** Identifies the implementation in receipts and audit rows. */
  readonly name: string;
  send(req: ReplySendRequest): Promise<ReplySendReceipt>;
}

/**
 * Records what would have been sent and returns a well-formed receipt.
 * Deliberately not a throwing stub — same reasoning as
 * `packages/publish/src/adapter.ts`'s `createStubAdapter` and
 * `packages/capture/src/transport.ts`'s `createStubTransport`.
 *
 * `sent` is exposed for assertions; nothing in production reads it.
 */
export function createStubReplySender(): ReplySender & { sent: ReplySendRequest[] } {
  const sent: ReplySendRequest[] = [];
  let n = 0;

  return {
    name: 'stub',
    sent,
    async send(req) {
      sent.push(req);
      return {
        externalId: `stub_reply_${++n}`,
        via: 'stub',
        sentAt: new Date(),
      };
    },
  };
}
