import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { createDubClient } from '../src/dub.js';

/**
 * The Dub client — one HTTP call for the simple stuff, plus a real quirk this
 * workspace's API forced on `shorten()`: `tagNames` 422s on the real API
 * unless every tag already exists (confirmed live, not assumed — see
 * `dub.ts`'s own comment), so `shorten()` now checks/creates each tag first.
 * What matters here: the request shapes (right fields, right place), the
 * tag-ensure flow (search, create, tolerate a 409 race) actually runs before
 * the link is created, and a bad response at any step fails loudly.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Routes a mock fetch by method + URL substring, closest to what the real
 * Dub API actually does per endpoint — a single fixed response (the old
 * pattern in this file) breaks the moment `shorten()` calls more than one
 * endpoint, which it now always does whenever tags are given.
 */
function dubFetch(routes: {
  searchTags?: (url: string) => Response;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each test narrows its own request-body shape
  createTag?: (body: any) => Response;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createLink?: (body: any) => Response;
  getLink?: (url: string) => Response;
}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.startsWith('https://api.dub.co/tags?search=')) {
      return routes.searchTags ? routes.searchTags(u) : json([]);
    }
    if (u === 'https://api.dub.co/tags' && method === 'POST') {
      return routes.createTag ? routes.createTag(JSON.parse(init!.body as string)) : json({ id: 'tag_1', name: 'x' }, 201);
    }
    if (u === 'https://api.dub.co/links' && method === 'POST') {
      return routes.createLink
        ? routes.createLink(JSON.parse(init!.body as string))
        : json({ id: 'link_1', shortLink: 'https://dub.sh/abc', url: 'https://example.com' });
    }
    if (u.startsWith('https://api.dub.co/links/')) {
      return routes.getLink ? routes.getLink(u) : json({ id: 'link_1', clicks: 0 });
    }
    throw new Error(`unhandled mock fetch: ${method} ${u}`);
  });
}

describe('the tag-existence gate (shorten)', () => {
  it('checks each tag via search before creating the link, and does not re-create an existing tag', async () => {
    const searchTags = vi.fn((url: string) =>
      url.includes('gen_1') ? json([{ id: 'tag_1', name: 'gen_1' }]) : json([]),
    );
    const createTag = vi.fn((body: { name: string }) => json({ id: 'tag_2', name: body.name }, 201));
    const f = dubFetch({ searchTags, createTag });
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await client.shorten({ url: 'https://example.com', tags: ['gen_1', 'launch'] });

    expect(searchTags).toHaveBeenCalledTimes(2);
    // Only the tag search didn't find ("launch") gets created — "gen_1" already existed.
    expect(createTag).toHaveBeenCalledTimes(1);
    expect(createTag).toHaveBeenCalledWith({ name: 'launch' });
  });

  it('treats Dub\'s search as substring, not exact — "gen_1" must not match an existing "gen_10"', async () => {
    const searchTags = vi.fn(() => json([{ id: 'tag_1', name: 'gen_10' }])); // substring match, wrong tag
    const createTag = vi.fn((body: { name: string }) => json({ id: 'tag_2', name: body.name }, 201));
    const f = dubFetch({ searchTags, createTag });
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await client.shorten({ url: 'https://example.com', tags: ['gen_1'] });

    // "gen_10" in the results must not satisfy "gen_1" — the client still creates it.
    expect(createTag).toHaveBeenCalledWith({ name: 'gen_1' });
  });

  it('tolerates a 409 on tag creation as a successful race, not an error', async () => {
    const searchTags = vi.fn(() => json([])); // not found yet
    const createTag = vi.fn(() => json({ error: { message: 'A tag with that name already exists.' } }, 409));
    const f = dubFetch({ searchTags, createTag });
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await expect(client.shorten({ url: 'https://example.com', tags: ['gen_1'] })).resolves.toBeDefined();
  });

  it('throws when tag creation fails for a reason other than a 409 race', async () => {
    const searchTags = vi.fn(() => json([]));
    const createTag = vi.fn(() => new Response('forbidden', { status: 403 }));
    const f = dubFetch({ searchTags, createTag });
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await expect(client.shorten({ url: 'https://example.com', tags: ['gen_1'] })).rejects.toThrow(ToolError);
  });

  it('skips the tag-ensure flow entirely when no tags are given', async () => {
    const searchTags = vi.fn(() => json([]));
    const f = dubFetch({ searchTags });
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await client.shorten({ url: 'https://example.com' });

    expect(searchTags).not.toHaveBeenCalled();
  });

  it('only calls POST /links with tagNames after every tag is confirmed to exist', async () => {
    const createLink = vi.fn((body: { tagNames?: string[] }) => {
      expect(body.tagNames).toEqual(['gen_1', 'launch']);
      return json({ id: 'link_1', shortLink: 'https://dub.sh/abc', url: 'https://example.com' });
    });
    const f = dubFetch({ createLink });
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await client.shorten({ url: 'https://example.com', tags: ['gen_1', 'launch'] });

    expect(createLink).toHaveBeenCalledTimes(1);
  });
});

