import Anthropic from '@anthropic-ai/sdk';
import { ToolError } from '@sparksocial/shared';
import type { Genome } from '@sparksocial/shared/genome';
import type { ReplyWriter } from '@sparksocial/engage';
import { envSet } from './env.js';

/**
 * Production reply writer for `engage.reply.draft` — the sibling of
 * `text-writer.ts` (which drafts a *post* beat) and `engage-classifier.ts`
 * (which triages the inbox and, when safe, proposes the very reply this file
 * exists for the *other* case: nothing on file, or the caller wants a fresh
 * one).
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'record_reply';

const SYSTEM =
  'You write one reply to an inbound comment, DM, or story reply on a small or mid-size business\'s social ' +
  "account — the same job a community manager does when answering their inbox.\n\n" +
  'Ground every word in the brand actually given to you: their name, category, one-liner, and tone. Never ' +
  'invent a price, availability, or promise not present in what you were given — if the message asks for a ' +
  'specific fact you were not given, write a reply that invites them to ask or book rather than fabricating ' +
  "an answer. Match the brand's tone and never use a banned phrase. Keep it short — this is a reply, not a caption.";

const SCHEMA = {
  type: 'object' as const,
  properties: {
    text: { type: 'string', description: 'The reply, ready to send as-is.' },
  },
  required: ['text'],
};

export interface ReplyWriterOptions {
  anthropic?: Anthropic;
  model?: string;
}

export function createReplyWriter(opts: ReplyWriterOptions = {}): ReplyWriter {
  const anthropic = opts.anthropic ?? new Anthropic();
  const model = opts.model ?? MODEL;

  return {
    async write({ genome, kind, authorHandle, messageText }): Promise<string> {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 300,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt(genome, kind, authorHandle, messageText) }],
        tools: [
          {
            name: TOOL_NAME,
            description: 'Record the written reply.',
            input_schema: SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });

      const block = response.content.find(
        (c): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use' && c.name === TOOL_NAME,
      );
      if (!block) {
        throw new ToolError('UPSTREAM_FAILED', 'The reply writer returned no text.', {
          stopReason: response.stop_reason,
        });
      }

      const text = (block.input as Record<string, unknown>).text;
      if (typeof text !== 'string' || !text.trim()) {
        throw new ToolError('UPSTREAM_FAILED', 'The reply writer returned an unusable shape.', { kind });
      }

      return text.trim();
    },
  };
}

/** Same interpolation rule `text-writer.ts`/`engage-classifier.ts` give: our own confirmed record, not untrusted input. */
function prompt(genome: Genome, kind: string, authorHandle: string, messageText: string): string {
  const { identity, voice } = genome;
  return [
    `Business: ${identity.business_name} — ${identity.category}`,
    `What they do: ${identity.one_liner}`,
    voice.tone_vector
      ? `Tone (0-1 each): formal ${voice.tone_vector.formal}, playful ${voice.tone_vector.playful}, ` +
        `technical ${voice.tone_vector.technical}, bold ${voice.tone_vector.bold}`
      : '',
    voice.banned_phrases?.length ? `Never use: ${voice.banned_phrases.join(', ')}` : '',
    '',
    `Message type: ${kind}`,
    `From: ${authorHandle}`,
    `Message: ${messageText}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The real writer when a key is present, a deterministic template otherwise.
 * Same shape as `textWriter()`/`engageClassifier()`.
 */
export function replyWriter(fallback: ReplyWriter): ReplyWriter {
  if (!envSet('ANTHROPIC_API_KEY')) {
    console.warn(
      '[warn] ANTHROPIC_API_KEY unset — drafted replies come from fixed templates, not real judgment.',
    );
    return fallback;
  }
  return createReplyWriter();
}
