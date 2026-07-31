# SparkSocial AI — Master Build Plan

**Version 3.0 · July 2026 · Agent-first, tool-native**
Owner: Godswill / Tronweb · Builder: Claude Code

---

## 0. What this document is, and what it reconciles

This is the single build contract. It reconciles four inputs that were previously separate and in places contradictory:

| Source | Status in this plan | Notes |
|---|---|---|
| `SparkSocialAI_PRD.md` v1.0 | **Authoritative for scope, modules, governance, roles, UI flow IDs, integrations register** | All `AUTH-`/`ONB-`/`CC-`/`CAL-`/`ENG-`/`DISC-`/`AUTO-`/`LIB-`/`SET-` IDs are preserved as the functional spec. |
| `sparksocial-content-engine-spec_1.md` v1.0 | **Authoritative for the content engine.** Supersedes Part 2 of `BUILD_PLAN.md` | Brand Genome, Asset Graph, Playbook Resolver, Mix Engine, three generation modes, guardrails, learning loop. |
| `sparksocial-content-outcomes-and-campaign-flow.md` v1.0 | **Authoritative for content definition and campaign UX** | The per-segment content tables are *playbook authoring reference*, not runtime lookup. |
| `BUILD_PLAN.md` / `BUILD_PLAN2.md` v1.0 (identical) | **Retained for app stack, design tokens, and the prototype fidelity contract.** Its content-engine section is superseded. | The `.dc.html` prototype remains the visual source of truth. |

**Two corrections this version makes to earlier drafts:**

1. **Segment is a label, not a routing key.** An earlier draft organised the engine around seven segment playbooks. That is the design the content-engine spec explicitly warns against — it covers 40 niches and then fails permanently on the long tail. Routing is by **genome dimensions** (`proof_asset`, `capture_capability`, `objective`, `talent_availability`), and playbooks declare **preconditions over those dimensions**. Segment tables become authoring reference for whoever writes playbook records.
2. **Three production modes, not one.** SYNTHESIZE / ASSEMBLE / DIRECT+FINISH are all first-class from Phase 1. Building Synthesize first and bolting on the rest produces an avatar tool that loses every local business in week three.

**Two additions the user has specified for this version:**

3. **Agent-first and autonomous.** SPARK is the product; the UI is a supervision surface over an agent that is already working. Autopublish is ON by default for active campaigns (PRD §7.1); approvals are an optional control layer.
4. **Every feature is a tool.** There is one implementation of every capability, registered in a tool registry, callable by both the React client and the agent loop. If a button exists that SPARK cannot press, that is a defect.

---

## 1. Governing principles

**P1 — One tool layer, two callers.**
Every capability is a versioned tool with a schema, a permission scope, an autonomy class, a cost estimate, and an audit record. The React client calls it through a generated typed client. SPARK calls it through the model's tool loop. Both write to the same `tool_calls` table. This is what makes the product genuinely agentic rather than a UI with a chatbot attached.

**P2 — Fit is the product; volume is not.**
The failure mode being engineered against is specific: a barbershop receives an AI avatar saying "book your appointment today," a B2B SaaS receives a motivational quote card, and both cancel within 30 days. Every architectural decision below serves fit.

**P3 — Niche is not the primitive.**
Dimensions route; niches describe. A mobile welder, an exam-prep tutor, and a Nigerian tailor must resolve correctly without anyone authoring a rule for them.

**P4 — The unit of delegation is a campaign tied to a business outcome, never a post.**
"Fill Tuesday nights." "Drive 50 trials this month." The mix is *derived from the outcome*. This is the difference between an agent and a scheduler with AI attached.

**P5 — AI generates, code guarantees, the customer supplies reality.**
Generation models make raw material. Deterministic composition (Remotion/FFmpeg) applies the brand system so hex, type, and logo are exact. Ground truth — their face, their product UI, their storefront, their portfolio — supplies the specificity no model can invent.

**P6 — Every agent action is explainable.**
PRD §7.3 requires a visible "why" for trend selection, calendar recommendations, engagement classification, and automation decisions. This is a schema requirement on tool outputs, not a prompt instruction.

---

## 2. Architecture

### 2.1 System shape

