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

## Not built yet

Ordered by what blocks what.

| Gap | Spec | Blocks |
|---|---|---|
| **Assemble pipeline** — Playwright capture service, beat assembly, Remotion render. Retrieval works; nothing turns retrieved assets into a rendered video | §6.5, Plan §12 P2 | P2's exit criterion |
| **WhatsApp delivery** — capture briefs are generated as data; nothing sends or receives them. `capture/src/session.ts` says so in its own comment | §6.3 | the capture loop, i.e. the moat |
| Publishing adapters — `publish.*` tools don't exist as concrete implementations; only the scope assignment (Producer agent) is in place | §8, Plan §3.2 | going live |
| Onboarding UI (`ONB-01`→`ONB-06`) — the tools exist, the screens do not | Plan §12 P2 | first-run experience |
| Budget policy — both resolvers hand out a hardcoded `budget` and `autopublish`; no `brands`/`autonomy_policies` tables, credits are P3 | Plan §9 | real spend limits |
| `apps/web` deployment — needs a second Container App, Dockerfile and workflow job | Plan §2.2 | a live URL |

## Next

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

3. **Prototype vs. wireframe** (plan open decision #10). The `.dc.html` prototype and
   the Whimsical map need a screen-by-screen diff before any frontend work. Neither
   file is in this repo.

## Schedule risk

Aug 29 is 29 days out. Beyond the platform approvals already flagged in plan §8, one
more is worth naming: **WhatsApp Cloud API is a Meta product**. Test numbers work
immediately, but production messaging requires business verification. Since the capture
loop is both the moat (§1.3) and "the piece most likely to be technically
underestimated" (§11), that verification should be filed in the same week as the Meta
App Review, not when the pipeline is ready.
