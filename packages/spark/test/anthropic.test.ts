import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { anthropicModelClient } from '../src/anthropic.js';
import type { ExposedTool } from '../src/loop.js';

/**
 * `anthropicModelClient` is the one place a real Anthropic API call gets
 * built and parsed — every other test in this package drives `runAgent`
 * through a scripted `ModelClient`, which never touches this file at all.
 * That gap is exactly how the dotted-tool-name bug (`human.ask` etc. sent
 * verbatim as a tool name — Anthropic's `name` pattern forbids `.`, so
 * *every* call with any tool exposed 400s) shipped and stayed invisible:
 * nothing here ever built a real request shape or parsed a real response
 * until a live chat message actually hit the real API.
 */

const tool: ExposedTool = {
  name: 'human.ask',
  description: 'Ask the human something.',
  inputSchema: { _def: { typeName: 'ZodObject', shape: () => ({}) } } as never,
};

type FakeAnthropic = { beta: { messages: { create: (params: unknown) => Promise<unknown> } } };

function fakeAnthropic(create: (params: unknown) => Promise<unknown>): FakeAnthropic {
  return { beta: { messages: { create } } };
}

describe('input_schema — a top-level .refine() must not produce an empty schema', () => {
  it('unwraps a ZodEffects (approval.policy.set\'s "at least one field" shape) to the real object schema', async () => {
    const refined = z
      .object({ restrictedPlatforms: z.array(z.string()).nullable().optional() })
      .refine((v) => v.restrictedPlatforms !== undefined, { message: 'at least one field' });
    const refinedTool: ExposedTool = { name: 'approval.policy.set', description: 'x', inputSchema: refined };

    const create = vi.fn(async (_params: unknown) => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const client = anthropicModelClient({ client: fakeAnthropic(create) as never });

    await client.turn({ agent: 'spark', system: 'x', messages: [], tools: [refinedTool] });

    const sentSchema = (create.mock.calls[0]![0] as { tools: Array<{ input_schema: Record<string, unknown> }> }).tools[0]!.input_schema;
    // The real bug: this came back `{}` — no `type` at all — which the real
    // API 400s on for *every* spark turn, not just ones touching this tool,
    // since the full toolset is sent on every call.
    expect(sentSchema.type).toBe('object');
    expect(sentSchema.properties).toBeDefined();
  });

  it('falls back to a valid { type: "object" }, not {}, for a genuinely unhandled shape', async () => {
    const weird = z.date(); // no case in zodToJsonSchema for this
    const weirdTool: ExposedTool = { name: 'x.y', description: 'x', inputSchema: weird };
    const create = vi.fn(async (_params: unknown) => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const client = anthropicModelClient({ client: fakeAnthropic(create) as never });

    await client.turn({ agent: 'spark', system: 'x', messages: [], tools: [weirdTool] });

    const sentSchema = (create.mock.calls[0]![0] as { tools: Array<{ input_schema: Record<string, unknown> }> }).tools[0]!.input_schema;
    expect(sentSchema).toEqual({ type: 'object' });
  });
});

describe('fallbacks — Opus-only', () => {
  it('sends betas/fallbacks for an opus-tier agent (spark)', async () => {
    const create = vi.fn(async (_params: unknown) => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const client = anthropicModelClient({ client: fakeAnthropic(create) as never });

    await client.turn({ agent: 'spark', system: 'x', messages: [], tools: [] });

    const sent = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent['fallbacks']).toBe('default');
    expect(sent['betas']).toEqual(['server-side-fallback-2026-07-01']);
  });

  it('omits betas/fallbacks for a sonnet-tier agent (analyst) — the real API 400s otherwise', async () => {
    const create = vi.fn(async (_params: unknown) => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const client = anthropicModelClient({ client: fakeAnthropic(create) as never });

    await client.turn({ agent: 'analyst', system: 'x', messages: [], tools: [] });

    const sent = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('fallbacks');
    expect(sent).not.toHaveProperty('betas');
  });
});

describe('tool name encoding — Anthropic forbids "." in tools[].name', () => {
  it('sends every dotted registry tool name re-encoded to match Anthropic\'s pattern', async () => {
    const create = vi.fn(async (_params: unknown) => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const client = anthropicModelClient({ client: fakeAnthropic(create) as never });

    await client.turn({ agent: 'spark', system: 'x', messages: [], tools: [tool] });

    const sent = (create.mock.calls[0]![0] as { tools: Array<{ name: string }> }).tools;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.name).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    expect(sent[0]!.name).not.toContain('.');
  });

  it('decodes a tool_use block\'s name back to the real dotted tool name', async () => {
    const create = vi.fn(async (_params: unknown) => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tc_1', name: 'human__ask', input: { question: 'what next?' } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const client = anthropicModelClient({ client: fakeAnthropic(create) as never });

    const turn = await client.turn({ agent: 'spark', system: 'x', messages: [], tools: [tool] });

    expect(turn.toolCalls).toEqual([{ id: 'tc_1', name: 'human.ask', input: { question: 'what next?' } }]);
  });

  it('round-trips a multi-segment family name (queue.review.list) without collision', async () => {
    const multiTool: ExposedTool = { ...tool, name: 'queue.review.list' };
    const create = vi.fn(async (_params: unknown) => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tc_2', name: 'queue__review__list', input: {} }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const client = anthropicModelClient({ client: fakeAnthropic(create) as never });

    const turn = await client.turn({ agent: 'spark', system: 'x', messages: [], tools: [multiTool] });

    const sentName = (create.mock.calls[0]![0] as { tools: Array<{ name: string }> }).tools[0]!.name;
    expect(sentName).toBe('queue__review__list');
    expect(turn.toolCalls[0]!.name).toBe('queue.review.list');
  });
});
