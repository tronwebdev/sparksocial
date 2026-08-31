import { auth } from '@clerk/nextjs/server';
import { forwardableGenomeId } from '@/lib/selectedGenome';

/**
 * THE SECOND, DELIBERATE EXCEPTION TO "ONE ROUTE HANDLER".
 *
 * `apps/api/src/app.ts`'s own comment on `POST /v1/agent/runs` explains why it
 * is not a registry tool: "the agent is the thing that *calls* tools, so
 * exposing it as one would let an agent invoke itself recursively through its
 * own registry." That is a backend design choice, not an oversight — and it
 * means the chat drawer (CC-02) needs a second narrow proxy, because
 * `src/app/api/tools/[name]/route.ts` only ever forwards to `/v1/tools/:name`.
 *
 * This is not "a capability outside the registry" in the sense that rule
 * warns against — it forwards to a backend endpoint that was *already*
 * deliberately kept outside the registry, for a reason specific to it. Adding
 * capability logic here (deciding what SPARK does, shaping its output) would
 * violate invariant 1; forwarding the one non-tool endpoint the backend
 * exposes does not. See CLAUDE.md's Frontend rules for the recorded exception.
 *
 * Same transport rules as the tool proxy: Clerk token attached, genome cookie
 * forwarded as an untrusted claim the API re-validates, response streamed back
 * unmodified. No SSE proxying here — `runAgent()` runs the loop to completion
 * before responding, so a plain request/response is all this needs; the
 * drawer shows a "thinking" state for the duration.
 */

const API_URL = process.env.SPARK_API_URL ?? 'http://localhost:8080';

export async function POST(req: Request) {
  const { getToken, orgId } = await auth();

  const token = await getToken();
  if (!token) {
    return Response.json({ error: { code: 'FORBIDDEN', message: 'Not signed in.' } }, { status: 401 });
  }

  // Same org comparison as the tool proxy, for the same reason — see
  // `lib/selectedGenome.ts`. An agent run is the one surface that reads
  // `ctx.genomeId` off the request rather than taking it in a tool input, so a
  // stale claim here fails the whole run rather than one call.
  const genomeId = forwardableGenomeId(req.headers.get('cookie'), orgId);

  const upstream = await fetch(`${API_URL}/v1/agent/runs`, {
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