```
┌──────────────────────────────────────────────────────────────────────┐
│ React client (Next.js App Router)                                    │
│ Command Center · Calendar · Discovery · Recipes · Engagement ·        │
│ Library · Settings · Agency Portal · Chat Drawer · Agent Timeline     │
└────────────┬─────────────────────────────────────┬───────────────────┘
             │ tRPC (typed, generated from tools)  │ SSE (agent + job stream)
┌────────────▼──────────────┐        ┌─────────────▼────────────────────┐
│ BFF (Next route handlers) │        │ SPARK Runtime (Hono/Node, Fly.io)│
│ auth, RSC reads, webhooks │        │ Claude Agent SDK · orchestrator + │
└────────────┬──────────────┘        │ 9 subagents · memory · policy     │
             │                       └─────────────┬────────────────────┘
             └──────────────┬──────────────────────┘
                            ▼
        ╔═══════════════════════════════════════════════════════╗
        ║  TOOL REGISTRY — the only door to every capability      ║
        ║  schema · scope · autonomy · budget · idempotency ·     ║
        ║  guardrails · audit · explainability                    ║
        ╚═══════════════╤═══════════════════════╤═══════════════╝
                        │                       │
        ┌───────────────▼──────────┐  ┌─────────▼─────────────────────┐
        │ Domain services          │  │ Durable workflows (Trigger.dev)│
        │ genome · assets · mix    │  │ genesis · campaign plan ·      │
        │ campaigns · engagement   │  │ synthesize · assemble ·        │
        │ publishing · governance  │  │ capture loop · finish · learn  │
        └───────────────┬──────────┘  └─────────┬─────────────────────┘
                        │                       │
   ┌────────────────────▼───────────────────────▼──────────────────────┐
   │ Postgres + pgvector · Redis · R2 · Mux                              │
   │ HeyGen · ElevenLabs · fal.ai · Ideogram/Flux · Canva · Stock        │
   │ Remotion Lambda · FFmpeg workers · Playwright capture               │
   │ WhatsApp Cloud API · AssemblyAI · Dub · Platform APIs + aggregator  │
   └─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Frontend** | **React 19 + Next.js 15 App Router, TypeScript** | Per requirement. RSC for fast queue/calendar reads, route handlers for BFF + webhooks, one repo. |
| Styling | Tailwind + shadcn/ui, fully restyled to prototype tokens | `.dc.html` values are Figma-exact and authoritative. |
| Motion | Framer Motion | Drawer slides, generation states, streaming reveals, press-and-hold (`ONB-06`). |
| Client state | TanStack Query + Zustand | Server cache w/ optimistic tool calls; overlay/drawer/wizard state. |
| Typed RPC | tRPC, **generated from tool schemas** | Guarantees the UI cannot diverge from the tool layer. |
| **Agent runtime** | **Claude Agent SDK (TypeScript) on Hono, Fly.io** | Long-lived SSE without serverless timeouts; native subagents, tool loop, context compaction, hooks for policy enforcement. |
| Models | Opus (orchestration, planning, creative direction, judging) · Sonnet (bulk copy, briefs, replies, classification at volume) · Haiku (routing, intent tagging, moderation prefilter) | Cost/quality tiering; ~80% of calls should land on Sonnet or Haiku. |
| **Durable workflows** | **Trigger.dev v3** | Multi-minute renders *and* multi-day human waits (capture briefs). Checkpointed steps, retries, per-step observability. Temporal is the swap if run volume outgrows it. |
| **Database** | **Postgres (Neon) + Drizzle + pgvector** | Branch-per-preview; embeddings colocated with relational data; RLS as defence-in-depth. |
| Embeddings | `text-embedding-3-large` @ 1536 dims | Mandated by the engine spec for ClientForce consistency. |
| Cache / locks / rate limits | Upstash Redis | Idempotency keys, per-workspace token buckets, platform rate-limit budgets. |
| Object storage | Cloudflare R2 | Zero egress — the dominant cost lever for a media product. |
| Video delivery | Mux | Transcode, adaptive streaming, thumbnails, renditions. |
| **Deterministic composition** | **Remotion + Remotion Lambda** (brand-system renders) · **FFmpeg workers** (Finish pipeline) | Remotion for templated brand output; FFmpeg for raw phone footage → publishable. Two different jobs, don't conflate. |
| Avatar / talking head | **HeyGen** (Direct API) | PRD Tier 1 anchor. Video Agent, avatar, talking-photo, dubbing to 175+ languages, MCP + API, SOC2. |
| Voice | **ElevenLabs** | Standalone for non-avatar audio: audiograms, VO b-roll, sound-on Reels. |
| Generative image | **Ideogram / Flux class via fal.ai** | Text-legible social graphics. Own-infra option deferred (open decision). |
| Generative video | fal.ai gateway (Seedance / Veo / Runway as endpoint strings) | Only for genuinely generative b-roll — not the default path. |
| Format fan-out | **Canva** (MCP, already connected) | One concept → the 8 aspect ratios each channel demands. |
| Stock media | Pexels + Unsplash + Pixabay behind one normalized connector | B-roll and backgrounds. |
| Captions | AssemblyAI (Whisper fallback) | Burned-in captions are table stakes for short form; HeyGen only captions its own output. |
| Screen/site capture | **Playwright service** (Fly machines) | Workflow clips, portfolio-in-motion, teardowns, before/afters. |
| Capture-loop channel | **WhatsApp Business Cloud API** (Iyobo surface), push/in-app secondary | Matches the Nigerian SMB motion; the delivery path for capture briefs. |
| Link attribution | Dub | Tracked links + UTM on every posted link; feeds learning + ClientForce. |
| Auth | Clerk (Organizations = Org, sub-orgs = Brands) | Maps to PRD's Org → Brand → roles model. |
| Realtime | SSE (agent + job progress) | Simpler than a broker; add Ably only if fan-out demands it. |
| Observability | Langfuse (traces/prompts/cost) + OpenTelemetry + Sentry | Every agent run replayable — required for the "why" surface. |
| Evals | Promptfoo/Braintrust + golden set in repo | §11. |
| Analytics / flags | PostHog | Gates autonomy rollout. |
| Deploy | Vercel (web) · Fly.io (agent, capture, FFmpeg) · Trigger.dev cloud | — |

### 2.3 Repo layout (Turborepo + pnpm)

```
apps/
  web/                Next.js React client + BFF + platform webhooks
  spark/              Agent runtime: orchestrator, subagents, memory, SSE
  workflows/          Trigger.dev task definitions
  capture/            Playwright screen/site capture service
  finish/             FFmpeg workers (trim, stabilize, caption, export)
  remotion/           Brand-system compositions + playbook beat templates
packages/
  tools/              ★ TOOL REGISTRY — schemas, policy, middleware, handlers
  db/                 Drizzle schema, migrations, repositories (scope-enforced)
  genome/             Genome schema, inference pass, versioning
  assetgraph/         Roles, captioning, embedding, retrieval, gap detection
  playbooks/          Playbook records (data), resolver, mix engine
  guardrails/         Claim grounding, compliance, voice, saturation, dupe, rights
  publishing/         Platform adapters + aggregator adapter, rate budgets
  learning/           Metric ingestion, Thompson sampler, exploration floor
  ui/                 shadcn-derived components built to prototype tokens
  shared/             Types, errors, cost model, zod schemas, explainability
