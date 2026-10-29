# SparkSocial — Build Rules

Read this before writing any code. These rules are not stylistic preferences; violating
them creates rework that costs weeks. Full plan: `docs/MASTER_BUILD_PLAN.md`.

## The five invariants

**1. Every capability is a tool.**
No React component, tRPC route, or workflow calls a domain service directly. It calls a
tool. Tools are declared with `defineTool` and registered in `packages/tools/src/registry.ts`.
The tRPC router is *generated* from the registry — never hand-written. If you find yourself
writing a route handler that isn't a tool call, stop; you are building the thing we are
trying not to build.

**2. Genome isolation is a repository predicate.**
Every query touching `assets`, `knowledge_chunks`, `memories`, or `content_items` goes
through `packages/db/src/scoped.ts` and requires a `genomeId`. This includes vector search.
A UI filter is not isolation. `npm run test:isolation` fails the build if a raw query bypasses
the scoped layer — do not add exceptions to that test.

**3. Policy is a pure function.**
`evaluate()` in `packages/tools/src/policy.ts` takes a tool, its input, and a context, and
returns a decision. It performs no I/O, reads no globals, and is unit-tested to 100% branch
coverage. Autonomy behaviour lives there and nowhere else. Never inline an autonomy check
in a handler.

**4. Every agent-visible decision carries a `why`.**
Any tool whose output drives something a user sees SPARK decide — trend selection, calendar
placement, engagement classification, playbook choice, mix ratio — returns a structured
`Explanation`. The PRD requires this (§7.3). It is a schema obligation, not a prompt
instruction. `WhyPopover` renders it.

**5. Playbooks are data, not code.**
Adding a playbook must never require a deploy. Preconditions are expressed in genome
dimensions (`proof_asset`, `capture_capability`, `objective`, `talent_availability`) and
required asset roles. **Never** branch on niche or category name anywhere in the engine.
If you write `if (category === 'barbershop')` you have broken the architecture.

## Build order (do not reorder)

```
packages/shared → packages/db → packages/tools → packages/genome
  → packages/assetgraph → packages/playbooks → apps/spark → apps/web
```

Write the policy tests and the isolation test *before* the handlers they guard. Both are
painful to retrofit and cheap to write first.

## Conventions

- TypeScript strict. No `any` in `packages/*`. Zod schemas are the single source of type truth.
- Every tool handler is idempotent or declares `idempotent: false` and takes an idempotency key.
- Cost: any tool that spends money records `cost_cents`. No exceptions — the credit model
  depends on this data existing from day one.
- Errors: throw `ToolError` with a `code`; never throw bare strings. The agent reads these.
- Untrusted input (crawled sites, RSS, social inboxes, WhatsApp media) is wrapped in
  `untrusted()` before it reaches a model prompt. It can never authorise a tool call.

## What "done" means for a tool

1. Zod input/output schemas, output includes `why` where applicable
2. Registered in the registry with correct `effect`, `autonomy`, `scopes`
3. Handler is scoped through the repository layer
4. Unit test for the happy path + one policy-denial path
5. Appears in the generated tRPC client without hand-editing
6. Callable by SPARK and by the UI, producing identical `tool_calls` rows

---

## Infrastructure — Render (supersedes both the plan's stack and the Azure one)

The master plan §2.2 targets Vercel + Fly.io + Neon + Cloudflare R2. This project ran on
Azure, and is **moving to Render + Cloudflare R2**. The substitutions below are the only
stack deviations from the plan; everything above the infrastructure line is unchanged.

**Status, so nobody writes against the wrong one.** The code is ready and the deployment is
not. `packages/storage/src/r2.ts` and `render.yaml` exist and are tested; no service has
been cut over yet, and `infra/azure/` is still the live deployment until it is. Write new
infrastructure code against Render. Do not add anything new that depends on Azure, and do
not delete the Azure path until the cut-over is proven — `infra/render/MIGRATION.md` is the
runbook, and §7 is the order the steps actually have to happen in.

