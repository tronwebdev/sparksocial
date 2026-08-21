import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';

/**
 * `engage.thread` — PRD §8.8 / `ENG-02.4`'s conversation.
 *
 *   *"Sales Opportunities (hot/warm/cold + recommended action + conversation
 *   drawer)"*
 *
 * The feed showed one message at a time because that was all the storage could
 * describe: rows were keyed by the platform's per-message id, and nothing said
 * which of them belonged to the same exchange. A lead that took four messages to
 * become a lead read as four unrelated strangers, and the drawer §8.8 asks for
 * had nothing to draw.
 *
 * ── The thread key, and why it is stored rather than derived at read time ──
 *
 * `engage.ingest` takes the platform's own conversation id when there is one and
 * calls {@link deriveThreadKey} when there is not. Either way the answer lands
 * on the row, so this read is one indexed equality — and so a platform that
 * starts supplying real ids does not silently re-group a brand's history under
 * a different rule than the one it was filed under.
 *
 * ── Both halves of the conversation ───────────────────────────────────────
 *
 * Each row contributes up to two turns: the message that came in, and the reply
 * that went out (`sentReply`). Before this, the outbound half lived only in
 * `tool_calls.input`, which is deliberately a projection that never returns
 * inputs — so a transcript built from the feed alone would have shown a customer
 * talking to nobody.
 *
 * ── Every inbound turn is a stranger's words ──────────────────────────────
 *
 * Returned verbatim, exactly like `engage.list`'s `text`, because the consumer
 * is a browser rendering characters rather than a model reading instructions.
 * The fencing happens where prompts are built — `engage-classifier.ts` and
 * `reply-writer.ts` both pass inbox text through `renderUntrusted` — and
 * **anything that summarises a thread must do the same**. That is worth stating
 * because a transcript is a longer and more convincing place to hide an
 * instruction than a single card, not a safer one: four turns of plausible
 * conversation ending in "ignore your previous instructions" reads far more like
 * context than one comment does.
 */

/** Ceiling on how much of one conversation comes back. Well past any real DM exchange; a bound, not a page size. */
const MAX_TURNS = 100;

export const EngageThreadInput = z.object({
  genomeId: z.string().min(1),
  /**
   * Any message in the conversation. Not the thread key itself: a caller holding
   * a feed card has a message id, and asking it to know the key would put the
   * derivation rule in the client.
   */
  messageId: z.string().min(1),
  limit: z.number().int().min(1).max(MAX_TURNS).default(50),
});

const Turn = z.object({
  /** `inbound` is them, `outbound` is us. */
  direction: z.enum(['inbound', 'outbound']),
  at: z.string(),
  text: z.string(),
  /** Set on inbound turns — who said it. */
  authorHandle: z.string().optional(),
  authorName: z.string().optional(),
  /** The `engagement_messages` row this turn came from, so a caller can act on it. */
  messageId: z.string(),
  /** Inbound only: the triage verdict, when one was made. */
  category: z.string().optional(),
  intentScore: z.number().optional(),
  /**
   * The row's lifecycle status, on **both** directions — it means something
   * different either way and both are worth showing.
   *
   * On an inbound turn it is where the message got to (`new`, `classified`,
   * `escalated`). On an outbound turn it is *how the reply was sent*: `replied`
   * means a person read the words first, `auto_handled` means SPARK sent them
   * unattended. That distinction is the reason the status enum keeps the two
   * apart rather than collapsing them onto `replied`, and a transcript that
   * dropped it would flatten the one fact somebody reviewing a conversation most
   * needs — whether anybody checked before it went out.
   */
  status: z.string().optional(),
});

export const EngageThreadOutput = z.object({
  threadKey: z.string(),
  platform: z.string(),
  kind: z.string(),
  authorHandle: z.string(),
  authorName: z.string().optional(),
  /** Oldest first — a transcript is read downward. */
  turns: z.array(Turn),
  /** How many inbound messages the conversation holds, which is not the turn count. */
  messageCount: z.number().int(),
  /** True when the conversation was longer than `limit` and the oldest turns are missing. */
  truncated: z.boolean(),
  /**
   * True when this row predates threading (or the platform gave no id and the
   * message is a one-off), so the "thread" is the single message. Said plainly
   * rather than rendered as a one-turn conversation nobody can tell from a real
   * one.
   */
  single: z.boolean(),
  why: Explanation,
});

/**
 * The conversation a message belongs to, when the platform did not say.
 *
 * **Always includes the author handle**, which is the whole safety property: two
 * different people can never be merged into one thread by a derivation mistake.
 * The cost is that a group conversation with several participants becomes several
 * threads, which is the failure this trades for — a fragmented transcript is
 * confusing, a merged one leaks one stranger's words into another's drawer.
 *
 * - **DM** — the conversation *is* the pair (us, them) on that platform. Handles
 *   are unique per platform, so this is exact rather than approximate.
 * - **comment / story reply** — scoped to the post as well, because the same
 *   person commenting on two different posts is two conversations. A comment
 *   with no known post falls back to the pair, which over-merges a prolific
 *   commenter's threads and is still safe by the rule above.
 */
