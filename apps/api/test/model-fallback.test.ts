import { describe, expect, it, vi } from 'vitest';
import { openAIMessages } from '../src/openai-messages.js';
import { modelClient } from '../src/model-client.js';

/**
 * Seven jobs sat behind one Anthropic account, and when that account was
 * disabled all of them stopped — including asset ingest, which captions before
 * it embeds, so "upload a logo" failed too. This is the second vendor.
 *
 * The case that matters most: the key was present and the *organisation* was
 * disabled, returning `400 {"error":{"message":"This organization has been
 * disabled."}}`. A configuration-time vendor choice cannot see that, and a
 * status-based retry rule cannot distinguish it from a malformed request.
 */

/** A fetch that records what it was sent and replies with a canned body. */
function fakeFetch(body: unknown, ok = true, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as unknown as typeof fetch;
  return { impl, calls, sent: () => JSON.parse(String(calls.at(-1)!.init.body)) };
}

const toolReply = {
  choices: [
    {
      finish_reason: 'tool_calls',
      message: { tool_calls: [{ id: 'call_1', function: { name: 'record_copy', arguments: '{"text":"Two chairs free Friday."}' } }] },
    },
  ],
};

const shim = (f: ReturnType<typeof fakeFetch>) => openAIMessages({ apiKey: 'sk-test', fetchImpl: f.impl })!;

describe('the OpenAI shim speaks Anthropic', () => {
  it('returns a tool_use block, which is the only shape the five writers read', async () => {
    const f = fakeFetch(toolReply);
    const res = await shim(f).messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      system: 'You write copy.',
      messages: [{ role: 'user', content: 'Write a beat.' }],
      tools: [{ name: 'record_copy', description: 'Record it.', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'record_copy' },
    });

    expect(res.stop_reason).toBe('tool_use');
    expect(res.content[0]).toMatchObject({ type: 'tool_use', name: 'record_copy', input: { text: 'Two chairs free Friday.' } });
  });

  it('keeps the tool forced — unforced, "returned an unusable shape" becomes the normal case', async () => {
    const f = fakeFetch(toolReply);
    await shim(f).messages.create({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'record_copy', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'record_copy' },
    });
    expect(f.sent().tool_choice).toEqual({ type: 'function', function: { name: 'record_copy' } });
  });

  it('moves `system` into a system message rather than dropping it', async () => {
    const f = fakeFetch(toolReply);
    await shim(f).messages.create({ system: 'Ground every word in the brand.', messages: [{ role: 'user', content: 'x' }] });
    expect(f.sent().messages[0]).toEqual({ role: 'system', content: 'Ground every word in the brand.' });
  });

  it('returns a text block when no tool was requested — the captioner path', async () => {
    const f = fakeFetch({ choices: [{ finish_reason: 'stop', message: { content: 'A barber finishing a skin fade.' } }] });
    const res = await shim(f).messages.create({ messages: [{ role: 'user', content: 'Caption this.' }] });
    expect(res.content[0]).toEqual({ type: 'text', text: 'A barber finishing a skin fade.' });
    expect(res.stop_reason).toBe('end_turn');
  });

  it('translates a remote image block, so captioning still sends the URL not the bytes', async () => {
    const f = fakeFetch({ choices: [{ message: { content: 'ok' } }] });
    await shim(f).messages.create({
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://cdn/x.jpg' } }, { type: 'text', text: 'Caption.' }] }],
    });
    expect(f.sent().messages[0].content).toEqual([
      { type: 'image_url', image_url: { url: 'https://cdn/x.jpg' } },
      { type: 'text', text: 'Caption.' },
    ]);
  });

  it('translates an inline image into a data URI — the local-asset path', async () => {
    const f = fakeFetch({ choices: [{ message: { content: 'ok' } }] });
    await shim(f).messages.create({
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }],
    });
    expect(f.sent().messages[0].content[0].image_url.url).toBe('data:image/png;base64,AAAA');
  });

  it('substitutes by tier, so a cheap job stays cheap', async () => {
    const cheap = fakeFetch(toolReply);
    await shim(cheap).messages.create({ model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'x' }] });
    const dear = fakeFetch(toolReply);
    await shim(dear).messages.create({ model: 'claude-opus-5', messages: [{ role: 'user', content: 'x' }] });

    expect(cheap.sent().model).toBe('gpt-4o-mini');
    expect(dear.sent().model).toBe('gpt-4o');
  });

  it('refuses a feature it does not implement rather than serving a different result', async () => {
    const f = fakeFetch(toolReply);
    await expect(
      shim(f).messages.create({ messages: [{ role: 'user', content: 'x' }], stream: true }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('surfaces an HTTP failure as UPSTREAM_FAILED, not as an empty answer', async () => {
    const f = fakeFetch({ error: 'nope' }, false, 429);
    await expect(shim(f).messages.create({ model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      code: 'UPSTREAM_FAILED',
    });
  });

  it('is null with no key, so "no fallback" is a truthiness test', () => {
    expect(openAIMessages({ apiKey: '' })).toBeNull();
  });
});

describe('the fallback fires on failure, not on configuration', () => {
  const ok = { content: [{ type: 'text' as const, text: 'from fallback' }], stop_reason: 'end_turn' };

  it('retries on the disabled-organisation 400 — the case a status rule would miss', async () => {
    const primary = { messages: { create: vi.fn(async () => { throw new Error('400 {"error":{"message":"This organization has been disabled."}}'); }) } };
    const fallback = { messages: { create: vi.fn(async () => ok) } };
    const warn = vi.fn();

    const res = await modelClient({ primary, fallback, warn }).messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(res).toEqual(ok);
    expect(fallback.messages.create).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does not call the fallback when the primary works', async () => {
    const primaryOk = { content: [{ type: 'text' as const, text: 'from primary' }], stop_reason: 'end_turn' };
    const primary = { messages: { create: vi.fn(async () => primaryOk) } };
    const fallback = { messages: { create: vi.fn(async () => ok) } };

    const res = await modelClient({ primary, fallback, warn: () => {} }).messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(res).toEqual(primaryOk);
    expect(fallback.messages.create).not.toHaveBeenCalled();
  });

  it('says which vendor served the call, since tool_calls does not record it', async () => {
    const primary = { messages: { create: async () => { throw new Error('boom'); } } };
    const fallback = { messages: { create: async () => ok } };
    const warn = vi.fn();

    await modelClient({ primary, fallback, warn }).messages.create({ model: 'claude-opus-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] });

    expect(warn.mock.calls[0]![0]).toMatch(/retrying on the OpenAI fallback/);
    expect(warn.mock.calls[0]![1]).toMatchObject({ model: 'claude-opus-5' });
  });

  it('propagates the primary error untouched when there is no fallback to try', async () => {
    const primary = { messages: { create: async () => { throw new Error('the only vendor is down'); } } };
    await expect(
      modelClient({ primary, fallback: null }).messages.create({ model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow('the only vendor is down');
  });

  it('lets the fallback error through when both fail — the last attempt is the honest one', async () => {
    const primary = { messages: { create: async () => { throw new Error('primary down'); } } };
    const fallback = { messages: { create: async () => { throw new Error('fallback down too'); } } };
    await expect(
      modelClient({ primary, fallback, warn: () => {} }).messages.create({ model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow('fallback down too');
  });
});
