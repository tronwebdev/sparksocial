# Status against the specs — 8 Aug 2026

> **Build order is now strictly P0 → P1 → P2 → …**, each phase complete and
> verified before the next. The build had run backend-first and got ahead of
> itself: P1 and most of P2's engine logic were done while P0 was still missing
> auth, storage and the entire frontend. P0 is now closed — see
> [`P0_VERIFICATION.md`](P0_VERIFICATION.md).

Checked against `PRD.md`, `CONTENT_ENGINE_SPEC.md`, `CONTENT_OUTCOMES_AND_CAMPAIGN_FLOW.md`,
`MASTER_BUILD_PLAN.md`, and the original voice note.

## Verified correct

The routing primitive matches the engine spec exactly. This is the thing that would
have been expensive to get wrong, because everything downstream indexes on it.

| Contract | Source | Status |
|---|---|---|
| `proof_asset` — person / product_ui / physical_craft / finished_work / physical_product / data_outcomes | Engine spec §1.2 | exact |
| `capture_capability` — screen / space / work_artifacts / product / nothing | §1.2 | exact |
| `objective` — leads / bookings / trials / sales / audience / hiring | §1.2 | exact |
| `talent_availability` — yes_licensed / yes_unlicensed / no | §1.2 | exact |
| Nine `asset_role` values | §4.2 | exact |
| Five content pillars | §7.1 | exact |
| Three generation modes | §1.3 | exact |
| Genome isolation scoped by `genome_id` at the query layer | §9 | enforced, build-failing test |
| Autopublish default ON, approvals optional at four levels | PRD §7.1, §9 | 100% branch coverage |
| "Review first week then autopublish" | Outcomes §3.5 | implemented, graduates on day 7 |
| Every agent decision returns a structured `why` | PRD §7.3 | schema obligation, lifted onto every audit row |
| Avatar defaults OFF unless proof asset is a person | §10, Outcomes Rule 1 | derived, never asked |

The P1 exit criterion holds and is under test: a UI click and a SPARK request for the
same capability produce `tool_calls` rows that differ only in `caller`, `id`, and actor.

**The §13 acceptance test is now executable** (`packages/playbooks/test/golden.test.ts`),
covering the three named cases plus four long-tail ones. Live output from
`playbook.resolve`, one engine, no rule written for any of them:

| | top format | mode | mix |
|---|---|---|---|
| Lagos barbershop | `craft_capture` *(needs filming)* | Direct+Finish, 6 of 11 | community 40 / product 20 / personality 20 |
| Toronto B2B SaaS | `workflow_clip` | Assemble, 0 filming | educational 50 / product 25 / proof 15 |
| Manila freelancer | `before_after_transformation` | Assemble | educational 35 / personality 30 / proof 25 |

The eval was **mutation-tested rather than trusted**. Four deliberate regressions are
each caught: dropping the unlockable `direct_finish` rule, removing the §10 likeness
gate, raising the promotional ceiling, and classifying on the wrong dimension. The
ceiling assertion originally used the imported constant — a tautology that let one
mutation through — and now uses the spec's literal.

## Built since the last pass