```

---

## 3. The Tool Layer

Build this **before any screen**. Everything else is a consumer of it.

### 3.1 Tool contract

```ts
export const defineTool = <I extends ZodType, O extends ZodType>(t: {
  name: string;                  // "campaign.propose_plan"
  version: number;
  summary: string;               // written FOR THE MODEL — this is prompt surface
  input: I;
  output: O;                     // must include `why?: Explanation` for agent-visible decisions
  effect: 'read'|'write'|'external'|'spend'|'publish'|'destructive';
  autonomy: 'auto'|'confirm'|'approval'|'human_only';
  scopes: Role[];                // owner|admin|editor|approver|viewer|client
  guardrails?: GuardrailId[];    // run before handler, can block
  estimateCents?: (i: In<I>) => number;
  idempotent: boolean;
  surfaces?: string[];           // PRD UI flow IDs that bind to it, e.g. ['CAL-03']
  handler: (i: In<I>, ctx: ToolCtx) => Promise<Out<O>>;
});
```

`ToolCtx = { orgId, brandId, genomeId, userId, role, runId, budget, approvalMode, db, logger, trace }`.

**Middleware chain, applied identically to human and agent calls:**
`authn → role scope → org/brand/genome isolation → autonomy policy → guardrails → budget + credit check → rate limit → idempotency → execute → audit (tool_calls) → cost record → explainability capture → trace emit → queue/event fanout`

**Hard rules**
- Genome isolation is a **mandatory query predicate in the repository layer**, not a UI filter. An agency client's assets must never surface in another client's retrieval, including via embedding search.
- Every tool whose output drives a user-visible agent decision must return a structured `why` (rule fired, evidence asset IDs, score, alternatives considered). PRD §7.3 is a schema contract.
- `effect: 'publish'` tools always run the full guardrail chain regardless of autonomy level.

### 3.2 Registry — every PRD feature as a tool

Target ~135 tools at GA. Grouped by family, with the PRD module each serves.

**`org.*` / `brand.*` / `team.*`** — Settings, Agency Portal (`SET-ORG-01`, `SET-WS-01`)
`org.create` · `org.billing.plan.set` · `org.credits.grant` · `org.security.sso.configure` · `org.audit.query` · `org.governance.set` · `brand.create` · `brand.settings.patch` · `brand.knowledge.attach` · `brand.import` · `brand.export` · `team.invite` · `team.role.set` · `team.permission.set` · `whitelabel.link.create`

**`genome.*`** — Onboarding (`ONB-01`→`ONB-06`)
`genome.bootstrap_from_url` · `genome.infer` · `genome.get` · `genome.patch_chip` · `genome.confirm` · `genome.dimensions.set` · `genome.version.bump` · `genome.voice.derive` · `genome.compliance.classify`

**`asset.*` / `knowledge.*`** — Asset Library / Asset Graph (`LIB-01`, `LIB-02`)
`asset.upload` · `asset.ingest_url` · `asset.ingest_inbound` (WhatsApp/SMS media) · `asset.caption` · `asset.embed` · `asset.role.assign` · `asset.quality_score` · `asset.rights.set` · `asset.retrieve` (intent + required roles + constraints) · `asset.gaps` · `asset.cooldown.check` · `asset.folder.create` · `asset.folder.move` · `asset.reuse` · `knowledge.ingest_site` · `knowledge.ingest_docs` · `knowledge.ground_claim`

**`playbook.*` / `mix.*`** — Content Engine core
`playbook.list` · `playbook.get` · `playbook.resolve` (returns ranked + unlockable) · `playbook.explain` · `mix.defaults` · `mix.derive_from_outcome` · `mix.adjust` · `mix.explain`

**`campaign.*`** — Agents & Campaigns (`AGT-01`, `CMP-01.1`→`CMP-01.6`)
`campaign.create_from_outcome` · `campaign.propose_plan` · `campaign.gap_report` · `campaign.activate` · `campaign.pause` · `campaign.resume` · `campaign.adjust_mix` · `campaign.duplicate` · `campaign.report_vs_outcome`

**`calendar.*`** — Calendar (`CAL-01`→`CAL-06`)
`calendar.plan_generate` · `calendar.fill_week` · `calendar.slot.suggest` · `calendar.schedule` · `calendar.reschedule` · `calendar.impact_preview` · `calendar.rebalance` · `calendar.filter`

**`draft.*`** — Content Creation & Draft Packs (`CC-02`, `CC-02A`, `CC-04`)
`draftpack.create` · `draft.copy.write` · `draft.hook.write` · `draft.cta.attach` · `draft.regenerate_section` · `draft.edit` · `draft.variants` · `draft.repurpose` · `draft.place` (accounts + date + publish mode)

**`synthesize.*`** — Mode 1
`synthesize.avatar_video` (HeyGen) · `synthesize.talking_photo` · `synthesize.voiceover` (ElevenLabs) · `synthesize.image` · `synthesize.video` (fal) · `synthesize.quote_card` · `synthesize.carousel` · `synthesize.dub`

**`assemble.*`** — Mode 2
`assemble.screen_capture` (Playwright, scripted workflow) · `assemble.site_capture` · `assemble.before_after` · `assemble.result_card` · `assemble.montage` · `assemble.testimonial_snippet` · `assemble.data_insight` · `assemble.comparison` · `assemble.changelog`

**`direct.*` / `finish.*`** — Mode 3, the capture loop
`direct.brief.generate` · `direct.brief.validate` (quality bar gate) · `direct.session.batch` · `direct.session.send` (WhatsApp/push) · `direct.media.ingest` · `direct.media.quality_check` · `direct.reshoot.request` · `direct.fallback.degrade` · `finish.trim` · `finish.stabilize` · `finish.caption_burn` · `finish.hook_overlay` · `finish.music_bed` · `finish.export_aspects`

**`compose.*`** — Deterministic brand application
`compose.render` (Remotion, playbook beats) · `compose.static` (Satori) · `compose.fanout` (Canva formats)

**`guard.*`** — Guardrail layer (PRD §9, engine spec §10)
`guard.claim_grounding` · `guard.compliance_profile` · `guard.brand_voice` · `guard.avatar_saturation` · `guard.duplicate` · `guard.platform_policy` · `guard.rights` · `guard.explain`

**`publish.*` / `integration.*`** — Publishing
`publish.now` · `publish.schedule` · `publish.retry` · `publish.status` · `publish.rollback` · `integration.connect` · `integration.health` · `integration.scopes.verify` · `integration.rate_budget`

**`engage.*`** — Engagement Intelligence (`ENG-01`→`ENG-02.4`)
`engage.ingest` · `engage.classify` · `engage.intent_score` · `engage.reply.draft` · `engage.reply.send` · `engage.autohandle` · `engage.escalate` · `engage.takeover` · `engage.opportunity.create` · `engage.opportunity.route` · `engage.eligibility.check` · `engage.audit.query`

**`trend.*`** — Trend Discovery (`DISC-01`, `DISC-02`)
`trend.fetch` · `trend.rank` (volume/velocity/saturation/relevance) · `trend.detail` · `trend.safety_filter` · `trend.repurpose` · `trend.reshare` · `trend.watchlist.set` · `trend.explain`

**`recipe.*`** — Automation Recipes (`AUTO-01`→`AUTO-04.4`)
`recipe.create` · `recipe.source.connect` (CSV/Canva/Drive/Folder/RSS) · `recipe.trend_query.set` · `recipe.preview` · `recipe.validate` · `recipe.schedule.set` · `recipe.run` · `recipe.pause` · `recipe.queue.list` · `recipe.run_log`

**`analytics.*` / `learning.*`** — Performance & Learning (`CC-04`)
`analytics.sync` · `analytics.post_metrics` · `analytics.campaign_report` · `analytics.cta_traffic` · `learning.ingest` · `learning.reweight` (Thompson) · `learning.exploration_floor.enforce` · `learning.confidence` · `learning.freeze` · `learning.reset` · `learning.explain`

**`queue.*` / `approval.*`** — Queues as first-class (PRD §7.5)
`queue.plan.list` · `queue.review.list` · `queue.automation.list` · `queue.engagement.list` · `approval.request` · `approval.decide` · `approval.policy.set`

**`agent.*` / `human.*`** — Command Center controls (`CC-01`)
`agent.status` · `agent.pause` · `agent.resume` · `agent.frequency.set` · `agent.approval_mode.set` · `agent.explain` · `human.ask` · `human.notify` · `whatsapp.send` · `whatsapp.receive`

### 3.3 Autonomy classes mapped to PRD governance

| Tool set | Default class | Escalates to `approval` when |
|---|---|---|
| Read/query, planning, drafting, retrieval | `auto` | never |
| `synthesize.*`, `assemble.*`, `compose.*` | `auto` | workspace sets "approval required for media generation" |
| `direct.session.send` | `auto` | never (it's a request, not a publish) |
| `calendar.schedule` | `auto` | "approval before scheduling" enabled |
| `publish.*` | `auto` **(autopublish default ON per PRD §7.1)** | approvals ON · guardrail flag · restricted content type/platform · strict mode |
| `engage.reply.send` | `confirm` | always in first 14 days; `auto` only after eligibility + configured autonomy |
| Billing, members, integrations, `destructive` | `approval` (owner/admin) | always |

The policy engine is a pure function `evaluate(tool, input, ctx) → allow | confirm | approval | deny(reason, rule_id)` in `packages/tools/policy.ts` — unit tested to 100% branch coverage. Guardrail blocks return the triggering rule and a recommended fix action (PRD §9).

---

## 4. The SPARK agent system

### 4.1 Topology

One orchestrator, nine specialists. Subagents run in isolated context windows with narrowed toolsets and return structured results, which keeps the orchestrator's context clean across month-long campaigns.

| Agent | Responsibility | Primary tools | Model |
|---|---|---|---|
| **SPARK** (orchestrator) | User conversation, intent → delegation, chat drawer commands, explainability | `human.*`, `agent.*`, delegation | Opus |
| **Genesis** | Workspace setup: crawl, infer, play back chips, seed Asset Graph | `genome.*`, `knowledge.*`, `asset.ingest_*` | Opus |
| **Planner** | Outcome → volume, platforms, mix, calendar, gap report | `campaign.*`, `mix.*`, `playbook.resolve`, `calendar.*` | Opus |
| **Curator** | Asset retrieval, gap detection, cooldown, rights | `asset.*` | Sonnet |
| **Director** | Per-slot brief, playbook beat filling, copy, hooks, CTA | `draft.*`, `knowledge.ground_claim` | Opus |
| **Producer** | Executes the three pipelines; renders and exports | `synthesize.*`, `assemble.*`, `finish.*`, `compose.*` | Sonnet |
| **Field** | Capture loop: briefs, batching, WhatsApp, ingest, quality, reshoot, fallback | `direct.*`, `whatsapp.*` | Sonnet |
| **Warden** | Guardrails + engagement: classification, replies, escalation, opportunities | `guard.*`, `engage.*` | Sonnet (Haiku prefilter) |
| **Scout** | Trend discovery, ranking, brand-safety, repurpose candidates | `trend.*` | Sonnet |
| **Analyst** | Metrics ingestion, outcome reporting, mix reweighting, memory distillation | `analytics.*`, `learning.*` | Sonnet |

Long-running work never blocks the agent loop: the tool enqueues a Trigger.dev run and returns a `jobId`; progress streams to the UI over SSE and returns to the agent's context on completion.

### 4.2 Memory

1. **Working** — current run, SDK-compacted.
2. **Genome** — the structured profile (§6.1). The durable "who is this customer."
3. **Learned** — `genome.learned` populated by the Analyst: top formats, best times, mix overrides, confidence. Deferred to template defaults until `confidence > 0.4`.
4. **Episodic** — `memories` (pgvector): user corrections, rejected phrasings, standing instructions ("never post before 9am," "don't use my co-founder's face"). Written on every reject/edit.

Cross-workspace learning aggregates **statistics only** (playbook × dimension-profile × platform → lift), never content or assets, and lands as versioned updates to playbook priors. Off by default per workspace.

### 4.3 Autonomy ladder (workspace setting, PRD-aligned)

| Level | Behaviour | Recommended for |
|---|---|---|
| **Review everything** | Every publish and reply gated | Agencies, regulated verticals |
| **Review first week, then autopublish** | Gate for 7 days, then release | **The recommended default** — this is the setting that gets people to autopublish |
| **Autopublish** | Publish + reply within guardrails; human notified, not asked | Established SMB accounts |

Kill switch: `agent.pause` halts every scheduled run and in-flight publish immediately, org-wide or brand-scoped.

### 4.4 Queues are agent state, rendered

The four PRD queues (Plan, Review, Automation, Engagement) are projections over `content_items`, `approvals`, `recipe_runs`, and `inbox_items` — not separate stores. Each item carries its originating `run_id` so "why is this here?" resolves to a trace.

### 4.5 The Agent Timeline

A persistent surface (right rail + `/activity`) rendering every run: goal, plan, steps, tool calls with collapsed I/O, cost, duration, outcome, inline undo for reversible tools, inline approve/reject for gated ones. This is the trust mechanism that makes autopublish acceptable, and it is a Phase-1 deliverable, not polish.

---

## 5. Data model

Postgres + Drizzle. Every table carries `org_id`; brand-scoped tables carry `brand_id`; content and asset tables carry `genome_id`. RLS mirrors the repository predicates.

```
── Identity & tenancy ──────────────────────────────────────────────
orgs                  id, name, plan, credits, security jsonb, governance jsonb
brands                id, org_id, name, slug, timezone, logo, status
users                 id, email, name, avatar
memberships           org_id, brand_id?, user_id, role(owner|admin|editor|approver|viewer|client)
permissions           brand_id, key, value           -- publish, spend, auto_publish, etc.
audit_log             org_id, actor, action, target, before, after, at

