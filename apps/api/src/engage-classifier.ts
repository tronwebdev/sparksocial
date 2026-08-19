import Anthropic from '@anthropic-ai/sdk';
import { ToolError } from '@sparksocial/shared';
import type { Genome } from '@sparksocial/shared/genome';
import { EngagementCategory, type EngagementClassifier, type ClassificationResult } from '@sparksocial/engage';
import { envSet } from './env.js';

/**
 * Production classifier for `engage.classify` — the sibling of
 * `text-writer.ts`: one Claude call, forced tool use, grounded in the brand's
 * own voice/tone so a suggested reply (when the model offers one) actually
 * sounds like the brand rather than a generic support macro.
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'record_classification';

const SYSTEM =
  'You triage one inbound social message (a comment, DM, or story reply) for a small or mid-size business, ' +
  'the same job a community manager does first thing in the morning.\n\n' +
  'Sort it into exactly one category:\n' +
  '- needs_review: anything ambiguous, negative, a complaint, or where a wrong reply carries real risk\n' +
  '- suggested_reply: a normal question or comment a brand-voiced reply can safely answer, but a human should approve it\n' +
  '- auto_handled: pure positive engagement (thanks, praise, simple acknowledgement) safe to answer with no review\n' +
  '- sales_opportunity: explicit or strong buying intent — pricing questions, "how do I book/order", interest in the offer\n\n' +
  "When you can safely propose a reply (suggested_reply or auto_handled), write one in the brand's own voice — " +
  'short, on-brand, never inventing a claim, price, or promise not given to you. Leave it out otherwise.';

const SCHEMA = {
  type: 'object' as const,
  properties: {
    category: { type: 'string', enum: EngagementCategory.options, description: 'Exactly one of the four categories.' },
    intent_score: { type: 'number', description: 'Confidence in this classification, 0 to 1.' },
    suggested_reply: { type: 'string', description: 'A brand-voiced reply, only when safe to propose one.' },
    reason: { type: 'string', description: 'One sentence a user reads to understand why this classification.' },
  },
  required: ['category', 'intent_score', 'reason'],
};

export interface EngageClassifierOptions {
  anthropic?: Anthropic;
  model?: string;
}

export function createEngageClassifier(opts: EngageClassifierOptions = {}): EngagementClassifier {
  const anthropic = opts.anthropic ?? new Anthropic();
  const model = opts.model ?? MODEL;

  return {
    async classify({ genome, kind, authorHandle, text }): Promise<ClassificationResult> {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt(genome, kind, authorHandle, text) }],
        tools: [
          {
            name: TOOL_NAME,
            description: 'Record the classification.',
            input_schema: SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });

      const block = response.content.find(
        (c): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use' && c.name === TOOL_NAME,
      );
      if (!block) {
        throw new ToolError('UPSTREAM_FAILED', 'The engagement classifier returned no classification.', {
          stopReason: response.stop_reason,
        });
      }

      const raw = block.input as Record<string, unknown>;
      const category = EngagementCategory.safeParse(raw.category);
      if (!category.success || typeof raw.intent_score !== 'number' || typeof raw.reason !== 'string') {
        throw new ToolError('UPSTREAM_FAILED', 'The engagement classifier returned an unusable shape.', { raw });
      }

      return {
        category: category.data,
        intentScore: Math.max(0, Math.min(1, raw.intent_score)),
        ...(typeof raw.suggested_reply === 'string' && raw.suggested_reply.trim() ? { suggestedReply: raw.suggested_reply.trim() } : {}),
        reason: raw.reason,
      };
    },
  };
}

/** Same interpolation rule `text-writer.ts`/`brief-writer.ts` give: this is our own confirmed record, not untrusted input. */
function prompt(genome: Genome, kind: string, authorHandle: string, text: string): string {
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
    `Message: ${text}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The real classifier when a key is present, a deterministic heuristic
 * otherwise. Same shape as `textWriter()`: usable, not smart — a fixed set of
 * keyword rules rather than a broken tool, so local dev exercises the whole
 * ingest → classify → feed path without an API key.
 */
export function engageClassifier(fallback: EngagementClassifier): EngagementClassifier {
  if (!envSet('ANTHROPIC_API_KEY')) {
    console.warn(
      '[warn] ANTHROPIC_API_KEY unset — engagement classification uses fixed keyword rules, not real judgment.',
    );
    return fallback;
  }
  return createEngageClassifier();
}