describe('request shape', () => {
  it('posts the url, tags and UTM params', async () => {
    const createLink = vi.fn((body: unknown) => json({ id: 'link_1', shortLink: 'https://dub.sh/abc123', url: 'https://example.com/book' }));
    const f = dubFetch({ createLink });
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await client.shorten({
      url: 'https://example.com/book',
      tags: ['gen_1', 'launch'],
      utm: { source: 'sparksocial', medium: 'social', campaign: 'Emeka Cuts' },
    });

    const call = f.mock.calls.find(([url, init]) => String(url) === 'https://api.dub.co/links' && init?.method === 'POST')!;
    expect((call[1]!.headers as Record<string, string>).authorization).toBe('Bearer k');
    const body = JSON.parse(call[1]!.body as string);
    expect(body).toMatchObject({
      url: 'https://example.com/book',
      tagNames: ['gen_1', 'launch'],
      utm_source: 'sparksocial',
      utm_medium: 'social',
      utm_campaign: 'Emeka Cuts',
    });
  });

  it('includes a configured domain, omits it when unset', async () => {
    const f = dubFetch({});
    const withDomain = createDubClient({ apiKey: 'k', domain: 'links.example.com', fetchImpl: f as unknown as typeof fetch });
    await withDomain.shorten({ url: 'https://example.com' });
    const call = f.mock.calls.find(([url, init]) => String(url) === 'https://api.dub.co/links' && init?.method === 'POST')!;
    expect(JSON.parse(call[1]!.body as string).domain).toBe('links.example.com');

    const f2 = dubFetch({});
    const withoutDomain = createDubClient({ apiKey: 'k', fetchImpl: f2 as unknown as typeof fetch });
    await withoutDomain.shorten({ url: 'https://example.com' });
    const call2 = f2.mock.calls.find(([url, init]) => String(url) === 'https://api.dub.co/links' && init?.method === 'POST')!;
    expect(JSON.parse(call2[1]!.body as string)).not.toHaveProperty('domain');
  });
});

describe('response handling', () => {
  it('returns the link id, short link and destination', async () => {
    const f = dubFetch({ createLink: () => json({ id: 'link_1', shortLink: 'https://dub.sh/abc123', url: 'https://example.com/book' }) });
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    const out = await client.shorten({ url: 'https://example.com/book' });
    expect(out).toEqual({ linkId: 'link_1', shortUrl: 'https://dub.sh/abc123', destinationUrl: 'https://example.com/book' });
  });

  it('refuses a response with no shortLink rather than returning an unusable link', async () => {
    const f = dubFetch({ createLink: () => json({ id: 'link_1' }) });
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    await expect(client.shorten({ url: 'https://example.com' })).rejects.toThrow(ToolError);
  });

  it('refuses a response with no link id — getClicks would have nothing to query later', async () => {
    const f = dubFetch({ createLink: () => json({ shortLink: 'https://dub.sh/abc123', url: 'https://example.com/book' }) });
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    await expect(client.shorten({ url: 'https://example.com' })).rejects.toThrow(ToolError);
  });
});

describe('transport', () => {
  it('reports an upstream failure on a non-2xx response', async () => {
    const f = dubFetch({ createLink: () => new Response('rate limited', { status: 429 }) });
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    await expect(client.shorten({ url: 'https://example.com' })).rejects.toThrow(ToolError);
  });
});

describe('getClicks', () => {
  it('reads the click count off the link resource — Dub carries it on the link itself, no separate analytics call', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ id: 'link_1', clicks: 42 }));
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    const out = await client.getClicks('link_1');

    expect(out).toEqual({ clicks: 42 });
    expect(f.mock.calls[0]![0]).toBe('https://api.dub.co/links/link_1');
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('defaults to 0 clicks when the field is absent, rather than throwing', async () => {
    const f = vi.fn(async () => json({ id: 'link_1' }));
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    expect(await client.getClicks('link_1')).toEqual({ clicks: 0 });
  });

  it('URL-encodes the link id', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ clicks: 0 }));
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    await client.getClicks('link with space');
    expect(f.mock.calls[0]![0]).toBe('https://api.dub.co/links/link%20with%20space');
  });

  it('reports an upstream failure on a non-2xx response', async () => {
    const f = vi.fn(async () => new Response('not found', { status: 404 }));
    const client = createDubClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    await expect(client.getClicks('link_missing')).rejects.toThrow(ToolError);
  });
});
