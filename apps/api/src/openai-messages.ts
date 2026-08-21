import { ToolError } from '@sparksocial/shared';
import { envStr, envSet } from './env.js';

/**
 * OpenAI Chat Completions, wearing Anthropic's Messages shape.
 *
 * ── Why a shim and not a second code path ─────────────────────────────────
 *
 * Seven jobs sit behind one Anthropic account — the crawl interpreter, the copy
 * writer, the brief writer, the captioner, the reply writer, the engagement
 * classifier and the agent loop. When that account went down, all of them did,
 * and the failure cascaded into places that look unrelated: uploading a logo
 * failed, because ingest captions before it embeds, and the gap engine's advice
 * ("upload a brand kit, it unlocks the most") became un-actionable.
 *
 * The alternative to this file was teaching six modules to speak two vendors.
 * Every one of them sends the same four things — `system`, `messages`, a single
 * forced `tool`, `max_tokens` — and reads back one `tool_use` block or the text
 * blocks. That is a narrow enough contract to translate once, so the clients
 * stay single-vendor in their own code and gain a fallback for free.
 *
 * ── What is deliberately not supported ────────────────────────────────────
 *
 * Only the subset those six actually use. Streaming, multi-turn tool loops,
 * prompt caching (`cache_control`), extended thinking and `output_config` are
 * absent, and anything passing them gets an explicit error rather than a
 * silently different result. That is also why the SPARK agent loop
 * (`packages/spark/src/anthropic.ts`) does not use this: it needs the beta
 * Messages API's tool-use loop and cache control, and pretending otherwise
 * would degrade the agent invisibly.
 */

/** The slice of Anthropic's client these six modules touch. */
export interface MessagesClient {
  messages: {
    create(body: MessagesRequest): Promise<MessagesResponse>;
  };
}

interface MessagesRequest {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }>;
  tools?: Array<{ name: string; description?: string; input_schema: unknown }>;
  tool_choice?: { type: string; name?: string };
  [key: string]: unknown;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } | { type: 'base64'; media_type: string; data: string } };

interface MessagesResponse {
  content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }>;
  stop_reason: string;
}

/**
 * Model substitutions, by capability rather than by name.
 *
 * The callers ask for `claude-sonnet-5` or `claude-opus-5`, which say something
 * about how much thinking the job deserves. Mapping tiers rather than rewriting
 * every caller keeps that judgement where it was made — a caption is a cheap
 * call and the crawl is an expensive one, whichever vendor serves them.
 */
const MODEL_FOR_TIER: Record<'opus' | 'sonnet' | 'haiku', string> = {
  opus: 'gpt-4o',
  sonnet: 'gpt-4o',
  haiku: 'gpt-4o-mini',
};

function substituteModel(requested: string | undefined): string {
  const override = envSet('OPENAI_FALLBACK_MODEL') ? envStr('OPENAI_FALLBACK_MODEL', '') : '';
  if (override) return override;
  if (!requested) return MODEL_FOR_TIER.sonnet;
  if (requested.includes('opus')) return MODEL_FOR_TIER.opus;
  if (requested.includes('haiku')) return MODEL_FOR_TIER.haiku;
  return MODEL_FOR_TIER.sonnet;
}

/** Anthropic content blocks → OpenAI's `content` parts. */
function translateContent(content: string | ContentBlock[]): unknown {
  if (typeof content === 'string') return content;

  return content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text };

    // OpenAI takes both a remote URL and an inline data: URI through the same
    // `image_url` part, which is why the two caption paths collapse to one here.
    const url =
      block.source.type === 'url'
        ? block.source.url
        : `data:${block.source.media_type};base64,${block.source.data}`;
    return { type: 'image_url', image_url: { url } };
  });
}

export interface OpenAIMessagesOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Builds the shim, or `null` when there is no key to build it with.
 *
 * `null` rather than a throwing stub, so the caller's own "is a fallback
 * available?" check is a truthiness test and an unconfigured fallback is
 * indistinguishable from not having asked for one.
 */
export function openAIMessages(opts: OpenAIMessagesOptions = {}): MessagesClient | null {
  const apiKey = opts.apiKey ?? envStr('OPENAI_FALLBACK_API_KEY', envStr('OPENAI_API_KEY', ''));
  if (!apiKey) return null;

  const baseUrl = opts.baseUrl ?? envStr('OPENAI_FALLBACK_BASE_URL', 'https://api.openai.com/v1');
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    messages: {
      async create(body) {
        for (const unsupported of ['stream', 'cache_control', 'output_config', 'thinking'] as const) {
          if (body[unsupported] !== undefined) {
            throw new ToolError(
              'INVALID_INPUT',
              `The OpenAI fallback does not implement "${unsupported}". Failing rather than serving a ` +
                'quietly different result.',
              { unsupported },
            );
          }
        }

        const messages: unknown[] = [];
        if (body.system) messages.push({ role: 'system', content: body.system });
        for (const m of body.messages) messages.push({ role: m.role, content: translateContent(m.content) });

        const tool = body.tools?.[0];
        const forced = body.tool_choice?.type === 'tool' || body.tool_choice?.type === 'any';

        const response = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: substituteModel(body.model),
            messages,
            ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
            ...(tool
              ? {
                  tools: [
                    {
                      type: 'function',
                      function: {
                        name: tool.name,
                        ...(tool.description ? { description: tool.description } : {}),
                        parameters: tool.input_schema,
                      },
                    },
                  ],
                  // A forced Anthropic `tool_choice` is how every one of these
                  // callers guarantees a parseable answer instead of prose.
                  // Dropping the force would turn "the writer returned an
                  // unusable shape" into the normal case.
                  tool_choice: forced ? { type: 'function', function: { name: tool.name } } : 'auto',
                }
              : {}),
          }),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new ToolError('UPSTREAM_FAILED', `OpenAI fallback returned ${response.status}.`, {
            status: response.status,
            detail: detail.slice(0, 400),
          });
        }

        const json = (await response.json()) as {
          choices?: Array<{
            finish_reason?: string;
            message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
          }>;
        };

        const choice = json.choices?.[0];
        if (!choice?.message) {
          throw new ToolError('UPSTREAM_FAILED', 'OpenAI fallback returned no message.', {});
        }

        const call = choice.message.tool_calls?.[0];
        if (call) {
          let input: unknown;
          try {
            input = JSON.parse(call.function.arguments);
          } catch {
            // The arguments string is the model's output, so a parse failure is
            // an upstream fault rather than a bug here — and the callers already
            // handle "returned an unusable shape" for exactly this case.
            throw new ToolError('UPSTREAM_FAILED', 'OpenAI fallback returned unparseable tool arguments.', {
              arguments: call.function.arguments.slice(0, 200),
            });
          }
          return {
            content: [{ type: 'tool_use', id: call.id, name: call.function.name, input }],
            stop_reason: 'tool_use',
          };
        }

        return {
          content: [{ type: 'text', text: choice.message.content ?? '' }],
          stop_reason: choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
        };
      },
    },
  };
}
