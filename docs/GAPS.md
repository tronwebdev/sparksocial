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
| Frontend only | **0** | All ten closed 21 Aug. |
| Backend *and* frontend | **0** | All three closed 21 Aug. |
| Not code | 8 | Approvals, vendor keys, or a product decision. |
| Verification owed | 1 | Every screen built this week. None has been opened in a browser. |

The binding constraint on the alpha is still platform approvals, not code — CLAUDE.md has
said so since the start and nothing here changes it.

Closing the frontend ten needed four small backend additions, because three of those gaps
could not exist as write-only screens: `knowledge.list`, `team.list`, `platform` and
`mediaType` on `calendar.get`, and §8.6's brand kit actually reaching
`compose.static`/`compose.render` — both fields had been writable for a while and no
renderer read either.

The three both-halves features are closed too: `ENG-02.4`'s conversation drawer
(`thread_key` + `sent_reply` on `engagement_messages`, `engage.thread`), §8.9's influencer
watchlist (`influencer_watchlist`, `trend.influencer.watch`/`.review`), and `DISC-02`'s A/B
test (`variant_group_id` on `content_items`, `content.variant.split`/`.result`). Migrations
0032–0034, all additive and **not yet applied** — run `npm run migrate -w @sparksocial/db`.

**Every code gap the second pass found is now closed.** What is left is eight items blocked
outside this repo and one browser pass.

---

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

**Nothing built this week has been opened in a browser.** Every `(app)` route sits behind
Clerk and signing in is not something an agent should do, so all of it is typechecked and
prerendering in `next build`, and none of it has been *looked at*. One item, not twelve,
because the fix is one sitting:

- [ ] A pass over `/account` (team, audit, brand transfer, plan, usage), `/settings`
      (knowledge, brand kit), `/agents` (plan queue, performance), `/calendar` (filters),
      the Draft Panel's stall notice, and the two new onboarding steps.

      The cases worth deliberately reaching — the ones a type system cannot check and a
      screenshot settles in seconds:

      - **`PerformancePanel` with no campaign** — em dashes with reasons, never a column of
        confident zeros.
      - **`StallNotice`** — needs a genuinely blocked item. Schedule a post to a platform
        with no connection and let the scheduler reach its five-attempt ceiling.
      - **`KnowledgePanel` with nothing attached** — the warning that every specific claim
        will be held is the most important state on that screen.
      - **The brand-kit preview** — a light background against the default white type is
        exactly the unreadable pair `resolveKit` deliberately refuses to guess around.
      - **`ConnectAccountsStep`** — the popup path, and the refusal-by-name for a platform
        with no configured developer app, which is most of them in this environment.

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