| Plan §2.2 choice        | Render replacement                                            |
| ----------------------- | ------------------------------------------------------------- |
| Vercel (web)            | **Render Web Service** (Docker, Next.js standalone)           |
| Fly.io (agent, capture, FFmpeg) | **Render Web Service** — `apps/api/Dockerfile`         |
| Neon Postgres           | **Render Postgres** + `pgvector`                              |
| Cloudflare R2           | **Cloudflare R2** — as the plan originally specified          |
| Upstash Redis           | **Render Key Value**                                          |
| — (secrets)             | **Render env group** — no vault, no managed identity          |
| — (queues)              | *nothing* — not provisioned; Trigger.dev is unchanged         |

Unchanged, because they are provider-agnostic SaaS: Trigger.dev (durable workflows), Mux
(video delivery), Clerk (auth), Langfuse, PostHog, Sentry, HeyGen, ElevenLabs, fal,
Higgsfield (the video backup behind fal), Canva, AssemblyAI, WhatsApp Cloud API, Dub.

**The plan's R2 rationale is back.** R2 was chosen for zero egress, which is the dominant
cost lever for a media product. Azure Blob charges egress, which is why the Azure note here
used to mandate serving all media through a cached Front Door. On R2 that requirement is
obsolete rather than merely inaccurate — there is no egress bill to design around. Mux stays
in front of video for delivery reasons, not cost ones.

**Operational rules:**
- The Claude Code sandbox cannot reach the cloud (network allowlist). Anything provider-side
  runs from the developer machine.
- `pgvector` needs one `CREATE EXTENSION IF NOT EXISTS vector;` before migrations. Unlike
  the Flexible Server there is no allow-list step, but run it **before** restoring any dump
  or every `vector` column fails to restore.
- **Secrets are environment variables in an env group, set by a human.** There is no Key
  Vault and no managed identity: nothing resolves a secret at revision start, and anyone
  with dashboard access can read every value. That is a genuine reduction in posture
  compared with Azure. It is normal for Render and survivable; say it out loud rather than
  discovering it at an audit.
- **Leave unconfigured keys out of the env group entirely. Never add blank placeholders.**
  `defineTool` registration is gated on `envSet(...)`, so an absent key leaves its tool
  cleanly unregistered and the button simply is not there. An empty string registers the tool
  and fails at call time, which reads to a customer as "the product is broken" rather than
  "this is not configured". `infra/azure/secrets.manifest` is the only place the
  required/optional semantics are written down — the env group has no equivalent concept, so
  keep that file whatever happens to the rest of `infra/azure/`.
- **Migrations run in CI, never in `preDeployCommand`.** Render's pre-deploy command runs
  inside the deployed image, which installs `npm ci --omit=dev`, and `drizzle-kit` is a
  devDependency of `packages/db` — it will not be there. Schema before code, and turn off
  auto-deploy on the API or the deploy races the migration.
- **The API cannot run on a free or starter instance.** Its image carries Debian, ffmpeg,
  Chromium and fonts because Playwright crawls sites during onboarding and Remotion renders
  video. A render on 512MB OOMs, and free instances spin down when idle, which silently
  breaks the WhatsApp webhook and every OAuth callback.
- **Never** commit tokens, PATs, or connection strings. R2 keys and every other secret live
  in the env group; `apps/api/.env` is gitignored for local work.

## Scope — what is built (audited 17 October 2026)

The binding constraint remains **platform approvals, not code** (plan §8), and it is now the
*only* one of consequence: the adapters are written and waiting on paperwork.

**This section used to say P4–P6 were out of scope** — trend discovery, automation recipes,
engagement intelligence, the learning loop, agency multi-tenancy. All five are built, and have
been for some time. Anyone who read that line to decide what to work next on was misled by it,
which is the only reason it is worth recording that it was wrong.

Measured against the registry and the deployed manifest, not from memory:

- **226 tools defined, 225 live** (generator, 29 Oct). Only `analytics.sync` is unregistered, gated on
  `AYRSHARE_API_KEY`. Nothing else is held back by configuration. The count comes from
  `npm run generate:tool-types`, which walks every `defineTool` in the source and so counts
  what is *defined* regardless of env gating — it read 214 before `brand.delete` and
  `brand.deletion.preview` were added, so the "212" this line used to carry had already
  drifted by two, and it read 217 against the "216" that replaced it. Re-read it from the
  generator rather than incrementing this number by hand.

  Note what adding a *vendor* does to this number: nothing. Higgsfield joined video
  generation as fal's backup without a tool of its own, because a fallback belongs behind
  `content.generate_broll` rather than beside it — two tools for one capability would make
  "which one do I call" a question the agent has to answer, and it has no way to know which
  vendor has credit.