── Brand Genome ────────────────────────────────────────────────────
genomes               id, brand_id, version, identity jsonb, dimensions jsonb,
                      voice jsonb, audience jsonb, offer jsonb, constraints jsonb,
                      learned jsonb, embedding vector(1536)
genome_revisions      genome_id, version, diff jsonb, source(user|inference|learning), at

── Asset Graph ─────────────────────────────────────────────────────
assets                id, genome_id, folder_id?, media_type, asset_role, storage_path,
                      mux_id?, caption, embedding vector(1536), quality jsonb,
                      rights_status, usage_count, last_used_at, source, provenance jsonb
folders               id, genome_id, name, created_at
knowledge_docs        id, genome_id, kind(site|doc|helpcenter|pdf), url?, chunks_indexed
knowledge_chunks      doc_id, text, embedding vector(1536), citation jsonb
asset_gaps            genome_id, missing_role, blocked_playbook_id, impact, brief_id?, at

── Playbooks & mix ─────────────────────────────────────────────────
playbooks             id, version, name, mode(synthesize|assemble|direct_finish),
                      preconditions jsonb, output jsonb, structure jsonb,
                      objective_fit jsonb, content_pillar, saturation_risk,
                      compliance_flags jsonb, is_active
playbook_resolutions  genome_id, genome_version, ranked jsonb, unlockable jsonb, at
mix_profiles          campaign_id, pillar_weights jsonb, source(default|derived|user), at

── Agents & campaigns ──────────────────────────────────────────────
agents                id, brand_id, alias, avatar, voice_asset_id?, status
campaigns             id, brand_id, genome_id, agent_id, outcome jsonb,
                      derived_mix jsonb, derived_volume jsonb, platforms[],
                      window tstzrange, approval_mode, status
content_items         id, campaign_id, genome_id, playbook_id, mode, pillar,
                      status(draft|needs_review|approved|scheduled|published|failed|blocked),
                      scheduled_at, platform, copy jsonb, why jsonb, run_id
draft_packs           id, campaign_id?, brief jsonb, items[]           -- CC-02 output
renders               id, content_item_id, aspect, storage_path, mux_id, engine, cost_cents
guardrail_results     content_item_id, guard_id, verdict, rule, evidence jsonb, fix_action

── Capture loop ────────────────────────────────────────────────────
capture_sessions      id, genome_id, campaign_id, channel, status, sent_at, due_at
capture_briefs        id, session_id, playbook_id, subject, framing, orientation,
                      duration_sec, motion, audio, lighting, do_not jsonb,
                      estimated_effort_sec, expires_at, status, validator_score
capture_submissions   brief_id, asset_id, quality jsonb, verdict(accept|reshoot), reason

── Publishing & engagement ─────────────────────────────────────────
integrations          brand_id, platform, account_handle, scopes jsonb,
                      tokens_encrypted, health, last_checked_at
publications          content_item_id, platform, external_id, published_at, permalink,
                      status, error, short_link_id
inbox_items           id, brand_id, platform, external_id, author jsonb, text, media jsonb,
                      classification, intent_score, sentiment, why jsonb,
                      status(needs_review|suggested|auto_handled|escalated), assigned_to
opportunities         inbox_item_id, temperature(hot|warm|cold), recommended_action, routed_to
engagement_rules      brand_id, intent, action, tone, guardrails jsonb, autonomy

── Discovery & automation ──────────────────────────────────────────
trends                id, source, topic, metrics jsonb, series jsonb, samples jsonb,
                      brand_relevance, safety_verdict, fetched_at
watchlists            brand_id, keywords[], influencers[], regions[], languages[]
recipes               id, brand_id, kind(autotrend|bulk|rss), config jsonb, schedule jsonb,
                      review_before_publish, status, last_run_at, next_run_at
recipe_runs           recipe_id, started_at, status, produced[], error

