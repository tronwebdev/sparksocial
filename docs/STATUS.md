# Status against the specs — 31 Jul 2026

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

## Not built yet

Ordered by what blocks what.

| Gap | Spec | Blocks |
|---|---|---|
| Asset Graph: captioning, embeddings, retrieval, gap detection | §4 | Assemble |
| Capture brief generation + validator | §6.2 | Direct+Finish |
| Finish pipeline (trim/stabilize/caption/hook/music/export) | §6.3 | Direct+Finish |
| Guardrail implementations (IDs exist, logic does not) | §10 | publishing safely |
| SPARK runtime + subagents | Plan §4 | autonomy |
| Postgres persistence — audit rows are in-memory | Plan §5 | everything real |
| Clerk auth — dev resolver trusts headers | Plan §2.2 | any deployment |

## Next

The eval harness recommendation is **done** — see above. What follows from it:

**Grow the golden set toward plan §11's 40 workspaces.** Seven cases is enough to
catch the obvious anti-patterns; forty is what the plan asks for, and each new one is
cheap now that the harness exists. Add them as real design partners are signed, so the
fixtures track reality rather than imagination.

**The Asset Graph is the next blocker.** The resolver takes an asset inventory as
input and nothing produces one yet. Until captioning, embedding and `asset.gaps` land,
Assemble cannot retrieve and the capture loop has nothing to close against.

Two standing calls:

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