- **Every PRD flow ID has code.** The "36 of 37" this line used to claim was wrong twice
  over: the PRD declares **52** flow IDs, not 37, and 22 of them have no ID in a comment
  anywhere. Measured 21 Oct by extracting every `XXX-NN` from `docs/PRD.md` and grepping the
  tree for each.

  Eighteen of the 22 are *sub-steps* (`AUTO-03.1`, `ENG-04.2`) whose parent flow does have
  code; the remaining four are built under other names — `AUTH-04` is `/meet-spark`,
  `AGT-01` is `/agents`, `AUTO-03` is the `bulk_connector` recipe kind, `ENG-04` is
  `EngagementGate.tsx`. `ENG-04` is also printed twice in the PRD under two different
  descriptions, which is a PRD typo rather than a missing screen.

  The lesson the old number carries: grepping for an ID measures commenting discipline, not
  coverage. Confirm each apparent gap by looking for the feature.
- **All 12 native publish adapters exist** — Instagram, Facebook, Threads, TikTok, LinkedIn,
  X, YouTube, Pinterest, Reddit, Bluesky, Google Business — behind `PlatformAdapter`, with
  the aggregator still in front.

What is genuinely absent is in `docs/GAPS.md`, which is the file to keep current. The short
version: no `content.delete`, no Sora Cameo (no public API), agency identity/theme generation
and domain binding, palette-from-crawl, and analytics ingestion while Ayrshare is unset.

**Verification owed:** this audit was structural — routes, registry, flow-ID references,
inert-control markers. It did **not** diff each screen against its `.dc.html` at a matching
viewport, which the frontend rules below require and which is the only check that catches
fidelity drift rather than missing function.

## Frontend rules (`apps/web`)

- **`apps/web` imports `@sparksocial/shared` and nothing else from `packages/`.** Every
  capability is reached over HTTP through `POST /v1/tools/:name`. Importing
  `@sparksocial/db` would let a component build a raw query and bypass the scoped layer;
  `packages/db/test/isolation.test.ts` walks `.tsx` and fails the build if it happens.
- **There are exactly two route handlers, both transport proxies, never a third.**
  `src/app/api/tools/[name]/route.ts` forwards to `POST /v1/tools/:name`; attaches the
  Clerk token, forwards, streams back. `src/app/api/agent/runs/route.ts` forwards to
  `POST /v1/agent/runs` — the SPARK runtime, which `apps/api/src/app.ts` deliberately
  keeps *outside* the tool registry (an agent callable as a tool could invoke itself
  recursively through its own registry). Because that endpoint is a second, intentionally
  non-tool surface on the backend, the frontend needs a second narrow proxy to reach it;
  this is not the exception it looks like — the rule is "one proxy per non-tool backend
  surface", and there are currently two. A third handler under `src/app/api/` — for
  anything other than forwarding to one of these two backend surfaces — means someone is
  building a capability outside the registry.
- **`apps/web` is the one app with its own `tsconfig.json`.** `next dev` rewrites whatever
  config it is pointed at, and it must not be allowed to mutate the root config governing
  `packages/db`. Root `include` is narrowed to `apps/api` for the same reason. Note that
  TypeScript's `extends` *replaces* `paths` rather than merging, so all aliases — including
  `@/*` — stay in the root map.
- **The `.dc.html` files in `ui build/` are the design source of truth**, not
  `figma-system/fig-tokens.css` (generic Figma boilerplate that no screen references) and
  not `BUILD_PLAN.md`'s prose, which is stale in the same way. This means: before building
  or editing any screen, open the matching `.dc.html` file and read its actual
  classes/inline styles — never approximate spacing, color, or type from memory or
  convention. Extract exact hex/px/rem values into `tailwind.config.ts` / `tokens.json`
  rather than hardcoding them in a component. After building, render the `.dc.html` file
  and the live screen at the same viewport width, screenshot both, and diff them before
  calling the screen done. If a `.dc.html` file can't be read, stop and say so — don't
  proceed on a guess.

## Reference implementation

`packages/genome/src/bootstrap.ts` (`genome.bootstrap_from_url`) is the shape every other
tool is copied from. Read it before writing a new tool.
