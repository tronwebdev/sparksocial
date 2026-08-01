import Anthropic from '@anthropic-ai/sdk';
import type { ZodTypeAny } from 'zod';
import { AGENTS, MODELS } from './agents.js';
import type { ExposedTool, ModelClient, ModelTurn } from './loop.js';

/**
 * The real {@link ModelClient}, backed by `@anthropic-ai/sdk`.
 *
 * Deliberately **not** the Tool Runner. The runner executes tool functions for
 * you, which is exactly wrong here: every SparkSocial tool call must go through
 * `invokeTool` so the policy engine can *gate* it before it runs, and a gated
 * call has to come back to the model as "a human must approve this", not as a
 * result. The runner's per-turn hooks could be bent into that shape, but the
 * loop in `loop.ts` already owns scope, containment, and step recording — so it
 * asks for one turn at a time and does its own dispatch.
 *
 * API details that are easy to get wrong on Opus 5 and are pinned here:
 *  - `thinking: {type: 'adaptive'}` — `budget_tokens` is removed and 400s.
 *  - No `temperature` / `top_p` / `top_k` — all removed, all 400.
 *  - `effort` lives inside `output_config`, not at the top level.
 *  - `fallbacks: 'default'` — Opus 5's classifiers can decline a request, and
 *    the default policy routes a refusal to a fallback model by category rather
 *    than making us pin (and later migrate) a model name.
 */

export interface AnthropicModelClientOptions {
  client?: Anthropic;
  /** Bounded so a runaway turn cannot consume the whole budget. */
  maxTokens?: number;
}

export function anthropicModelClient(opts: AnthropicModelClientOptions = {}): ModelClient {
  // Zero-arg construction resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an
  // `ant auth login` profile — never hardcode a key, and never read one from the repo.
  const client = opts.client ?? new Anthropic();
  const maxTokens = opts.maxTokens ?? 16_000;

  return {
    async turn({ agent, system, messages, tools }): Promise<ModelTurn> {
      const def = AGENTS[agent];

      // The installed SDK (0.70.1) predates three parameters this call needs:
      // adaptive thinking, `output_config.effort`, and `fallbacks`. Its typings
      // still describe `thinking.type` as 'enabled' | 'disabled'. The SDK
      // forwards unknown keys unchanged, so the documented workaround is to
      // build the params object loosely and cast once, here, at the boundary —
      // rather than dropping the parameters (which would silently give us a
      // no-thinking, no-fallback agent) or pinning an older API shape that 400s
      // on Opus 5. Remove the cast once the SDK typings catch up.
      const params = {
        model: MODELS[def.model],
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: def.effort },
        system: [
          // The system prompt is stable per agent, so caching it here means every
          // turn after the first reads it at ~0.1x instead of re-paying for it.
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
        tools: tools.map(toAnthropicTool),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      };

      const response = await client.beta.messages.create(
        params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
      );

      if (response.stop_reason === 'refusal') {
        return { toolCalls: [], refused: true, text: '' };
      }

      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const toolCalls = response.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));

      return {
        toolCalls,
        text,
        usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
      };
    },
  };
}

/**
 * Registry tools carry Zod schemas; the API wants JSON Schema. Converted at this
 * boundary so `defineTool` stays the single source of type truth and no tool
 * author ever hand-maintains a second schema that can drift from the first.
 */
function toAnthropicTool(tool: ExposedTool): Anthropic.Beta.BetaToolUnion {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: zodToJsonSchema(tool.inputSchema as ZodTypeAny),
  } as Anthropic.Beta.BetaToolUnion;
}

/**
 * Minimal Zod → JSON Schema conversion covering the shapes `defineTool` actually
 * uses. `zod-to-json-schema` would be the dependency to reach for if the tool
 * schemas grow past this; until they do, a 40-line function beats a transitive
 * dependency in the agent's hot path.
 */
function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const typeName = def?.['typeName'] as string | undefined;

  switch (typeName) {
    case 'ZodObject': {
      const shape = (def['shape'] as () => Record<string, ZodTypeAny>)();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (!isOptional(value)) required.push(key);
      }
      return { type: 'object', properties, ...(required.length ? { required } : {}) };
    }
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return { type: 'string', enum: def['values'] as string[] };
    case 'ZodArray':
      return { type: 'array', items: zodToJsonSchema(def['type'] as ZodTypeAny) };
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodNullable':
      return zodToJsonSchema(def['innerType'] as ZodTypeAny);
    case 'ZodRecord':
      return { type: 'object', additionalProperties: true };
    case 'ZodUnion':
      return { anyOf: (def['options'] as ZodTypeAny[]).map(zodToJsonSchema) };
    default:
      // Unknown shapes become permissive rather than throwing — a tool the model
      // can call with a loose schema is strictly better than a tool it cannot
      // see at all, and `invokeTool` validates the input properly regardless.
      return {};
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  const typeName = (schema as unknown as { _def: { typeName?: string } })._def?.typeName;
  return typeName === 'ZodOptional' || typeName === 'ZodDefault';
}
