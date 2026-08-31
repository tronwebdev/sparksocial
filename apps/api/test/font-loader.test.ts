import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrandFontFace } from '@sparksocial/shared';
import { loadBrandFonts } from '../src/font-loader.js';

/**
 * M4's font fetch — the part that turns a chosen face into bytes Satori can draw
 * with.
 *
 * The chain itself was verified against the real service once (all six faces in
 * `BRAND_FONTS` fetch as TTF and render in Satori). What is worth pinning here is
 * the behaviour under failure, because a font is the one input on the render path
 * whose absence must never fail the render — and the two request details that are
 * load-bearing rather than incidental: the TTF user agent, and asking for a single
 * static weight.
 */

const INTER: BrandFontFace = {
  id: 'inter',
  label: 'Inter',
  note: 'test',
  family: 'Inter',
  weight: 600,
  role: 'both',
};

const LORA: BrandFontFace = { ...INTER, id: 'lora', label: 'Lora', family: 'Lora', weight: 500 };

const CSS = `@font-face{font-family:'Inter';src:url(https://fonts.gstatic.com/s/inter/v1/abc.ttf) format('truetype');}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Every case uses a family the other cases do not, because the loader caches
 * successful fetches for the life of the process and a shared family would make
 * the second test see the first test's answer.
 */
function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(handler);
  vi.stubGlobal('fetch', spy);
  return spy;
}

const cssFor = (family: string) =>
  new Response(CSS.replace("'Inter'", `'${family}'`), { status: 200 });

describe('loadBrandFonts', () => {
  it('reads the file URL out of the stylesheet rather than guessing it', async () => {
    const calls: string[] = [];
    const fetchSpy = stub((url) => {
      calls.push(String(url));
      return String(url).endsWith('.ttf')
        ? new Response(new Uint8Array([1, 2, 3]), { status: 200 })
        : cssFor('Space Grotesk');
    });

    const out = await loadBrandFonts([{ ...INTER, id: 'space_grotesk', family: 'Space Grotesk' }]);

    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('Space Grotesk');
    expect(out[0]!.data).toHaveLength(3);
    // Two round trips: the stylesheet, then the file it names. Pinning the
    // gstatic path instead would work today and silently fall back the next time
    // Google reissues the family.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('css2?family=Space+Grotesk:wght@600');
    expect(calls[1]).toBe('https://fonts.gstatic.com/s/inter/v1/abc.ttf');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('asks with a user agent that is not offered woff2', async () => {
    // Not a superstition: the CSS2 endpoint answers a modern UA with woff2, and
    // Satori's parser cannot read it. Without this header every face fails.
    let ua: string | undefined;
    stub((url, init) => {
      const headers = new Headers(init?.headers);
      if (!String(url).endsWith('.ttf')) ua = headers.get('User-Agent') ?? undefined;
      return String(url).endsWith('.ttf')
        ? new Response(new Uint8Array([1]), { status: 200 })
        : cssFor('Oswald');
    });

    await loadBrandFonts([{ ...INTER, id: 'oswald', family: 'Oswald' }]);
    expect(ua).toBeDefined();
    // Old enough to predate woff2 support.
    expect(ua).toMatch(/Chrome\/2\d /);
  });

  it('asks for one static weight, never a range', async () => {
    // A variable font is what Satori choked on. One cut per family is the
    // difference between a face that renders and one that throws.
    const calls: string[] = [];
    stub((url) => {
      calls.push(String(url));
      return String(url).endsWith('.ttf') ? new Response(new Uint8Array([1]), { status: 200 }) : cssFor('Lora');
    });

    await loadBrandFonts([LORA]);
    expect(calls[0]).toContain('wght@500');
    expect(calls[0]).not.toContain('..');
  });

  it('returns nothing rather than throwing when the stylesheet is unavailable', async () => {
    stub(() => new Response('nope', { status: 503 }));
    await expect(loadBrandFonts([{ ...INTER, id: 'playfair', family: 'Playfair Display' }])).resolves.toEqual([]);
  });

  it('returns nothing rather than throwing when the fetch itself fails', async () => {
    stub(() => {
      throw new Error('DNS is having a day');
    });
    await expect(loadBrandFonts([{ ...INTER, id: 'dm_sans', family: 'DM Sans' }])).resolves.toEqual([]);
  });

  it('drops one unavailable face and keeps the other', async () => {
    // Both faces are independent: a brand whose body font fails should still get
    // its headline in the face it chose.
    stub((url) => {
      const s = String(url);
      if (s.includes('Karla')) return new Response('nope', { status: 404 });
      return s.endsWith('.ttf') ? new Response(new Uint8Array([9]), { status: 200 }) : cssFor('Rubik');
    });

    const out = await loadBrandFonts([
      { ...INTER, id: 'inter', family: 'Rubik' },
      { ...INTER, id: 'lora', family: 'Karla' },
    ]);
    expect(out.map((f) => f.name)).toEqual(['Rubik']);
  });

  it('returns nothing when the stylesheet names no file it recognises', async () => {
    // A response that is 200 and useless is a different failure from a 503, and
    // the same fallback is the right answer to both.
    stub(() => new Response('@font-face{font-family:"Nope";}', { status: 200 }));
    await expect(loadBrandFonts([{ ...INTER, id: 'inter', family: 'Cabin' }])).resolves.toEqual([]);
  });

  it('makes one request per family however many renders ask at once', async () => {
    const fetchSpy = stub((url) =>
      String(url).endsWith('.ttf') ? new Response(new Uint8Array([1]), { status: 200 }) : cssFor('Manrope'),
    );

    const face = { ...INTER, id: 'inter' as const, family: 'Manrope' };
    // Ten concurrent renders of the same brand. The cache holds the promise, not
    // the result, so they share one in-flight request.
    await Promise.all(Array.from({ length: 10 }, () => loadBrandFonts([face])));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('is empty for an empty face list, without touching the network', async () => {
    const fetchSpy = stub(() => new Response('', { status: 200 }));
    await expect(loadBrandFonts([])).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
