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

const API_URL = process.env.SPARK_API_URL ?? 'http://localhost:8080';

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { getToken, orgId } = await auth();

  const token = await getToken();
  if (!token) {
    return Response.json({ error: { code: 'FORBIDDEN', message: 'Not signed in.' } }, { status: 401 });
  }

  const genomeId = forwardableGenomeId(req.headers.get('cookie'), orgId);

  const upstream = await fetch(`${API_URL}/v1/tools/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(genomeId ? { 'x-genome-id': genomeId } : {}),
    },
    body: await req.text(),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
