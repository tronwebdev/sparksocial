import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The proxies' route to the API — `lib/apiUpstream.ts`.
 *
 * The private network is an optimisation, never a dependency. These pin the
 * three ways that has to hold: no private address means the public URL as
 * before; a refused private connection falls back and does not keep trying;
 * and a request that may have reached the API is never sent a second time.
 */

const PUBLIC = 'https://api.example.test';
const PRIVATE = 'sparksocial-api:10000';

async function load(privateHostport: string) {
  vi.resetModules();
  vi.stubEnv('SPARK_API_URL', PUBLIC);
  vi.stubEnv('SPARK_API_PRIVATE_HOSTPORT', privateHostport);
  return import('@/lib/apiUpstream');
}

const init = { method: 'POST', body: '{}' };
const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('fetchApi', () => {
  it('uses the public URL when no private address is set', async () => {
    const { fetchApi } = await load('');
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const { via } = await fetchApi('/v1/tools/x', init);
    expect(via).toBe('public');
    expect(fetchMock).toHaveBeenCalledWith(`${PUBLIC}/v1/tools/x`, init);
  });

  it('goes private when it can', async () => {
    const { fetchApi } = await load(PRIVATE);
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const { via } = await fetchApi('/v1/tools/x', init);
    expect(via).toBe('private');
    expect(fetchMock).toHaveBeenCalledWith(`http://${PRIVATE}/v1/tools/x`, init);
  });

  it('falls back on a refused connection, and rests the private route', async () => {
    const { fetchApi } = await load(PRIVATE);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('http://')) throw refused();
      return new Response('{}');
    });
    vi.stubGlobal('fetch', fetchMock);

    expect((await fetchApi('/v1/tools/x', init)).via).toBe('public');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The next call skips the private attempt rather than paying for it again.
    expect((await fetchApi('/v1/tools/x', init)).via).toBe('public');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not resend a request that may have arrived', async () => {
    const { fetchApi } = await load(PRIVATE);
    const fetchMock = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchApi('/v1/tools/x', init)).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