| Capability | Spec | Notes |
|---|---|---|
| Asset Graph: captioning, embeddings, retrieval, gap detection | §4 | `packages/assetgraph` |
| Capture brief generation + validator, weekly batching | §6.2, §6.3 | `packages/capture` |
| Guardrail layer: seven checks, evaluator tool | §10 | `packages/guardrails` |
| Finish pipeline (trim/stabilize/caption/hook/music/export) | §6.3 | `packages/finish` |
| SPARK runtime: agent loop, subagent scopes, prompt-injection containment | Plan §4 | `packages/spark` |
| Postgres persistence — genomes/assets/content/tool_calls/agent_runs via Drizzle + pgvector | Plan §5 | `packages/db`; `apps/api` uses it automatically when `DATABASE_URL` is set, in-memory dev store otherwise |
| **P0 frontend foundation** — design tokens from the prototype, nine restyled shadcn primitives, `AppShell` + `SidebarNav` | Plan §12 P0 | `apps/web`; measured 1:1 against the prototype at a 1728px viewport |
| **P0 Clerk auth** — verified-session `resolveCtx`, five custom auth screens, single tool proxy | Plan §2.2 | `apps/api/src/clerk-auth.ts`, `apps/web/src/app/(auth)` |
| **P0 Azure Blob storage** — presigned upload via user-delegation SAS, `asset.upload_url` | Plan §2.2 | `packages/storage`; bytes never transit the API container |
| **P1 Agent Timeline** — `agent.run.list` / `agent.run.get`, run+step read model, live UI at `/agents` | Plan §4.5 | the trust surface behind autopublish; brand-scoped, out-of-scope runs read as absent |
| **P1 agent runtime over HTTP** — `POST /v1/agent/runs`, and SSE at `/v1/agent/runs/:id/events` | Plan §12 P1 | SPARK was a package with no way to reach it; 501 when no model key is configured |
| **SSRF guard** on every server-fetched URL | — | `packages/shared/src/safeUrl.ts`; see the security pass below |
| **P2 Assemble planner** — `assemble.plan`, beat resolution against the scoped Asset Graph | §6.5 | `packages/assemble`; the pure middle of the Assemble pipeline. Rendering is still absent |
| **P2 capture loop closed** — `direct.session.send` behind a `MessageTransport` seam, `direct.fallback.degrade` | §6.3, §6.5 | every step of the §6.3 chain now exists; only the WhatsApp client behind the seam is stubbed |
| **P3 campaign planner** — `campaign.propose_plan`, volume + mix + honest gap report | §6.8 Steps 2–3 | `packages/campaign`; volume is capped by format variety (`saturation_risk`), which is what makes the gap a real number |
| **P3 calendar** — `campaign.create`, `calendar.generate`, `calendar.get`, mix-level adjustment | §6.8 Step 4, `CAL-01`→`CAL-06` | `campaigns` table + scoped slot writes; regeneration replaces rather than stacks, and the promotional ceiling is re-applied to the placed calendar |
| **P4 publishing** — one `PlatformAdapter`, aggregator-first routing, `publish.now` / `publish.status`, retry with jittered backoff, per-brand per-platform rate budgets | §8, Plan §12 P4 | `packages/publish`; native adapters prepend as approvals clear. LinkedIn will not clear by Aug 29, which is why aggregator-first ships |
| **`inferGenome` implemented** — the genome inference pass, behind an injected client | §1.2, Plan §11, `ONB-02` | was a `throw`, and a hard blocker on P2's exit criterion. Unevidenced routing dimensions come back as onboarding questions rather than guesses |
| **P3 calendar UI** — mix bar as the review surface, month grid, relative adjustment | §6.8 Step 4, `CAL-01` | `apps/web/src/components/calendar` |
| **Approval ladder is live** — `brands` table, `brand.approval.get` / `.set`, governance read from the store | PRD §7.1, §6.8 Step 5 | `policy.ts` always implemented all three rungs; both resolvers returned a hardcoded `autopublish`, so it was inert in a running system |
| **P5 trend discovery** — `trend.rank`, ranking on remaining window not size, brand-safety as hard exclusion | PRD §8.9 `DISC-01` | `packages/trends`; sources are a credential-gated seam. **Out of the Aug 29 alpha scope** per CLAUDE.md — built on request |

## Security & scalability pass (8 Aug)

Bypasses were attempted against a running server, not just read for in code.

**Held.** Forged `x-org-id`/`x-genome-id` headers, a garbage bearer, and an
`alg:none` JWT with `org_role: admin` are all 401 against the Clerk resolver.
Cross-brand reads of a known run id return `NOT_FOUND`, never `FORBIDDEN` — so a
run id cannot be used to confirm another brand's activity. No secrets are
tracked by git.

**Fixed.**

