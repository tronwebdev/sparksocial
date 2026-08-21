# Open gaps

What is **not** done. Nothing else.

`STATUS.md` and git history narrate the done side. When an item closes, delete it — do not
tick it. The previous version of this file was a chronological log in which finished work
accumulated as `[x]` entries, 380 of 461 lines describing things that already worked, which
made it useless for the one question it exists to answer.

**Every claim below was verified against the tree on 21 Aug 2026** by reading source or
grepping for absence — not carried forward from the previous version. That matters because
one entry *was* carried forward without checking and was wrong; see the correction at the
bottom.

**Re-running the audit:**

```bash
curl -s http://localhost:8080/v1/tools
```

…compared against the tool names in `MASTER_BUILD_PLAN.md` (lines ~191–245), then each
apparent gap confirmed by reading the source. Most name-level mismatches are deliberate
consolidations documented in `STATUS.md`, not missing capabilities.

## Where the work stands

| Kind | Count | Note |
| --- | --- | --- |
| Backend | **0** | All ten closed 20–21 Aug. |
| Frontend | 10 | A registered, tested tool exists and no screen calls it. |
| Backend *and* frontend | 3 | New storage *and* a new surface. Real features. |
| Not code | 8 | Approvals, vendor keys, or a product decision. |
| Verification owed | 2 | Built and typechecked; never opened in a browser. |

The binding constraint on the alpha is still platform approvals, not code — CLAUDE.md has
said so since the start and nothing here changes it.

---

## Frontend only — the tool is already there

