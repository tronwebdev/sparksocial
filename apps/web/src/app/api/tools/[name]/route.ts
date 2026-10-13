import { auth } from '@clerk/nextjs/server';
import { forwardableGenomeId } from '@/lib/selectedGenome';

/**
 * THE ONLY ROUTE HANDLER IN THIS APP.
 *
 * It is a transport proxy, not a capability. It attaches the Clerk token, passes
 * `[name]` straight through, and streams the API's response back untouched — so a
 * new tool needs zero changes here, and no capability logic can accumulate in the
 * web tier (CLAUDE.md invariant 1: every capability is a tool, reached through
 * `invokeTool`). A second handler under `src/app/api/` means someone is building
 * a capability outside the registry.
 *
 * Two deliberate non-behaviours:
 *
 * 1. **It does not validate the genome.** The `spark_genome` cookie is forwarded
 *    as an untrusted claim and the API is the gate (`apps/api/src/clerk-auth.ts`
 *    checks it against the verified org). Validating here too would create a
 *    second place that could drift, and would do nothing for a caller who skips
 *    this proxy and hits the API directly.
 *
 *    It does now drop a claim recorded against a *different* org, which is a
 *    different thing and worth the distinction. The cookie outlives sign-out, so
 *    a second person signing in on the same browser was sending the first
 *    person's genome id on every request and being refused for it — correctly,
 *    and fatally: onboarding could not complete. The proxy declines to forward a
 *    claim it can see belongs to another session rather than asking the API a
 *    question whose answer must be no. `clerk-auth.ts` is still the only gate;
 *    removing this comparison would make the app broken again, not unsafe. See
 *    `lib/selectedGenome.ts`.
 * 2. **It does not interpret the response.** Governance decisions arrive as
 *    HTTP status — 403 denied, 202 staged for a human — and collapsing those into
 *    a generic error would let a client mistake "held for approval" for "done".
 */

/**
 * `||`, not `??`.
 *
 * `??` falls back only on `undefined`, and the value that actually shows up in a
 * misconfigured deployment is the **empty string** — a platform variable that
 * resolved to nothing, or a dashboard field saved blank. An empty base makes the
 * request URL `/v1/tools/draft`, which has no origin, so `fetch` rejects with
 * `Failed to parse URL` before any request leaves the process.
 */
const API_URL = process.env.SPARK_API_URL || 'http://localhost:8080';

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { getToken, orgId } = await auth();

  const token = await getToken();
  if (!token) {
    return Response.json({ error: { code: 'FORBIDDEN', message: 'Not signed in.' } }, { status: 401 });
  }

  const genomeId = forwardableGenomeId(req.headers.get('cookie'), orgId);

  /*
   * The upstream call, with its own failure made legible.
   *
   * This used to be a bare `await fetch(...)`. Transport failures — the API
   * still starting, a container restarted mid-request, a long tool call cut off,
   * a base URL that is empty or wrong — reject the promise, and an uncaught
   * rejection in a route handler is a Next 500 with no code and no message a
   * client can act on. A 500 is also the one status this proxy is not supposed
   * to produce: every *governance* outcome already arrives as a status from the
   * API, so an unlabelled 500 is indistinguishable from the tool itself blowing
   * up, and sends whoever is debugging it to the wrong layer.
   *
   * Catching turns it into the thing it actually is — the proxy could not reach
   * the API — with the base URL named, because "which API did it try" is the
   * first question and the answer is a deployment setting, not a secret.
   *
   * Still no interpretation of a response that *does* arrive: that rule is
   * unchanged, and the `catch` cannot see one.
   */
  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/v1/tools/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(genomeId ? { 'x-genome-id': genomeId } : {}),
      },
      body: await req.text(),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[tools proxy] could not reach the API', { name, apiUrl: API_URL, detail });
    return Response.json(
      {
        status: 'failed',
        error: {
          code: 'UPSTREAM_FAILED',
          message: `Could not reach the SparkSocial API at ${API_URL}. ${detail}`,
        },
      },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