| Finding | Severity | Fix |
|---|---|---|
| `z.string().url()` accepted `file://`, `localhost`, and `169.254.169.254` on three server-fetched URL fields. On Container Apps with Managed Identity, that endpoint mints tokens for the app's *own* identity — Key Vault, storage, the database. Not exploitable yet only because `crawl()` is unimplemented | **High (latent)** | `PublicHttpUrl` in `packages/shared/src/safeUrl.ts`, applied to `genome.bootstrap_from_url`, `asset.ingest_url`, `media.ingest`. Rejects at schema validation, so it applies identically to UI and SPARK calls. 14 tests |
| The URL parser normalises `::ffff:169.254.169.254` to hex, so the first version of the guard missed IPv4-mapped IPv6 entirely | **High (latent)** | Decode the hex groups back to IPv4 and apply the same rules. Caught by the guard's own test suite before it shipped |
| `apps/api/.env` was never loaded — the Clerk keys on disk were inert, and the API silently ran the header-trusting dev resolver | **High** | `--env-file-if-exists=.env`; correct in dev, CI, and Azure (where config comes from Key Vault and no file exists) |
| `createClerkClient` was built with only the secret key, so every authenticated request failed the handshake | **High** | Pass `publishableKey` too; `clerkConfigured` now requires both keys, so a half-configured instance is visibly wrong rather than quietly falling back |
| `/v1/agent/*` answered 501 *before* authenticating, letting an anonymous caller probe how the deployment is wired | Low | Authenticate first — 401 before 501 |
| `agent_runs` was indexed on `brand_id` alone, but the Timeline's only query is `WHERE brand_id ORDER BY started_at DESC LIMIT n` — Postgres sorted a brand's entire history to return 25 rows, on the most-visited screen | Perf | Composite `(brand_id, started_at DESC)`; same treatment for the guardrail layer's trailing-window read on `content_items`. Migration `0001` |
| `drizzle-orm` 0.36 carried a SQL-injection advisory on identifier escaping — the library genome isolation is built on | High (advisory) | Upgraded to 0.45.2; all 451 tests pass, including the 20 real-SQL pglite integration tests |

**Documented rather than changed**, because the analysis says leave it:

- **No ANN index on `assets.embedding`, deliberately.** The ranking expression is
  `similarity − recency − diversity`, not the distance operator, so pgvector's
  index *cannot* serve this `ORDER BY` under any configuration. What keeps it
  fast is the isolation predicate narrowing candidates to one genome first — the
  scoping requirement and the performance story are the same mechanism. The fix
  at scale is two-phase retrieval, not an index. Written up in `scoped.ts`.
- **The run event bus is in-process**, so with >1 replica an SSE client only sees
  events from its own replica. Correctness never depends on it — every event is
  also durable in `agent_runs`/`agent_steps`, and the Timeline UI polls rather
  than subscribing for exactly this reason. Redis pub/sub is the swap, behind the
  same interface.
- **Pool sizing is per-replica**: `max: 10 × maxReplicas: 3` = 30 connections.
  Fine now; past ~5 replicas it needs lowering or PgBouncer. Noted in `client.ts`.

**Open, needs your call.** Five advisories remain, all requiring framework major
upgrades, and none reachable in our usage: `next` 15→16 (via `postcss`/`sharp` —
`next/image` is unused, so sharp is never invoked) and `@hono/node-server` 1→2
(via `serve-static`, which we do not use). Also behind: `zod` 3→4 (touches every
schema in the repo), `typescript` 5→7, `vitest` 2→4, `tailwindcss` 3→4,
`@clerk/*`. Each is a real migration, not a bump.

## Not built yet

Ordered by what blocks what.

