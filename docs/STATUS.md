# Status against the specs — 17 Aug 2026

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
| **P4 real aggregator adapter** — `createAyrshareAdapter` (`POST /api/post`), gated on `AYRSHARE_API_KEY`, stub otherwise | §8, Plan §12 P4 | `packages/publish/src/ayrshareAdapter.ts`; the receipt's `externalId` is Ayrshare's own post id, which `analytics.sync`'s Ayrshare client (`packages/analytics`) polls with — same account, same id, by construction |
| **P4 analytics sync** — `analytics.sync`, `content_metrics` table (scoped, upserted per post/platform), Ayrshare analytics client | Plan §3.2 `CC-04` | `packages/analytics`; gated on the same `AYRSHARE_API_KEY`. `analytics.post_metrics`/`campaign_report`/`cta_traffic` are reads over this and not yet built; `learning.*` (mix reweighting) is unbuilt and materially larger, tracked separately |
| **P4 scheduler** — poll loop over `content_items` where `status='scheduled' AND scheduled_at <= now`, publishes through the real `invokeTool` chain (so approval gating applies to a scheduled post exactly as it would a manual one) | Plan §12 P4 | `apps/api/src/scheduler.ts`; found and fixed along the way: `publish.now` never wrote its receipt back (`content_items` stayed `scheduled` forever) and the scheduler's synthetic ctx never set `x-genome-id` — both would have broken every real scheduled publish, caught by an end-to-end test against the real store and the real tool |
| **P4 Engagement Intelligence foundation** — `engagement_messages` inbox (scoped, upserted on `(org,genome,platform,external_id)` so a webhook retry can't duplicate a message), `engage.ingest`, `engage.classify` (real Claude classifier grounded in brand voice, fixed-keyword fallback without a key — same pattern `content.draft` uses), `engage.eligibility.check` (`ENG-01`'s gate) | PRD §8.8, `ENG-01`→`ENG-02.4` | `packages/engage`; verified live end to end (ingest → classify → feed-ready row) against the dev store. **Foundation only** — `engage.reply.draft`/`.send`/`.autohandle`/`.escalate`/`.opportunity.*`/`.audit.query` and the feed UI are not built; no platform webhook exists to feed `engage.ingest` real traffic, same approval blocker as native publish adapters. The eligibility rule (14 days since campaign start AND ≥5 published posts) is a v1 default — PRD §12 names this exact rule as an unresolved open question |
| **`inferGenome` implemented** — the genome inference pass, behind an injected client | §1.2, Plan §11, `ONB-02` | was a `throw`, and a hard blocker on P2's exit criterion. Unevidenced routing dimensions come back as onboarding questions rather than guesses |
| **P3 calendar UI** — mix bar as the review surface, month grid, relative adjustment | §6.8 Step 4, `CAL-01` | `apps/web/src/components/calendar` |
| **Approval ladder is live** — `brands` table, `agent.approval_mode.get` / `.set`, governance read from the store | PRD §7.1, §6.8 Step 5 | `policy.ts` always implemented all three rungs; both resolvers returned a hardcoded `autopublish`, so it was inert in a running system |
| **P2 site crawl** — `crawl()` on Playwright, JS-rendered pages, same-origin link following, per-page and total budgets | `ONB-01`, §1.2 | was the last `throw` in the codebase. Every request is re-screened against the SSRF guard — including redirect hops, which `page.goto` follows transparently — and repeated nav chrome is deduplicated so the model sees the menu once, not five times |
| **Real genome inference** — `anthropicInferenceClient`, Opus behind forced tool use | `ONB-02`, §1.2 | the crawl fed a fake: `devInferenceClient` derives a profile from the *hostname* and never reads the corpus, so a real crawl of a global project returned `en-NG, radiusKm 10`. Selected on `ANTHROPIC_API_KEY`, and the fallback now warns loudly |
| **The `agent.*` / `human.*` family, all ten** — `agent.status` · `pause` · `resume` · `frequency.set` · `approval_mode.set` · `explain` · `human.ask` · `human.notify` · `whatsapp.send` · `whatsapp.receive` | Plan §3.2 | plus `human.pending` / `human.answer` so questions have a reader, and `agent.approval_mode.get`. `whatsapp.receive` is the alpha's one untrusted-input boundary and is `human_only` — SPARK must not be able to manufacture the owner's answer to its own question |
| **Spend is enforced** — `org_budgets` + `credit_ledger`, real balance in `ToolCtx`, `recordCost` wired | Plan §9 | `policy.ts` rule 4 was doubly inert: both resolvers hardcoded `remainingCents: 100_000`, **and** the rule keyed on `effect: 'spend'`, which **no tool in the registry has ever declared**. Now keyed on `estimatedCents > 0`. Found by draining a 2¢ cap with 1¢ calls against a running server; no unit test could have caught it |
| **Shared rate limits** — `createRedisRateLimiter`, atomic sliding window in Lua | Plan §2.2 | `RateLimiter` is async now. The in-memory one stays for dev/CI; without `REDIS_URL` the API warns that the budget multiplies by replica count |
| **P5 trend discovery** — `trend.rank`, ranking on remaining window not size, brand-safety as hard exclusion | PRD §8.9 `DISC-01` | `packages/trends`; sources are a credential-gated seam. **Out of the Aug 29 alpha scope** per CLAUDE.md — built on request |
| **P5 multi-source trend aggregation** — Reddit, YouTube, Hacker News, Product Hunt, Pinterest sources feeding the composite ranker, each independently credential-gated (`TREND_SOURCE_*_ENABLED`) so one bad source can't take down the batch | PRD §8.9 | `packages/trends/src/sources/*`; one source's fetch failure is caught per-item, not per-batch |
| **P5 automation recipes** — `recipe.create`/`.list`/`.get`/`.delete`/`.schedule`/`.run`/`.validate`/`.output.list`/`.output.decide`, CSV/RSS/Canva/Drive Bulk Connector sources, a scheduler polling due recipes | PRD §8.10, Plan §12 P5 | `packages/recipes`; `apps/api/src/recipe-scheduler.ts`. Canva/Drive sources are OAuth/API-key-gated — see `docs/GAPS.md` |
| **P5 Discovery + Automation UI** — trend feed, watchlist, the recipe builder and its output review queue | `DISC-*`, `AUTO-*` | `apps/web/src/app/(app)/discovery`, `.../automation` |
| **P6 learning loop** — `learning.record_outcome` (reward computed from real `content_metrics` against the genome's own recent baseline, never caller-supplied), `learning.reweight` (Thompson sampling, exploration floor, min-qualifying-arms gate), `learning.confidence`/`.explain`, wired into `packages/playbooks/src/mix.ts`'s `deriveMix()` | Plan §6.7, §7.2, §12 P6 | `packages/learning`; the account's own performance, never cross-genome |
| **P6 agency multi-tenancy** — `org.*`/`brand.*`/`team.*` families, `brand_members` scoping, white-label review links, audit query | Plan §6.9, §12 P6 | `packages/agency`; see the agency isolation gap below — the write side is real, the read-side enforcement is not yet |
| **P6 Agency Portal, billing, credits, usage** — client roster, per-plan `monthlyCapCents` (`org.billing.plan.set`, real plan→cap lookup, not a shared default), credit grants, white-label settings, all folded into `apps/web/src/components/settings/AgencyPanel.tsx` rather than a separate "Billing" screen | Plan §6.9, §9, §12 P6 | `packages/agency`, `apps/web/src/components/settings` |
| **P7 mobile/tablet responsive pass** — root-caused a Tailwind grid-track sizing bug present in ~64 places across 20 files, plus a missing mobile nav drawer | Plan §12 P7 | see `docs/GAPS.md`'s own detailed writeup; verified live at 375px/768px across all 7 authenticated routes |

## Gap-closure pass (17 Aug 2026)

`docs/GAPS.md`'s "Asset Graph / knowledge", "Campaign / calendar / drafts", "Content
generation", and "Engagement" sections were each closed item-by-item against real data —
see that file for the detail behind every entry. Summarized here:

| Capability | Notes |
|---|---|
| **Asset rights/cooldown/reuse/folders** — `asset.rights.set`, `.cooldown.check`, `.reuse`, `.folder.create`/`.move` | New `asset_folders` table; `.cooldown.check` reuses the guardrail's own `DEFAULT_COOLDOWN_DAYS` so the check and the guard can't disagree |
| **`genome.compliance.classify`** — keyword classifier over health/finance/legal/regulated_other, `overrideProfile` for a person's final call | Makes `guard.compliance_profile` (built since P2, enforcing forbidden phrases/disclaimers) actually reachable — nothing had ever set the flag away from `'none'` before this |
| **Knowledge ingestion actually grounds claims** — `knowledge.ingest_site`/`.ingest_docs`/`.ground_claim`, plus a fix to `guard.claim_grounding` itself | The real find: the claim-grounding guardrail never read `knowledge_chunks` at all — the entire knowledge-ingestion feature, including the pre-existing manual `brand.knowledge.attach`, was silently inert until this pass |
| **Campaign lifecycle + calendar preview** — `campaign.duplicate`/`.pause`/`.resume`, `calendar.impact_preview` (dry-run a rebalance before committing) | |
| **Draft variants/repurpose, playbook browsing** — `draft.variants` (read, independent takes), `draft.repurpose` (write, new content item, source untouched), `playbook.list`/`.get`/`.explain` | |
| **Founder-POV avatar override** — `genome.avatar_override.set`, resolving `docs/GAPS.md` open decision #1 | `human_only`, gated on licensed talent + active consent, disabling reverts to the plain derived default rather than forcing off |
| **`approval.policy.set`/`.get`** — per-brand family autonomy overrides, restricted platforms/content types, quiet windows, spend/automation permission toggles | Closed a real dead-code gap: `policy.ts` had read these five fields since P1; nothing had ever written or forwarded them, so every branch reading them was live in unit tests and permanently dead in production — same bug class as the kill switch before `agent.pause` existed |
| **`learning.freeze`/`.reset`** — a kill-switch for the mix engine (locks the current mix, `learning.reweight` becomes a no-op) and a true cold-start reset (deletes every arm *and* outcome, not just arms) | |
| **`analytics.post_metrics`/`.campaign_report`/`.cta_traffic`** — single-post read, plain engagement rollup (deliberately narrower than `campaign.report_vs_outcome`'s plan comparison), and CTA click tracking | New `content_links` table for `link.shorten`'s optional `contentItemId` attribution; Dub.co carries a live `clicks` count on the link resource itself, confirmed against the real API |
| **`compose.static`** — Satori + `@resvg/resvg-js`, a browser-free render path for image/carousel formats alongside the existing Remotion-backed `compose.render` | No headless Chrome needed for a single static frame; live-verified real PNG output |
| **`compose.fanout`** — Canva Autofill + Export orchestration, gated per-genome on an existing Canva OAuth connection | Fans out to file *formats* (png/jpg/pdf), not arbitrary pixel sizes — Canva's public API has no resize endpoint |
| **`content.generate_broll`** — fal.ai queue-based generative b-roll video | New `generated_broll` beat kind |
| **`content.generate_dub`** — ElevenLabs multi-language dubbing, re-voices an existing beat in place | New `dubbed_media` beat kind; named to avoid colliding with the unrelated `packages/publish/src/dub.ts` (Dub.co link shortener) |

**A real production bug found and fixed along the way, independent of the gap-closure work
above**: a scheduled content item whose `publish.now` call failed with `GUARDRAIL_BLOCKED`
(or any of three other conditions — missing genome, no `playbookId`, no platform) stayed in
`status: 'scheduled'` forever, so the scheduler re-selected and re-failed the same row on
every tick indefinitely — reported live against a real stuck row in this environment's own
Postgres. Fixed with a new `blocked` status and `blocked_reason` column
(`ContentStore.markBlocked`); a regression test proves a blocked item is picked up once,
marked, and never retried. **A second bug, found live while verifying `analytics.cta_traffic`
and fixed same day**: `link.shorten` 422'd against the real Dub API on every call, because
this workspace rejects any `tagNames` value that isn't an already-existing tag and
`link.shorten` always tags with at least the genome id. `dub.ts`'s `shorten()` now ensures
every tag exists (search, then create, tolerating a 409 as a same-tag race) before creating
the link. Live-verified against the real API with the exact original failure mode — a
brand-new UUID-shaped genome-id tag Dub had never seen — including that a second call reusing
the same now-existing tag still succeeds.

Also found during this pass's own audit of `docs/GAPS.md` (see that file for full detail):
the local `tsx watch` dev process silently stopped hot-reloading partway through the
session, freezing the live tool count for a stretch before a restart picked up all 138; and
the Command Center has no UI surface for a pending `human.ask` question at all, despite the
plan explicitly calling that "the other half of the Command Center."

## Native publishing + UI wiring pass (18 Aug 2026)

Two follow-ups to the 17 Aug gap-closure pass — full detail in `docs/GAPS.md`'s "Publishing /
social connections" and "UI wiring" sections.

**Publishing corrected from aggregator-first to native-first**, per the PRD's actual strategy
(§8: "go native on the core five... use an aggregator for the long tail") rather than the
aggregator-first default the 17 Aug pass had shipped:

| Capability | Notes |
|---|---|
| **Five native platform adapters** — `packages/publish/src/native/` (Instagram, TikTok, LinkedIn, X, YouTube) | Instagram/TikTok are URL-based (the platform fetches the media); LinkedIn/X/YouTube fetch and re-upload bytes (LinkedIn's asset-registration flow, X's chunked INIT/APPEND/FINALIZE, YouTube's resumable upload) — meaningfully more complex, correspondingly less confident without a live account. Same "unverified against a live account" caveat every vendor integration in this codebase already carries |
| **`integration.connect`/`.health`/`.scopes.verify`/`.rate_budget`** — the per-brand social-account connection flow the PRD names (`ONB-04`), previously 0 built | Real per-platform OAuth authorize URLs + token exchange, same PKCE + signed-state flow `brand.oauth.connect` established for Canva — extracted to `packages/shared/src/oauthState.ts` so `publish` doesn't depend on `agency` |
| **`PlatformAdapter`/`PublishRequest` extended with `accessToken`** | The real architectural gap this pass had to close: native adapters need the *connecting brand's* OAuth token, not one shared app-level key like the aggregator. `publish.now`/`.rollback` now read it straight from `oauth_connections` |
| **Ayrshare kept, not removed, but off by default** | `PUBLISH_USE_AGGREGATOR=true` opts back in; reserved for the long-tail platforms (Pinterest, GBP, Reddit, Bluesky, Threads) post-GA per plan §8 |
| **`oauth_connections` migration `0021`** | Two new columns, `scopes` and `account_label` — a connection now carries what was granted and a human-readable "@handle" |
| **`PublishHealthPanel.tsx`** | Switched from read-only `publish.status` to `integration.health`; added real Connect/Disconnect actions. Live-verified: Connect correctly reaches the real tool and refuses by name for an unconfigured platform |

**UI built for all but 4 of the ~22 tools the 17 Aug pass left backend-only** — the remaining
four (`knowledge.ingest_site`/`.ingest_docs`/`.ground_claim`, `genome.compliance.classify`) had
no obvious existing surface to extend. New/extended surfaces: `AssetDetailPanel.tsx` (rights,
cooldown, reuse, folders — plus a small new `asset.folder.list` tool the folder picker needed),
`CampaignFocusCard.tsx` (duplicate/pause/resume), `MixBar`'s preview-before-apply (a
`calendar.impact_preview` misconception from the 17 Aug pass corrected — it previews a mix
regeneration, not a single-slot date move), an ⓘ affordance on the Draft Panel's repurpose
picker (`playbook.get`/`.explain`), two new Settings panels (`PolicyPanel.tsx`,
`LearningPanel.tsx`), `CampaignReportPanel.tsx`'s by-platform/top-posts extension, a "View
metrics" expandable in `DraftList.tsx`, and a third Draft Panel render button for
`compose.fanout`. All of it live-verified against the real running app; full suite (1717
tests) and full monorepo typecheck clean throughout.

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
| **WhatsApp client** — `whatsapp.send` / `whatsapp.receive` / `direct.session.send` and the `MessageTransport` seam all exist, and the loop runs end to end on a stub. What is missing is only the Cloud API implementation behind the seam, and the HTTP webhook route that calls `whatsapp.receive` with a verified Meta signature | §6.3, Plan §8 | real delivery; **blocked on Meta, not on code** |
| Native platform adapters (Meta, TikTok, LinkedIn, X, YouTube) — `publish.now`/`publish.status` are real and route through a real Ayrshare aggregator adapter (`AYRSHARE_API_KEY`, stub otherwise); no native adapter exists because none of the five has cleared platform approval yet, and the per-brand OAuth-connection tooling they'd need (`integration.connect`/`.health`/`.scopes.verify`) isn't built either — Canva's own OAuth flow (a different, non-publishing use) is | §8, Plan §3.2 | native-adapter margin/data-depth; **blocked on platform approvals, not on code** |
| Automated Assemble screen/site capture (`assemble.screen_capture`) — only site-*reading* for genome inference exists; Assemble playbooks needing screen-recording footage still require manual upload | §6.5 | Assemble-mode footage supply |
| Human-in-the-loop Command Center inbox — `human.ask`/`.pending`/`.answer` are real and tested; no web UI surfaces a pending SPARK question anywhere (see `docs/GAPS.md`'s "UI wiring" section, found 17 Aug 2026) | Plan §3.2, "the other half of the Command Center" | an owner can't discover a parked question inside the product |
| `apps/web` deployment — needs a second Container App, Dockerfile and workflow job | Plan §2.2 | a live URL |

## Next

**P1 is now closed too.** Its last genuinely missing pieces were the Agent
Timeline — which `run.ts` had called *"a Phase-1 deliverable, not polish"* while
nothing rendered it — and the fact that the SPARK runtime was a package with no
HTTP route to reach it. Both now exist and are verified end to end. What remains
of P1 is observability (Langfuse, OpenTelemetry, Sentry) and the tRPC-vs-REST
reconciliation noted below; neither blocks P2.

**P2's Assemble render is now real** — `compose.render` (Remotion, a genuine headless-Chrome
bundle-and-render, empirically verified end to end: a playable MP4 and a valid PNG, checked
with `file` and a real player, not just "no exception thrown") and its faster sibling
`compose.static` (Satori, browser-free, for image/carousel formats). **WhatsApp delivery
remains P2's one real gap** — the loop runs end to end on a stub, and what's missing is only
the Cloud API client behind the seam plus the verified webhook route, both blocked on Meta
business verification, not on code (`plan §12`: *"do not reorder P2"*).

**Needs you, not code:**
- Clerk dashboard: create the six custom organization roles (`org:owner` …
  `org:client`) matching `Role` in `packages/shared/src/types.ts`, and enable the
  Google / Facebook / X OAuth providers.
- Platform approvals — Meta, LinkedIn, Google, TikTok. Half of P0's stated exit
  criterion and pure business work. LinkedIn is the long pole per CLAUDE.md.

Two standing calls, unchanged:

**Trim the tool count for the alpha.** Plan §3.2 targets ~135 tools at GA. The Aug 29
scope needs roughly 30. Building the registry breadth-first would consume the month
without producing a single finished post. **This call was never made** — the registry
sits at 138 tools live as of 17 Aug 2026, past the GA target already, because gap-closure
work kept building against the full plan rather than the alpha subset. Worth revisiting
explicitly: either the Aug 29 surface really is closer to the full registry than "roughly
30" suggested, or the alpha's actual *exposed* surface should be deliberately narrower
than what's built — see `docs/GAPS.md`'s new "UI wiring" section, which shows the
product's clickable surface is already materially narrower than its tool count.

**Model the Finish pipeline cost before committing to it** (open decision #2 in both
§12 and plan §13). It is the dominant unit-cost line for the local segment, which is
the segment the capture loop exists to serve.

## Known reconciliations

1. ~~**Founder-POV avatar for SaaS.**~~ **Resolved 17 Aug 2026.** `genome.avatar_override.set` —
   `avatarDefault()` stays the single hard-derived default (engine spec §10, invariant 5
   intact), and this is a `human_only`, explicitly-reasoned override on top of it, gated on
   licensed talent availability and active `avatar_clone` consent. Disabling reverts to the
   plain derived default rather than forcing avatar off. See `docs/GAPS.md`.

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