Ten capabilities that exist, are tested, and are reachable from no screen. `apps/web` reaches
everything through `invoke()` (CLAUDE.md's frontend rule), so "no screen calls it" is a
grep, not a judgement. Ordered by what a customer notices first.

- [ ] **Brand knowledge documents cannot be uploaded from anywhere.** `knowledge.ingest_site`,
      `knowledge.ingest_docs` and `brand.knowledge.attach` are all real, cost-estimated and
      tested; no component calls any of them. **The most consequential item on this list**, and
      it does not look like it: `claim_grounding` reads exactly this corpus, so a brand with
      nothing attached has every specific claim it makes flagged as ungrounded. The guardrail
      is working correctly and the brand has no way to feed it.
- [ ] **Teams and roles.** `team.invite`, `team.role.set`, `team.permission.set`. The `Role`
      enum carries all six roles the PRD names and every tool declares its scopes — enforcement
      is real (including the brand-level check, see the correction below) and the
      administration of it is unreachable. An agency cannot add a second person without the API.
- [ ] **The audit log.** `org.audit.query` and `engage.audit.query`. Every tool call writes a
      row for every outcome including denials, so the data is complete and dense, and §10 lists
      audit logs as the mitigation for engagement misfires. Needs a filter and pagination
      design more than it needs code.
- [ ] **Import / export a workspace.** `brand.export` and `brand.import`. For an agency this is
      how a client is onboarded from a template, or handed back on the way out.
- [ ] **Calendar filters.** §8.7 asks for status, platform and content-type filters;
      `CalendarBoard` has none. Both fields exist now (`needs_review`, per-slot `platform`), so
      this is buildable. *Not* on this list any more: the month view. `MonthGrid` groups by ISO
      date rather than laying slots over a real month calendar, and its own comment gives the
      reason — a campaign window is thirty days from whenever it started, and an empty first row
      of a September grid would imply the campaign is idle rather than that it began on the 4th.
      That is a reasoned deviation from the PRD, not an unbuilt screen.
- [ ] **A Plan Queue, as distinct from a draft list.** §7.5 makes four queues first-class:
      Plan, Review, Automation, Engagement. Three have a surface — `queue.review.list`,
      `recipe.output.list`, `engage.list`. `DraftList` (CC-03) covers *everything in flight
      across every status*, which is close but is not the same thing: a plan queue is what SPARK
      intends to do **next, in order**. `content.list` already returns the material.
- [ ] **Settings is one flat page, not two layers.** §8.12 describes an org layer and a
      workspace layer; ten panels scroll together on `/settings`, with the org-level ones
      (billing, plan, SSO, governance, usage) sitting inside brand settings. `/account` exists
      as a destination for the org half.
- [ ] **Social accounts cannot be connected during onboarding.** `integration.connect` works and
      lives in settings. Connecting later is supported and is not the flow §8.2 describes, which
      puts it before the first campaign — where it matters, because a campaign created with
      nothing connected holds everything it produces.
- [ ] **The agent personalization step (ONB-05).** Alias, avatar, optional cameo import,
      optional voice record. `genome.avatar_config.set` and `genome.consent.*` are real and
      reachable from settings; the onboarding step that introduces them is not. The consent
      question is already asked properly in the five-question flow, which is the part that
      actually governs whether an avatar may ever be used.
- [ ] **Logo upload, and the brand kit past a URL.** `brands.logoUrl` and `brandColors` exist
      and the panel takes a pasted URL. §8.6's "Apply Brand Kit" toggle needs the colours
      actually reaching `compose.static` / `compose.render` — verified absent — and an upload
      rather than a paste, for which `asset.upload_url` already does the upload half.

Dropped from this list as not worth tracking: ONB-06's "Press & Hold to Continue". The
completion screen exists; the prototype's hold-to-confirm interaction does not. It was
listed for completeness and is not a gap anybody should spend a day on.

## Both halves — new storage and a new surface

Three real features rather than wiring.

- [ ] **The engagement conversation drawer (ENG-02.4).** §8.8 asks for the thread behind a
      sales opportunity. The feed shows each message with its classification, intent score,
      suggested reply and actions; it cannot show the conversation the message sits in, because
      `engage.list` returns messages and `engagement_messages` has no thread key (verified — no
      such column). Backend first, then the drawer.
- [ ] **The influencer watchlist.** §8.9 lists two watchlists among Discovery's inputs. The
      keyword one is real (`trend.watchlist`); the influencer one has no storage, no tool and no
      screen. Following named accounts is a listening capability, so it inherits the same
      platform-approval clock as the inbox.
- [ ] **A/B variants on the content pack panel (DISC-02).** §8.9 marks this optional and half of
      it exists: `draft.variants` generates alternative takes and the Draft Panel exposes them.
      Missing is the part that makes it a test rather than a choice — publishing two variants,
      attributing performance to each, and feeding that to `learning.record_outcome`.

## Not code — approvals, keys, or a decision

Blocked on somebody outside this repo. No amount of implementation moves them.

- [ ] **Platform approval tracks** — Meta, LinkedIn, Google, TikTok, X, YouTube. The PRD's own
      integrations register puts LinkedIn at weeks-to-months and says it "rejects anything
      resembling a generic scheduler"; Meta App Review is one to three weeks; TikTok has a
      sandbox audit whose posts are invisible until it clears. Fourteen platforms are nameable
      and every unconfigured one routes to the stub adapter, so calendar → guardrails → policy →
      publish runs end to end today without a single vendor account. Whether they are *reachable*
      is a filing question.
- [ ] **No webhook feeds the engagement inbox.** `engage.ingest` works, is tested, and upserts
      on `(org, genome, platform, external_id)` so a retry cannot duplicate a message. Nothing
      calls it with real traffic, because that needs the Meta listening scopes from the same App
      Review above.
- [ ] **WhatsApp Business verification** — needed before a real number can send. The
      Direct+Finish loop runs end to end on the stub transport until then. Note the loop
      deliberately has no web surface: the loop *is* WhatsApp, and a page in the middle would
      defeat it.
- [ ] **The agency portal's three capabilities (§8.13)** — website wizard, lead/job finder,
      trainings. §8.13 names them and then says their outputs are *"defined by separate PRD if
      deeper"*, so there is nothing to build against and building anyway would be inventing
      product. They appear on Account Home marked as not built. **The one item here blocked on a
      decision rather than on time, and the decision is yours.**
- [ ] **Vendor keys, no code path missing** — fal.ai (account locked on billing, blocks real
      image generation), HeyGen (key configured, never spent real credits confirming a render
      completes), Ayrshare (adapter ready, no key; deliberately out of default routing behind
      `PUBLISH_USE_AGGREGATOR=true`, reserved for long-tail platforms post-GA), Product Hunt /
      Pinterest / Google Drive / Canva (code-complete, unit-tested, never live-verified). Setup
      steps in `apps/api/.env.example`.
- [ ] **Clerk dashboard config** — six custom org roles and the OAuth providers.
      Dashboard-only, no code path. `team.invite` / `team.role.set` make real Clerk calls that
      have deliberately never been fired at a real recipient.
- [ ] **Azure Blob storage** — code-ready, unprovisioned; local disk stands in. Per CLAUDE.md
      the sandbox cannot reach Azure, so this runs from a developer machine.
- [ ] **Compliance vertical decision, and pricing from real cost data.** Which verticals
      (health, finance, legal) to support and how strictly — `genome.compliance.classify` exists
      and is the thing that decision configures. And `tool_calls.cost_cents` carries real
      per-call cost, `org.usage.get` reads the spend side of it, and nothing aggregates it into
      the report a pricing decision would rest on. The `org_budgets` cap is a placeholder figure.

## Not built, and correctly absent

- [ ] **Automated product-screen / site capture** (`assemble.screen_capture` — verified absent).
      Site *reading* exists for genome inference; Assemble-mode playbooks that need
      screen-recording footage still require a manual upload.
- [ ] **TikTok Creative Center trend source** — deliberately not built, no confidently
      documented public API found. The `TrendSource` seam is where it would land.
- [ ] **`bulk_connector`'s `folder` sub-kind** — the runner returns an explicit refusal
      ("not a connectable source in a hosted app — use drive or csv instead"). Needs redefining,
      say as a watched Blob container, before it is a real target.
- [ ] **Sora, Snapchat, WordPress, Shopify** — the PRD defers all four to v1.1/v2 and says of
      Sora that the surface "is not yet stable for third-party publish/listen", priority
      MONITOR. Medium and Substack are dropped outright. Listed so their absence reads as
      intended rather than overlooked.
- [ ] **Load and cost testing** — needs a real staging environment to mean anything. A local
      script against dev Postgres can validate correctness under concurrency (idempotency and
      budget races) but cannot produce capacity numbers.
- [ ] **Incident runbooks** — not started.

## Verification owed

Built, typechecked, prerendering in `next build`, and **never opened in a browser**. Every
`(app)` route sits behind Clerk and signing in is not something an agent should do.

- [ ] **`StallNotice`** (Draft Panel, §10/§7.4) — needs a genuinely blocked item to render
      against. Cheapest way to produce one: schedule a post to a platform with no connection and
      let the scheduler reach its five-attempt ceiling.
- [ ] **`PerformancePanel`** (`/agents`, CC-04/§5) — the case worth checking is the *empty*
      one. A brand with no campaign should show em dashes with reasons, never a column of
      confident zeros.

## Open decisions

1. [ ] Prototype (`.dc.html`) vs. the original Whimsical wireframe — never reconciled.
2. [ ] tRPC vs. the current hand-written REST door. CLAUDE.md invariant 1 says the router is
       *generated* from the registry; today it is a hand-written proxy pair.
3. [ ] Framework major-version upgrades queued: Next 15→16, Zod 3→4, TS 5→7, Vitest 2→4,
       Tailwind 3→4, Clerk major.
4. [ ] Org/brand routing — shipped single-active-brand-per-workspace instead of the PRD's
       `/b/[brand]/...` multi-brand routes. Confirmed with the user, worth re-flagging now that
       agency multi-tenancy sits on top of it.

## Known operational hazard

- [ ] **A long-lived `tsx watch` process can silently stop reloading.** Seen 17 Aug 2026: the
      local API froze at 106 registered tools while 32 more were added in source, and
      `GET /v1/tools` kept reporting the stale count with no error anywhere. Restarting picked
      them all up, confirming the code was right and the process was stale. Root cause never
      diagnosed. Anyone testing against a long-running dev server — including a human clicking
      through the browser — can be looking at a build hours out of date. Do not trust
      `tools: N` alone.

---

## Corrections to the previous version of this file

Recorded rather than silently edited, because a gap tracker that has been wrong once should
say where.

- **"Brand-level isolation is a table nothing consults" was false.** The previous version
  listed it as the one outright security *hole*: `team.permission.set` writes `brand_members`
  rows and supposedly nothing read them, so any org member could reach any brand.
  `apps/api/src/clerk-auth.ts` does read them — every role other than `owner`/`admin` needs an
  explicit row for the claimed brand, and is refused with `ISOLATION_VIOLATION` (absent rather
  than forbidden, so probing a genome id cannot confirm a brand exists that the caller is not
  assigned to). It landed in `e343534`. The entry was inherited from an older draft and never
  re-checked against source — the exact failure this file's methodology note warns about.
  `makeDevResolveCtx` has no such check, correctly: it trusts headers by design, and
  `index.ts` refuses to boot in production without a real auth resolver unless
  `ALLOW_DEV_AUTH=true` is set explicitly.
- **Migrations 0029–0031 were listed as unapplied.** They are applied: 32 migrations recorded,
  all six new columns, `trend_observations`, and both indexes verified present against the
  local server. `drizzle-kit generate` now reports no schema changes, which independently
  confirms `schema.ts` and `migrations/` are in sync. Root cause of the failure that prompted
  this: `drizzle.config.ts` read `process.env.DATABASE_URL` only and nothing bridged
  `apps/api/.env`, so a fresh shell fell through to a placeholder host and drizzle-kit exited 1
  having printed only its driver choice. Fixed at the config, which is the one place every
  entry point shares.