| Gap | Spec | Blocks |
|---|---|---|
| **Assemble render** — beat assembly now exists (`assemble.plan` produces a fully-resolved plan), but nothing turns that plan into a video. Needs Remotion + the Playwright capture service; `crawl()` is still a stub | §6.5, Plan §12 P2 | P2's exit criterion |
| **WhatsApp client** — `direct.session.send` and its `MessageTransport` seam exist and the loop runs end to end on a stub. What is missing is the WhatsApp Cloud API implementation behind it, which needs Meta business verification, plus the inbound webhook that receives the owner's footage | §6.3, Plan §8 | real delivery; **blocked on Meta, not on code** |
| Publishing adapters — `publish.*` tools don't exist as concrete implementations; only the scope assignment (Producer agent) is in place | §8, Plan §3.2 | going live |
| Onboarding UI (`ONB-01`→`ONB-06`) — the tools exist, the screens do not | Plan §12 P2 | first-run experience |
| Budget policy — approval mode is now stored and enforced, but `budget` is still hardcoded in both resolvers and there is no credit ledger | Plan §9 | real spend limits |
| `apps/web` deployment — needs a second Container App, Dockerfile and workflow job | Plan §2.2 | a live URL |

## Next

**P1 is now closed too.** Its last genuinely missing pieces were the Agent
Timeline — which `run.ts` had called *"a Phase-1 deliverable, not polish"* while
nothing rendered it — and the fact that the SPARK runtime was a package with no
HTTP route to reach it. Both now exist and are verified end to end. What remains
of P1 is observability (Langfuse, OpenTelemetry, Sentry) and the tRPC-vs-REST
reconciliation noted below; neither blocks P2.

**P2 is where the build actually is**, and its two real gaps are the Assemble
render and WhatsApp delivery. Without them the capture loop produces data but
never reaches an owner's phone or becomes a video — which is the whole
differentiator (`plan §12`: *"do not reorder P2"*).

**Needs you, not code:**
- Clerk dashboard: create the six custom organization roles (`org:owner` …
  `org:client`) matching `Role` in `packages/shared/src/types.ts`, and enable the
  Google / Facebook / X OAuth providers.
- Platform approvals — Meta, LinkedIn, Google, TikTok. Half of P0's stated exit
  criterion and pure business work. LinkedIn is the long pole per CLAUDE.md.

Two standing calls, unchanged:

**Trim the tool count for the alpha.** Plan §3.2 targets ~135 tools at GA. The Aug 29
scope needs roughly 30. Building the registry breadth-first would consume the month
without producing a single finished post.

**Model the Finish pipeline cost before committing to it** (open decision #2 in both
§12 and plan §13). It is the dominant unit-cost line for the local segment, which is
the segment the capture loop exists to serve.

## Known reconciliations

1. **Founder-POV avatar for SaaS.** Engine spec §10 says `avatar_enabled` *defaults*
   false when proof asset is not a person; outcomes Rule 1 says SaaS gets avatar "for
   founder POV only". `genome.dimensions.set` currently derives a hard false. The
   founder-POV path needs an explicit override, not a different default.

2. **Mode availability vs. asset availability.** `genome.dimensions.set` answers "what
   do the answers alone unlock", before any assets exist. A barbershop shows
   `assemble: false` at onboarding even though it will gain Assemble-able material once
   capture footage lands. The playbook resolver (§5.2) is where asset availability
   properly enters — this layer must not be read as the final word.

3. **Prototype vs. wireframe** (plan open decision #10). The `.dc.html` prototype
   is now in the repo under `ui build/` and is what P0 was measured against. The
   Whimsical map still is not, so the screen-by-screen diff remains open.

4. **tRPC vs. the REST door.** Plan §2.2 and CLAUDE.md invariant 1 both name tRPC
   *generated from the tool schemas*. What exists is a single hand-written Hono
   route (`POST /v1/tools/:name`) plus one Next proxy — same "one registry, one
   door" property, different transport, and no generated client. It has not cost
   anything yet because the registry is small and the proxy is generic. Worth
   settling deliberately before the tool count grows: either generate the tRPC
   router from the registry as specified, or amend the invariant to describe the
   transport actually in use. Leaving the doc and the code disagreeing is the
   option to avoid.

## Schedule risk

Aug 29 is 29 days out. Beyond the platform approvals already flagged in plan §8, one
more is worth naming: **WhatsApp Cloud API is a Meta product**. Test numbers work
immediately, but production messaging requires business verification. Since the capture
loop is both the moat (§1.3) and "the piece most likely to be technically
underestimated" (§11), that verification should be filed in the same week as the Meta
App Review, not when the pipeline is ready.
