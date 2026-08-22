import { ToolError } from './types.js';

/**
 * OpenAI Chat Completions, wearing Anthropic's Messages shape.
 *
 * ── Why a shim and not a second code path ─────────────────────────────────
 *
 * Seven jobs sit behind one Anthropic account — the crawl interpreter, the copy
 * writer, the brief writer, the captioner, the reply writer, the engagement
 * classifier and the SPARK agent loop. When that account was disabled, all of
 * them stopped, and the failure cascaded into places that look unrelated:
 * uploading a logo failed, because ingest captions before it embeds.
 *
 * The alternative was teaching seven modules to speak two vendors. They send a
 * narrow enough subset — system text, plain messages, tool declarations, and a
 * choice about whether a tool is forced — to translate once here.
 *
 * ── Two callers with different needs ──────────────────────────────────────
 *
 * The five writers force a single tool and read one `tool_use` block back. The
 * agent loop declares *many* tools, lets the model choose, reads text and tool
 * calls together, and needs token usage. Both are served: `tool_choice` decides
 * which mode, and every tool is forwarded rather than only the first.
 *
 * It lives in `packages/shared` rather than `apps/api` because
 * `packages/spark`'s agent loop needs it too, and depends on nothing but
 * `fetch` — no vendor SDK, so putting it here costs the package nothing.
 */

/** The slice of Anthropic's client these callers touch. */
export interface MessagesClient {
  messages: {
    create(body: MessagesRequest): Promise<MessagesResponse>;
  };
}

export interface MessagesRequest {
  model?: string;
  max_tokens?: number;
  /** A plain string, or Anthropic's block array — the agent loop sends the latter. */
  system?: string | Array<{ type: string; text?: string }>;
  messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }>;
  tools?: Array<{ name: string; description?: string; input_schema: unknown }>;
  tool_choice?: { type: string; name?: string };
  [key: string]: unknown;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } | { type: 'base64'; media_type: string; data: string } };

export interface MessagesResponse {
  content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Model substitutions, by capability rather than by name.
 *
 * Callers ask for `claude-opus-5` or `claude-sonnet-5`, which say something
 * about how much thinking the job deserves. Mapping tiers keeps that judgement
 * where it was made — a caption is a cheap call and the crawl is an expensive
 * one, whichever vendor serves them.
 */
const MODEL_FOR_TIER: Record<'opus' | 'sonnet' | 'haiku', string> = {
  opus: 'gpt-4o',
  sonnet: 'gpt-4o',
  haiku: 'gpt-4o-mini',
};

/**
 * Anthropic-only parameters that are dropped rather than refused.
 *
 * Refusing them was the first design, on the principle that serving a quietly
 * different result is worse than failing. That is right for the writers and
 * wrong for the agent loop: `thinking`, `output_config.effort` and server-side
 * `fallbacks` have no OpenAI equivalent, and refusing them means SPARK is
 * simply down whenever the primary vendor is — which is the outage this shim
 * exists to survive. A degraded agent that says so beats no agent.
 *
 * `stream` stays refused: it changes the *contract*, not the quality, and a
 * caller expecting an async iterator would break rather than degrade.
 */
const DROPPABLE = ['betas', 'fallbacks', 'thinking', 'output_config'] as const;

function substituteModel(requested: string | undefined, override: string): string {
  if (override) return override;
  if (!requested) return MODEL_FOR_TIER.sonnet;
  if (requested.includes('opus')) return MODEL_FOR_TIER.opus;
  if (requested.includes('haiku')) return MODEL_FOR_TIER.haiku;
  return MODEL_FOR_TIER.sonnet;
}

/** Anthropic's system — string or block array — as one OpenAI system string. */
function systemText(system: MessagesRequest['system']): string | undefined {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  const joined = system
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n\n')
    .trim();
  return joined || undefined;
}

/** Anthropic content blocks → OpenAI's `content` parts. */
function translateContent(content: string | ContentBlock[]): unknown {
  if (typeof content === 'string') return content;

  return content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    // OpenAI takes a remote URL and an inline data: URI through the same
    // `image_url` part, which is why the two caption paths collapse to one here.
    const url =
      block.source.type === 'url' ? block.source.url : `data:${block.source.media_type};base64,${block.source.data}`;
    return { type: 'image_url', image_url: { url } };
  });
}

/**
 * OpenAI's `finish_reason` in Anthropic's vocabulary.
 *
 * `content_filter` maps to `refusal` because the agent loop already branches on
 * that and stops the run cleanly — losing the mapping would turn a refusal into
 * an empty, confusing turn.
 */
