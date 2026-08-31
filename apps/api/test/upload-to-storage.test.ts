import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadToStorage } from '../../web/src/lib/uploadToStorage.js';

/**
 * The message a person gets when a direct browser upload fails.
 *
 * ── What was on screen ────────────────────────────────────────────────────
 *
 * The staging storage account had no CORS rule for the web app's origin, so the
 * preflight was refused and the PUT never left the browser. Five call sites each
 * surfaced `e.message`, and for a blocked `fetch` that string is
 * **"Failed to fetch"** — three words beside "Choose Files", naming neither the
 * cause nor anything to do about it, on a screen where the obvious inference
 * ("my file is wrong") is the one wrong conclusion.
 *
 * So these assert the split rather than the prose: the person is told the file is
 * fine, and the operator's actual cause goes to the console. Getting one right and
 * the other wrong is the likely regression — a message that says nothing *and* a
 * log that says nothing is worse than what it replaced.
 *
 * Lives under `apps/api` for the reason `selected-genome.test.ts` gives: this is
 * pure logic on the web side, `apps/web` has no test directory by the decision in
 * `vitest.config.ts`, and `npm run build:web` cannot check what it *decides*.
 */

const URL_WITH_SAS = 'https://sparksocialstagingst.blob.core.windows.net/assets/org_1/a.png?sv=2024&sig=abc';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A `fetch` that throws the way a blocked cross-origin request does. */
function blockedFetch() {
  return vi.fn(async () => {
    throw new TypeError('Failed to fetch');
  });
}

function respondingFetch(status: number, statusText = '') {
  return vi.fn(async () => new Response(null, { status, statusText }));
}

describe('uploadToStorage — the request never completed', () => {
  it('does not put "Failed to fetch" in front of the user', async () => {
    // The whole point of the module.
    vi.stubGlobal('fetch', blockedFetch());
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await uploadToStorage(URL_WITH_SAS, new Blob(['x']), 'image/png');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).not.toMatch(/failed to fetch/i);
  });

  it('tells the user their file is not the problem', async () => {
    /**
     * The actionable half. Without it the next thing tried is a different file,
     * which fails identically — and a second failure reads as confirmation that
     * the file was the issue.
     */
    vi.stubGlobal('fetch', blockedFetch());
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await uploadToStorage(URL_WITH_SAS, new Blob(['x']), 'image/png');
    expect(res.ok === false && res.message).toMatch(/nothing is wrong with the file/i);
  });

  it('says nothing to the user about CORS, Azure, or storage accounts', async () => {
    vi.stubGlobal('fetch', blockedFetch());
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await uploadToStorage(URL_WITH_SAS, new Blob(['x']), 'image/png');
    expect(res.ok === false && res.message).not.toMatch(/cors|azure|blob|sas|origin|preflight/i);
  });

  it('logs the cause an operator needs, with the host and the fix', async () => {
    // The other half. Discarding it would trade an unreadable screen for an
    // undiagnosable one.
    vi.stubGlobal('fetch', blockedFetch());
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await uploadToStorage(URL_WITH_SAS, new Blob(['x']), 'image/png');

    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('sparksocialstagingst.blob.core.windows.net');
    expect(logged).toMatch(/CORS/);
    expect(logged).toMatch(/bootstrap\.sh/);
  });

  it('reports the kind, so a caller could branch without parsing prose', async () => {
    vi.stubGlobal('fetch', blockedFetch());
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await uploadToStorage(URL_WITH_SAS, new Blob(['x']), 'image/png');
    expect(res.ok === false && res.kind).toBe('network');
  });

  it('survives a malformed upload URL', async () => {
    // A bad URL is the API's problem; throwing here would replace a useful error
    // with a crash in the handler that was about to report it.
    vi.stubGlobal('fetch', blockedFetch());
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await uploadToStorage('not-a-url', new Blob(['x']), 'image/png');
    expect(res.ok).toBe(false);
  });
});

describe('uploadToStorage — storage answered', () => {
  it('succeeds on a 201', async () => {
    vi.stubGlobal('fetch', respondingFetch(201));
    expect(await uploadToStorage(URL_WITH_SAS, new Blob(['x']), 'image/png')).toEqual({ ok: true });
  });

  it('reads 403 as an expired link, not as a permission problem for the user', async () => {
    /**
     * A status means CORS passed and the account is reachable, which changes what
     * 403 can be: the SAS is minutes-long and single-purpose, so the likely cause
     * is that a large file outlived its own upload URL. "Try again" is genuinely
     * the fix, and a fresh link really is issued each time.
     */
    vi.stubGlobal('fetch', respondingFetch(403, 'Server failed to authenticate'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await uploadToStorage(URL_WITH_SAS, new Blob(['x']), 'image/png');
    expect(res.ok === false && res.message).toMatch(/expired/i);
    expect(res.ok === false && res.status).toBe(403);
  });

  it('reads 404 as our setup problem and says so', async () => {
    // A missing container is not something the person uploading can act on, and
    // implying otherwise sends them back to the file picker.
    vi.stubGlobal('fetch', respondingFetch(404));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await uploadToStorage(URL_WITH_SAS, new Blob(['x']), 'image/png');
    expect(res.ok === false && res.message).toMatch(/on our side/i);
  });

  it('names the status for anything else, and still absolves the file', async () => {
    vi.stubGlobal('fetch', respondingFetch(400, 'Bad Request'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await uploadToStorage(URL_WITH_SAS, new Blob(['x']), 'image/png');
    expect(res.ok === false && res.message).toContain('400');
    expect(res.ok === false && res.message).toMatch(/nothing is wrong with the file/i);
    expect(res.ok === false && res.kind).toBe('refused');
  });

  it('sends the header Azure requires on a SAS PUT', async () => {
    // Omitting `x-ms-blob-type` 400s, so it is not a detail — and it is the one
    // header that also has to be on the account's CORS allow-list.
    const f = respondingFetch(201);
    vi.stubGlobal('fetch', f);

    await uploadToStorage(URL_WITH_SAS, new Blob(['x']), 'image/png');

    const init = (f.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['x-ms-blob-type']).toBe('BlockBlob');
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/png');
  });
});