── Agent & governance spine ────────────────────────────────────────
agent_runs            id, brand_id, agent, goal, trigger(user|schedule|event), status,
                      cost_cents, tokens, trace_id, parent_run_id
agent_steps           run_id, idx, type(think|tool|delegate|wait), payload jsonb, ms
tool_calls            id, run_id?, user_id?, tool, version, input jsonb, output jsonb,
                      effect, decision(allow|confirm|approval|deny), rule_id?,
                      cost_cents, idempotency_key, status, error, why jsonb, at
approvals             id, brand_id, subject_type, subject_id, requested_by, status,
                      decided_by, decided_at, note
autonomy_policies     brand_id, tool_family, level, thresholds jsonb, quiet_windows jsonb
memories              genome_id, kind, text, embedding vector(1536), confidence,
                      source_run_id, expires_at

── Learning & cost ─────────────────────────────────────────────────
post_metrics          publication_id, reach, watch_through, saves, comments, clicks,
                      conversions, captured_at
playbook_arms         genome_id, playbook_id, alpha, beta, impressions, last_updated
credit_ledger         org_id, brand_id?, delta, reason, tool_call_id?, at
eval_runs             suite, commit_sha, scores jsonb, at
```

**Non-negotiable isolation rule:** `assets`, `knowledge_chunks`, and `memories` are queried only through repository functions that require a `genome_id` predicate. Vector search included. An agency's client separation depends entirely on this, and it must be enforced with a test that fails the build if a raw query bypasses it.

---

## 6. The Content Engine

Authoritative source: `sparksocial-content-engine-spec_1.md`. This section is the engineering expansion.

### 6.1 Brand Genome — five questions, then infer

Workspace setup asks **five things** and infers the rest. A dropdown of 200 industries is the wrong design; every additional field costs completion.

| # | User-facing question | Populates | Tool |
|---|---|---|---|
| 1 | "Paste your website or Instagram." | category, offer, tone, price tier, geography, language, visual identity — **~70% of the profile** | `genome.bootstrap_from_url` |
| 2 | "Is there someone willing to be the face of this?" | `talent_availability` | `genome.dimensions.set` |
| 3 | "What can you show me?" (icon multi-select: screen / space / finished work / product / nothing yet) | `capture_capability`, `proof_asset` — **the most important question in the flow** | `genome.dimensions.set` |
| 4 | "What does a good month look like?" | `objective` | `genome.dimensions.set` |
| 5 | "Show me what you already have." (connect socials, upload, Drive, help center) | Asset Graph seed + past posts **with their performance** | `asset.ingest_*`, `knowledge.ingest_*` |

Then SPARK **plays the profile back as editable chips**, not a form. Confirmation is cheap; data entry is churn. This confirmation step is what makes the profile feel understood rather than collected.

The four `dimensions` are the routing key for the entire engine — index them, cache resolutions against `genome.version`, and invalidate on bump.

**Maps to PRD:** `ONB-01`→`ONB-06`. The existing onboarding steps stay; their *content* changes from form-filling to inference + confirmation.

### 6.2 Asset Graph

Not a new UI. It is the existing Asset Library (`LIB-01`, `LIB-02`) plus four changes:

1. **Typed** — every asset gets an `asset_role`: `talent_likeness`, `product_screen`, `work_artifact`, `physical_capture`, `product_shot`, `social_proof`, `knowledge`, `past_post`, `brand_kit`.
2. **Captioned + embedded** — vision/audio pass on upload → semantic description → `text-embedding-3-large` @1536.
3. **Retrievable by intent** — the Assemble pipeline queries; the user does not hand-pick files.
4. **Gap-aware** — the graph reports what it *lacks*, which drives the capture loop.

Retrieval ranking = `embedding_score × rights_ok × recency_penalty(last_used_at) × diversity(usage_count)`. Without the recency penalty the same three photos appear every week and the account looks automated.

Gap output is surfaced conversationally by SPARK, never as an error state:
> *"I can plan your month, but I only have four usable photos. Give me 90 seconds of filming and I can build 12 posts instead of 4."*

### 6.3 Playbook library and resolver

~30 records at v1, each a **data record** — adding one must not require a deploy. Preconditions are expressed in genome dimensions and required asset roles, never in niche names.

```
resolve(genome, asset_graph):
  candidates = playbooks where preconditions ⊆ genome.dimensions
  for c in candidates:
     available = required_asset_roles present in graph
     if not available and c.mode != 'direct_finish': drop
     if not available and c.mode == 'direct_finish': mark UNLOCKABLE → capture loop
     score = objective_fit[genome.objective]
           × asset_availability_factor
           × (1 − saturation_penalty)
           × learned_multiplier        # 1.0 until genome.learned.confidence > 0.4
  return ranked, unlockable
```

**v1 set (minimum):**
*Synthesize* — `avatar_pov` · `avatar_explainer` · `voice_over_broll` · `generated_quote_card` · `talking_head_hot_take` · `ai_ugc_testimonial` (rights-gated, disclosure-required) · `carousel_teaching`
*Assemble* — `workflow_clip` · `before_after_transformation` · `result_card` · `portfolio_in_motion` · `changelog_ship_post` · `comparison_vs` · `testimonial_snippet` · `data_insight_post` · `problem_first_education` · `case_study_breakdown` · `teardown_of_other_brands` · `product_in_use_montage`
*Direct + Finish* — `craft_capture` · `staff_personality` · `space_atmosphere` · `customer_reaction` · `day_in_the_life` · `behind_the_build` · `offer_announcement_local` · `seasonal_local_context`

Each playbook declares a **beat structure** (hook / demo / payoff / CTA with durations and sources). Beats map 1:1 onto Remotion composition props, so a new playbook is a data record plus, at most, a template variant.

### 6.4 Mix Engine

Selecting *what* is solved once playbooks resolve. Selecting the **ratio** is where fit is won or lost. The most common failure of AI social tools is ~100% promotional output; no genome profile should exceed 35% promotional, and local businesses sit at 20%.

Cold-start pillar weights (defaults only — they exist to fill the first 30–60 days):

| Genome profile | Educational/Problem | Product/Offer | Proof/Results | Personality/POV | Community/Local |
|---|---|---|---|---|---|
| B2B SaaS | 50% | 25% | 15% | 10% | — |
| Agency | 20% | 10% | 40% | 30% | — |
| Local business | 10% | 20% | 10% | 20% | 40% |
| Freelancer | 35% | 10% | 25% | 30% | — |
| E-commerce | 20% | 35% | 30% | 15% | — |
| Creator/influencer | 20% | 10% | — | 70% | — |

These are keyed off dimension profiles, not niche labels — the table is a lookup on `(proof_asset, objective)` clusters with the segment names as human-readable aliases.

### 6.5 The three pipelines

**SYNTHESIZE** — SPARK makes it from nothing.
`Director brief → script (voice-matched, claim-grounded) → HeyGen avatar / ElevenLabs VO / Ideogram-Flux image / fal video → compose.render (brand type, logo safe zone, LUT) → guardrails → draft`
Avatar defaults **OFF** unless `proof_asset == person`. On for influencers, coaches, consultants, freelancers; founder-POV only for SaaS and agency; off by default for local and e-commerce.

**ASSEMBLE** — SPARK builds from what they already own.
`Director brief → asset.retrieve(intent, roles) → [Playwright capture if product_screen path] → beat assembly → compose.render → guardrails → draft`
This is the highest-value path for SaaS, agency, freelancer, and e-commerce, and the most under-built path in every competing product. `workflow_clip` alone — one workflow, 15–30s, screen recorded, "this used to take four hours" hook — is the highest intent-to-trial format available to a SaaS company.

**DIRECT + FINISH** — SPARK tells a human exactly what to film, then finishes it.
```
resolver flags unlockable playbook
  → direct.brief.generate  (subject, framing, orientation, duration, motion, audio, lighting, do-not)
  → direct.brief.validate  (rejects vague briefs before send — hard gate)
  → direct.session.batch   (3–5 briefs, ~5 min total, ONE weekly sitting — never daily nags)
  → direct.session.send    (WhatsApp Cloud API first; push/in-app secondary)
  → owner films on phone, replies with media
  → direct.media.ingest → quality_check (blur, exposure, shake, duration)
       ↳ below threshold → direct.reshoot.request with a specific reason
  → asset stored as physical_capture
  → FINISH: trim dead space → stabilize → colour → burn captions (locale-correct)
       → hook overlay in brand typography → licensed audio bed → export 9:16 / 1:1 / 16:9
  → draft → approval_mode