function stopReasonFor(finish: string | undefined, hasToolCalls: boolean): string {
  if (hasToolCalls) return 'tool_use';
  switch (finish) {
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

export interface OpenAIMessagesOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  warn?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * Builds the shim, or `null` when there is no key to build it with.
 *
 * `null` rather than a throwing stub, so a caller's "is a fallback available?"
 * check is a truthiness test and an unconfigured fallback is indistinguishable
 * from not having asked for one.
 */
export function openAIMessages(opts: OpenAIMessagesOptions = {}): MessagesClient | null {
  const apiKey = opts.apiKey ?? process.env.OPENAI_FALLBACK_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) return null;

  const baseUrl = opts.baseUrl ?? process.env.OPENAI_FALLBACK_BASE_URL ?? 'https://api.openai.com/v1';
  const modelOverride = opts.model ?? process.env.OPENAI_FALLBACK_MODEL ?? '';
  const doFetch = opts.fetchImpl ?? fetch;
  const warn = opts.warn ?? ((m, meta) => console.warn(m, meta));

  return {
    messages: {
      async create(body) {
        if (body.stream !== undefined) {
          throw new ToolError(
            'INVALID_INPUT',
            'The OpenAI fallback does not implement streaming. Failing rather than changing the contract ' +
              'a caller is written against.',
            { unsupported: 'stream' },
          );
        }

        const dropped = DROPPABLE.filter((k) => body[k] !== undefined);
        if (dropped.length > 0) {
          // Said out loud once per call: an agent turn served without adaptive
          // thinking or its effort tier is a *different* turn, and a quality
          // regression with no log line is the hardest kind to trace back.
          warn('[warn] OpenAI fallback dropped Anthropic-only parameters', { dropped, model: body.model });
        }

        const messages: unknown[] = [];
        const sys = systemText(body.system);
        if (sys) messages.push({ role: 'system', content: sys });
        for (const m of body.messages) messages.push({ role: m.role, content: translateContent(m.content) });

        const tools = body.tools ?? [];
        const forcedName =
          body.tool_choice?.type === 'tool' || body.tool_choice?.type === 'any' ? body.tool_choice.name : undefined;

        const response = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: substituteModel(body.model, modelOverride),
            messages,
            ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
            ...(tools.length > 0
              ? {
                  // Every tool, not just the first: the agent loop declares its
                  // whole exposed set and lets the model choose. Sending one
                  // would silently reduce the agent to a single capability.
                  tools: tools.map((t) => ({
                    type: 'function',
                    function: {
                      name: t.name,
                      ...(t.description ? { description: t.description } : {}),
                      parameters: t.input_schema,
                    },
                  })),
                  /**
                   * A forced Anthropic `tool_choice` is how the five writers
                   * guarantee a parseable answer instead of prose; dropping the
                   * force would make "returned an unusable shape" the normal
                   * case. The agent loop sends no `tool_choice`, and must be
                   * free to answer in text, so it gets `auto`.
                   */
                  tool_choice: forcedName ? { type: 'function', function: { name: forcedName } } : 'auto',
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
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          choices?: Array<{
            finish_reason?: string;
            message?: {
              content?: string | null;
              tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
            };
          }>;
        };

        const choice = json.choices?.[0];
        if (!choice?.message) {
          throw new ToolError('UPSTREAM_FAILED', 'OpenAI fallback returned no message.', {});
        }

        const content: MessagesResponse['content'] = [];

        // Text first, matching Anthropic's ordering, so a caller that joins text
        // blocks reads the model's prose before its tool calls.
        if (choice.message.content) content.push({ type: 'text', text: choice.message.content });

        for (const call of choice.message.tool_calls ?? []) {
          let input: unknown;
          try {
            input = JSON.parse(call.function.arguments);
          } catch {
            // The arguments string is the model's output, so a parse failure is
            // an upstream fault. The callers already handle "returned an
            // unusable shape" for exactly this.
            throw new ToolError('UPSTREAM_FAILED', 'OpenAI fallback returned unparseable tool arguments.', {
              tool: call.function.name,
              arguments: call.function.arguments.slice(0, 200),
            });
          }
          content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
        }

        return {
          content,
          stop_reason: stopReasonFor(choice.finish_reason, (choice.message.tool_calls ?? []).length > 0),
          usage: {
            input_tokens: json.usage?.prompt_tokens ?? 0,
            output_tokens: json.usage?.completion_tokens ?? 0,
          },
        };
      },
    },
  };
}