export function deriveThreadKey(args: {
  platform: string;
  kind: string;
  authorHandle: string;
  contentItemId?: string;
}): string {
  const author = args.authorHandle.trim().toLowerCase().replace(/^@/, '');
  if (args.kind === 'dm') return `dm:${args.platform}:${author}`;
  return args.contentItemId
    ? `${args.kind}:${args.platform}:${args.contentItemId}:${author}`
    : `${args.kind}:${args.platform}:${author}`;
}

export const engageThread = defineTool({
  name: 'engage.thread',
  version: 1,

  summary:
    'The whole conversation one inbox message belongs to — every message from that person on that ' +
    'platform (and post, for comments) plus every reply sent back, oldest first. The ENG-02.4 drawer. Free.',

  input: EngageThreadInput,
  output: EngageThreadOutput,

  effect: 'read',
  autonomy: 'auto',
  /**
   * Same read scopes as `engage.list`, including `client`: a thread is the
   * messages that feed already shows, assembled. Gating the assembled view
   * tighter than the rows it is built from would be theatre.
   */
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,
  surfaces: ['ENG-02.4'],

  async handler(input, ctx) {
    if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
        claimed: input.genomeId,
        selected: ctx.genomeId,
      });
    }

    const seed = await ctx.db.engagement.get(input.messageId, input.genomeId, ctx.orgId);
    if (!seed) throw new ToolError('NOT_FOUND', 'No inbox message with that id in this genome.');

    /**
     * A row written before threading existed has no key. Rather than derive one
     * on the fly — which would return a thread the *store* does not agree this
     * message is in — the message is reported as its own conversation. The next
     * inbound message from that person gets a key, and the drawer starts working
     * from there.
     */
    const threadKey = seed.threadKey;
    const messages = threadKey
      ? await ctx.db.engagement.thread(input.genomeId, ctx.orgId, { threadKey, limit: input.limit })
      : [seed];

    const turns = messages
      .flatMap((m) => {
        const inbound = {
          direction: 'inbound' as const,
          at: m.receivedAt.toISOString(),
          text: m.text,
          authorHandle: m.authorHandle,
          ...(m.authorName ? { authorName: m.authorName } : {}),
          messageId: m.id,
          ...(m.category ? { category: m.category } : {}),
          ...(m.intentScore !== undefined ? { intentScore: m.intentScore } : {}),
          status: m.status,
        };
        if (!m.sentReply) return [inbound];
        return [
          inbound,
          {
            direction: 'outbound' as const,
            // `sentAt` is when the reply went out; `resolvedAt` is the fallback
            // for a row answered before `sentAt` existed, so an older reply
            // still lands in the right place in the transcript rather than at
            // the epoch.
            at: (m.sentAt ?? m.resolvedAt ?? m.receivedAt).toISOString(),
            text: m.sentReply,
            messageId: m.id,
            // Carried so the drawer can mark an unattended send. Omitting it
            // made that label unreachable — the component read `turn.status` on
            // an outbound turn that never had one.
            status: m.status,
          },
        ];
      })
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    return {
      threadKey: threadKey ?? deriveThreadKey({ platform: seed.platform, kind: seed.kind, authorHandle: seed.authorHandle, ...(seed.contentItemId ? { contentItemId: seed.contentItemId } : {}) }),
      platform: seed.platform,
      kind: seed.kind,
      authorHandle: seed.authorHandle,
      ...(seed.authorName ? { authorName: seed.authorName } : {}),
      turns,
      messageCount: messages.length,
      truncated: messages.length >= input.limit,
      single: !threadKey,
      why: explain(messages.length, turns.length, threadKey !== undefined),
    };
  },
});

/**
 * §7.3's `why` on a read, because this one is not an enumeration the way
 * `engage.list` is — it is an assertion that these particular messages are *the
 * same conversation*, and the rule that decided so is a judgement a person may
 * want to check. A merged or fragmented thread is precisely the kind of mistake
 * that looks like data and is actually a rule.
 */
function explain(messageCount: number, turnCount: number, keyed: boolean): Explanation {
  if (!keyed) {
    return {
      summary: 'This message arrived before conversations were tracked, so it stands alone.',
      factors: [{ label: 'thread key', detail: 'none on the row — not grouped rather than grouped wrongly' }],
      evidence: [],
      alternatives: [],
    };
  }
  return {
    summary: `${messageCount} message${messageCount === 1 ? '' : 's'} from this person, ${turnCount} turn${turnCount === 1 ? '' : 's'} including replies sent.`,
    factors: [
      {
        label: 'grouped by',
        detail: 'the platform’s own conversation id where it gives one, otherwise this person on this platform (and post, for comments)',
      },
    ],
    evidence: [],
    alternatives: [],
  };
}