```
**Fallbacks are mandatory.** If no capture arrives inside the window, `direct.fallback.degrade` substitutes an Assemble or Synthesize playbook. The calendar must never go empty because a human did not film.

This mode is the moat. It is the only reason a local business stays subscribed, and no major competitor runs it. It is also the piece most likely to be technically underestimated — **build it in Phase 1, not Phase 3.**

### 6.6 Guardrail layer

Every draft passes before it can be scheduled. Each guard returns `verdict + rule + evidence + fix_action`.

| Guard | Rule |
|---|---|
| **Claim grounding** | Any factual claim about a product, price, result, or feature must trace to a `knowledge` or `social_proof` asset. Ungrounded specifics are stripped or the draft is rejected. This is the #1 credibility risk for SaaS — a founder who catches SPARK describing a feature that doesn't exist churns immediately and tells people. |
| **Compliance profile** | `health` / `finance` / `legal` / `regulated_other` genomes carry forbidden-phrase lists and required disclaimers. Hard block on violation. Do not ship these verticals without it. |
| **Brand voice** | Banned phrases from genome; tone-vector distance against approved samples. |
| **Avatar saturation** | Cap avatar output as a share of total. `avatar_enabled` defaults false when `proof_asset != person`. Prevents cross-account convergence and platform suppression. |
| **Duplicate/repetition** | Semantic similarity against the trailing 90 days of that genome's published posts; asset reuse cooldown. |
| **Platform policy** | Per-platform length, hashtag, link, and disclosure rules; AI-media disclosure where required. |
| **Rights** | Music licensing, UGC permission, client-asset scope, likeness consent with timestamp and scope. |

### 6.7 Learning loop

```
inputs : post_metrics (reach, watch-through, saves, comments, clicks, conversions)
         joined to playbook_id + pillar
method : Thompson sampling over playbook arms, with pillar-level floors
         so the engine cannot collapse into one format
output : genome.learned.mix_weights_override, genome.learned.confidence
```

Enforce a **permanent 20% exploration floor**. Without it the engine over-fits to whatever won in week three and the account goes stale. Defer to cold-start defaults until `confidence > 0.4`.

This is the compounding moat: a competitor can clone the playbook library in a month; they cannot clone 90 days of a specific customer's performance history.

### 6.8 Campaign flow — outcome first, never format first

```
CAMPAIGN SETUP
  Step 1  Outcome. Presets tuned to genome (fill quiet days / book calls / drive trials /
          launch / sell / grow audience / fill cohort / hire) + free text. Then two
          follow-ups only: target & window; offer or hook if implied. STOP asking.
  Step 2  SPARK proposes the plan — volume, platforms, mix, and the reasoning. Not a form.
  Step 3  Gap report + capture plan: "9 posts now, 24 if you film 6 minutes, one sitting."
          Stating the reasoning, exposing the gap honestly, and quantifying human effort
          is what converts.
  Step 4  Review the CALENDAR at mix level, not the posts. Slots labelled by type —
          Craft · Team · Offer · Community. Adjust with "less offer, more craft" and
          regenerate. If the user has to open all 24 posts, the product failed.
  Step 5  Approval mode. Recommend "review first week, then autopublish" explicitly —
          it is the setting that gets people to autopublish at all.
  Step 6  Report against the STATED OUTCOME, not vanity metrics. "You wanted 40 bookings.
          You're at 27 with nine days left. Craft is doing 3× offer, so I'm shifting four
          offer slots to craft." → reweight → repeat.
```

**Maps to PRD:** `CMP-01.1`→`CMP-01.6`, `CAL-01`→`CAL-06`, `CC-04`.

### 6.9 Agency multi-tenancy

One workspace per agency; one genome per managed client plus one for the agency itself. Playbook resolution, mix weights, and the learning loop run **per client genome**. Approval mode is set per client. Agency-level rollup reporting reads across genomes; **generation never does.** Asset Graph queries are hard-scoped by `genome_id` in the query layer — a UI filter is not sufficient and will eventually leak.

---

## 7. Frontend (React)

### 7.1 Routes → PRD flow IDs

```
/signup /verify /welcome                    AUTH-01 → AUTH-04
/onboarding/[step]                          ONB-01 → ONB-06 (press-and-hold finale)
/                                           DASH-A-01  Account (org) dashboard
/b/[brand]                                  DASH-B-01  Brand home
/b/[brand]/agent                            AGT-01, CC-01  Command Center
  ?chat=open                                CC-02 chat drawer (global overlay, not a route)
  /draft/[id]                               CC-02A draft viewer (intercepted route → panel)
  /place/[id]                               CC-04 placement step
/b/[brand]/calendar                         CAL-01 → CAL-06
/b/[brand]/discovery                        DISC-01, DISC-02
/b/[brand]/recipes                          AUTO-01 → AUTO-04.4
/b/[brand]/engagement                       ENG-01 → ENG-02.4
/b/[brand]/library                          LIB-01, LIB-02
/b/[brand]/activity                         Agent Timeline (new)
/b/[brand]/settings/[section]               SET-WS-01
/settings/[section]                         SET-ORG-01
/agency/[section]                           Agency Portal tiles
```

Draft panel and chat drawer are overlays over any screen (Zustand), matching prototype behaviour. All 22 draft-panel states in the prototype must be built; they are the most intricate surface and should be built **last within each phase**, against a live pipeline.

### 7.2 Components

**Primitives** (restyled shadcn, prototype tokens): Button (+ hold-to-confirm), Input, Textarea, Select, Checkbox, Switch, Tabs, Tooltip, Dialog, DropdownMenu, Avatar, Badge, Progress, Skeleton, Toast.

**Composites:**
`AppShell` · `SidebarNav` (+ brand switcher) · `SparkChatDrawer` · `DraftPanel` (22 states) · `DraftPackViewer` (carousel / captions / reel script / images tabs) · `PlacementStep` · `CalendarGrid` + `DateActionPanel` + `DragImpactPrompt` + `RebalanceSuggestion` · `TrendCard` + `TrendDetail` + `ContentPackPanel` · `RecipeCatalog` + `RecipeWizard` + `AutomationQueue` · `EngagementFeed` (4 tabs) + `ConversationDrawer` + `OpportunityCard` · `AssetGrid` / `AssetTable` · `GenomeChips` (editable inference playback) · `GapReport` · `CaptureSessionCard` + `BriefCard` · `MixSlider` · `QueueList` (Plan/Review/Automation/Engagement) · `AgentTimeline` · `WhyPopover` (renders `why` from any tool output) · `GuardrailBadge` · `AutonomyControl` · `HoldButton` · `GenerationStatus`.

**`WhyPopover` is load-bearing.** PRD §7.3 requires explainability on trend selection, calendar recommendations, engagement classification, and automation decisions. One component, fed by the `why` field every tool returns.

### 7.3 Realtime

SSE from the agent runtime carries: agent tokens, step transitions, job progress, queue deltas, guardrail verdicts. TanStack Query cache is patched from the stream; the Draft Panel's generating states bind directly to step labels.

### 7.4 Fidelity contract

Build → compare side-by-side against the corresponding `.dc.html` → match spacing, type, and colour exactly. Absolute-positioned prototype geometry converts to flex/grid. Desktop ≥1280 first, then tablet and mobile. Dark sidebar and light canvas contexts are CSS variables, never hardcoded classes.

---

## 8. Integrations & approvals

Approvals gate GA regardless of build order. **File the slow tracks in week one**, before a line of publishing code exists.

| Track | Unlocks | Friction | Action |
|---|---|---|---|
| **Meta** (one app, one review) | Facebook Pages/Groups, Instagram, Threads, + listening scopes | App Review 1–3 wks — longest predictable publishing pole | **FILE FIRST.** Bundle publishing + listening scopes in one cycle. |
| **LinkedIn** (Marketing Developer Partner + Community Management) | Profiles, Company Pages, comment/mention handling | **Hardest.** Weeks–months; rejects anything resembling a generic scheduler | **FILE FIRST**, framed as an enterprise agency community-management workflow with a real customer story. Ship behind a "coming soon" flag. |
| **Google** (Cloud project + OAuth verification) | YouTube (long-form, Shorts, Community, comments), Google Business Profile, YouTube trending | Sensitive-scope OAuth audit — weeks | **FILE EARLY.** GBP matters disproportionately for the local segment. |
| **TikTok** (Content Posting + audit) | Video, photo carousels; Creative Center trends | Sandbox audit 1–2 wks; posts invisible until cleared | **FILE EARLY.** Confirm audit cleared before debugging "missing" posts. |
| **X** | Posts, threads, replies, media, polls, trends | Low approval, high cost | File anytime; **the real task is the cost model** (~$0.20/post w/ URL). |
| **Reddit** | Community posts; hot/rising discovery | Budget line (~$12K/yr commercial) | Medium. Highest-value discovery surface for SaaS audiences. Gate posting behind stricter approval — mod rules make automation risky. |
| **Bluesky** | Posts + free firehose | Minimal | **Easy win.** Cheap coverage + free listening. |
| **Pinterest** | Pins, boards, Trends API (beta) | Light | Medium. |
| Snapchat / WordPress / Shopify / Sora | — | — | Defer to v1.1–v2. Sora: monitor, don't build. |
| **Dropped** | Medium (API deprecated), Substack (no official posting API) | — | Skip for a compliant v1. |

**Strategic split:** go **native on the core five** (Meta, X, LinkedIn, TikTok, YouTube) where relationship, data depth, and margin matter; use an **aggregator** (Ayrshare / Blotato / bundle.social bake-off) for the long tail — Pinterest, GBP, Reddit, Bluesky, Threads — to reach GA without waiting on every audit. Revisit bringing the tail in-house post-GA. Build one `PlatformAdapter` interface with both native and aggregator implementations so the swap is a config change.

**Content-engine integrations (no review, API keys only):** HeyGen, ElevenLabs, Ideogram/Flux via fal, Canva (MCP, connected), Pexels/Unsplash/Pixabay, AssemblyAI, Dub, licensed music (v1.1). Provision these in week one — they unblock the entire engine while platform approvals are pending.

---

## 9. Cost, credits, and guardrails on spend

- Record `cost_cents` on every `tool_call`; roll into `credit_ledger` per org/brand.
- **Per-mode cost profile differs by an order of magnitude.** Assemble (Playwright + Remotion + FFmpeg) is near-free compute. Direct+Finish is cheap compute plus a WhatsApp conversation fee. Synthesize (avatar minutes, generative video seconds) is the expensive path — which conveniently aligns with the rule that avatar defaults OFF.
- Draft on cheap tiers, render the approved concept once on the premium tier.
- Per-brand monthly generation budget with soft alert at 80% and hard stop with owner override.
- Judge/retry loop capped at 2 corrective attempts before surfacing to the user with SPARK's notes.
- Instrument from day one; **price after 200 real posts**, not before. Cost per finished post per mode is the number that decides the credit model (open decision #4).

---

## 10. Safety, rights, and consent

- **Likeness consent is a first-class record** with timestamp and scope, required before any face or voice clone. Cloning a third party is blocked at the tool layer, not the prompt layer.
- AI-generated media disclosure applied per platform requirement; `ai_ugc_testimonial` always discloses.
- Compliance profiles (`health`/`finance`/`legal`) block on forbidden phrases and inject required disclaimers. Open decision: gate these verticals until guardrails are proven in production.
- **Prompt-injection containment:** content fetched from the web, from crawled customer sites, from RSS, and from social inboxes is wrapped as untrusted data and can never authorise a tool call. Enforced in the runtime, tested adversarially in the eval suite.
- Reddit and community posting run under stricter approval than other channels.
- Rollback: `publish.rollback` for platforms that support deletion, plus an incident runbook for those that don't.

---

## 11. Evaluation & observability

An autonomous product without an eval harness is an unshippable product. Suites run in CI on every prompt, playbook, or resolver change.

| Suite | What it tests | Bar |
|---|---|---|
| **Genome inference** | URL → dimensions, category, tone, objective | ≥90% dimension accuracy on 60 labelled sites across segments and geographies |
| **Playbook resolution** | Genome → ranked playbooks; no anti-pattern selections (avatar for a barbershop, quote card for B2B SaaS) | Zero anti-pattern selections on the golden set |
| **Mix correctness** | Derived mix vs. expert-authored mix per genome profile | Within ±10 points per pillar; **never >35% promotional** |
| **Claim grounding** | Product claims traceable to knowledge assets | Zero ungrounded specifics; hallucinated-feature rate 0 |
| **Capture brief quality** | Briefs specify subject, framing, orientation, duration, motion, audio, lighting, do-not | 100% pass the validator; human panel rates ≥4/5 on "could film this without thinking" |
| **Finish pipeline** | Raw phone footage → publishable | Blind panel cannot distinguish from human-edited on ≥70% of samples |
| **Guardrails** | Deterministic unit tests incl. adversarial inputs | 100% branch coverage |
| **Engagement safety** | 150 hostile/sensitive messages | Zero auto-replies; all escalate |
| **Isolation** | Cross-genome asset leakage incl. vector search | Zero leaks; build fails on raw-query bypass |
| **Cost regression** | Cost per finished post by mode | No silent upward drift |

**Golden set:** 40 synthetic workspaces spanning all four dimension values, including deliberately awkward long-tail cases — a mobile welder, an exam-prep tutor, a B2B logistics broker, a Nigerian tailor. If those four resolve correctly, the architecture works.

The named acceptance test from the engine spec: **a Lagos barbershop, a Toronto B2B SaaS, and a Manila freelance web designer each answer five questions and receive a month of content a competent human marketer would call correct for that business — with nobody at Tronweb having authored a rule for barbershops, sales-enablement software, or freelance web design.** The tell: the barbershop's month is ~50% haircut footage SPARK told the owner how to film, and the SaaS month is ~50% education that mentions the product twice — out of the same engine, un-tuned.

---

## 12. Build phases

Phases have hard exit criteria. **Do not reorder P2** — the capture loop is the differentiator and the piece most likely to be underestimated. If it slips, we ship the same product as everyone else.

### P0 — Foundation (2–3 weeks)
Monorepo · Neon + Drizzle + pgvector · Clerk org/brand/roles · R2 · design tokens from `.dc.html` → `tailwind.config.ts` · shadcn primitives restyled · `AppShell` + `SidebarNav`.
**In parallel, week 1:** file Meta, LinkedIn, Google, TikTok approvals; provision HeyGen, ElevenLabs, fal, Canva, stock, AssemblyAI, WhatsApp keys.
*Exit:* token-accurate shell matching prototype side-by-side; all approval tracks filed.

### P1 — Tool layer + SPARK runtime (2–3 weeks) ★ keystone
`defineTool`, middleware chain, policy engine, guardrail hooks, `tool_calls` audit, tRPC generation from schemas, Hono agent service, Claude Agent SDK loop, subagent scaffolding, SSE, Langfuse tracing, Agent Timeline v1, queue projections.
*Exit:* the same action performed by clicking and by asking SPARK produces identical `tool_calls` rows with identical guardrail evaluation. Timeline replays a run.

### P2 — Genome + Asset Graph + capture loop (4 weeks)
Genome schema + 5-question onboarding + inference pass + chip playback (`ONB-01`→`ONB-06`) · Asset Library extended with roles, captioning, embeddings, retrieval, gap detection · playbook library (~15 records) + resolver · **Assemble pipeline** (Playwright capture, beat assembly, Remotion render) · **Direct+Finish end to end over WhatsApp** + Finish pipeline (trim/stabilize/caption/hook/music/export) · default mix weights · guardrails v1.
*Exit:* a genome is produced from a URL in under 3 minutes; assets retrievable by intent; **one real local business runs a full month on capture briefs alone and stays.**

### P3 — Synthesize + campaigns + calendar (3 weeks)
HeyGen avatar + ElevenLabs voice clone with consent records · generative image/video · full 30-playbook library · campaign-as-outcome unit (`CMP-01.*`) · plan proposal + gap report + mix-level calendar review (`CAL-01`→`CAL-06`) · Command Center + chat drawer + draft packs (`CC-01`→`CC-04`) · Draft Panel 22 states · approval modes.
*Exit:* campaign objective in → 30-day calendar out, across all three modes, mix-reviewable, autopublish-capable.

### P4 — Publishing + engagement (3 weeks)
Native adapters for core five + aggregator adapter for the tail · scheduling, retry, health, rate budgets · Dub link attribution · analytics sync · unified inbox, classification, intent scoring, suggested replies, auto-handled, sales opportunities, escalation (`ENG-01`→`ENG-02.4`) · engagement eligibility gate.
*Exit:* scheduled post publishes to three platforms and metrics return within 48h; hostile-message suite passes with zero auto-replies.

### P5 — Discovery + automation (2–3 weeks)
Trend fetch/rank/safety/detail + repurpose and reshare (`DISC-01`, `DISC-02`) · AutoTrend, Bulk Connector (CSV/Canva/Drive/Folder), RSS recipes with preview, validation, schedule, output queue (`AUTO-01`→`AUTO-04.4`).
*Exit:* a recipe runs unattended for two weeks producing on-brand, non-duplicate output within budget.

### P6 — Learning + agency (3 weeks)
Metric ingestion → Thompson sampling reweighting → exploration floor → confidence · outcome-based reporting · agency multi-genome with hard isolation, per-client approval modes, rollup reporting, white-label review links · Agency Portal tiles · billing, credits, usage alerts.
*Exit:* `genome.learned.confidence > 0.4` for the pilot cohort with measurable lift over cold-start defaults; isolation test suite green.

### P7 — Hardening & GA
Approval tracks cleared · load and cost testing · incident runbooks · mobile/tablet passes · compliance vertical decision · pricing from real cost data.

**Critical path is not the code.** LinkedIn and Meta approvals are the longest poles. Sequence engineering so that P2–P3 (engine, which needs no platform approval) runs while approvals are in flight, and P4 lands as they clear.

---

## 13. Workstreams and open decisions

### Parallel workstreams after P1

| Stream | Owns | Can run independently |
|---|---|---|
| **A — Engine** | Genome, Asset Graph, playbooks, resolver, mix, three pipelines, guardrails | Yes — no platform approval needed |
| **B — Surfaces** | React app, all PRD screens, prototype fidelity, Agent Timeline | Yes — against tool mocks |
| **C — Distribution** | Platform adapters, approvals, aggregator, publishing, analytics | Blocked on approvals; start with aggregator |
| **D — Capture** | WhatsApp, brief generation/validation, ingest, quality, Finish pipeline | Yes — highest risk, staff it first |
| **E — Platform** | Tool registry, policy, observability, evals, cost, isolation tests | Yes — gates everyone else |

### Open decisions to close before P2 ends

1. **Avatar/voice vendor** — HeyGen + ElevenLabs (recommended, per PRD Tier 1) vs. build. Consent records are first-class regardless.
2. **Finish pipeline compute** — self-hosted FFmpeg workers vs. managed video API. Model cost per finished post at 10k posts/month before committing; this is the dominant unit-cost line for the local segment.
3. **Capture channel priority** — WhatsApp first (recommended; matches the Iyobo surface and the Nigerian SMB motion) vs. in-app camera.
4. **Attribution depth** — how far to chase conversion data for the learning loop. Reach and engagement are easy; bookings and trials need customer-side instrumentation. Decide the v1 signal set **before** building the sampler, or the sampler learns on the wrong reward.
5. **Aggregator vs. all-native** — confirm the native-core / aggregator-tail split. Native tail costs engineering weeks; aggregator costs margin and a dependency.
6. **Image engine build-vs-buy** — own inference on ClientForce infra vs. third-party API. Brand consistency and cost argue own; speed argues buy.
7. **Compliance verticals** — sell into health/finance/legal at launch, or gate until §6.6 guardrails are proven in production? Recommend gate.
8. **Playbook authoring** — internal-only at v1, or customer/agency-authored later? Determines whether playbook records need versioning and a review workflow now.
9. **Engagement eligibility rule** — time-based, volume-based, or hybrid (PRD open question).
10. **Prototype vs. wireframe reconciliation** — the `.dc.html` prototype and the Whimsical wireframe map must be diffed screen-by-screen before P3; the prototype governs visuals, the PRD flow IDs govern behaviour, and any conflict needs an explicit ruling.

---

*Model, vendor, and platform-access facts reflect the July 2026 landscape and shift quarterly. The tool-registry indirection, the fal gateway, the `PlatformAdapter` interface, and playbooks-as-data mean every one of them can be swapped without re-architecting. Re-verify pricing, leaderboards, and developer-portal rules at build time.*
