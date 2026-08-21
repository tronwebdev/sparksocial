# Open gaps

What is **not** done. Nothing else.

The previous version of this file was a chronological log in which finished work
accumulated as `[x]` entries — 461 lines, of which roughly 380 described things that
already work. That made it useless for the one question it exists to answer, and its own
footer already said so (*"this file exists only to track what's left"*). `STATUS.md`
narrates the done side; this file does not.

Tracks gaps against `docs/PRD.md` and `MASTER_BUILD_PLAN.md` §3.2 (the tool registry) and
§12 (phase exit criteria). Check an item off only once it is built **and** verified against
real data — Postgres, a live vendor call, or both — not once code exists that has not run.
When an item is closed, delete it; do not tick it.

**Re-running the audit.** Diff the live registry against the plan rather than trusting this
file after a large change:

```bash
curl -s http://localhost:<port>/v1/tools
```

…and compare against the tool names in `MASTER_BUILD_PLAN.md` (lines ~191–245). Confirm
each apparent gap by reading the source: most name-level mismatches are deliberate
consolidations documented in `STATUS.md`, not missing capabilities.

Last full pass: **21 Aug 2026**. The ten backend gaps that pass opened are closed
(§8.12 org governance, §8.9 trend time series, §10 connection alerts and the retry
ceiling, and seven earlier ones — see `git log` from `73240b9`).

---

## Needs a human, not code

These are blocked on somebody outside this repo. No amount of implementation moves them.

- [ ] **Platform approval tracks** — Meta, LinkedIn, Google, TikTok, X, YouTube. Someone has
      to file with each platform. CLAUDE.md's scope note has always said LinkedIn is
      weeks-to-months; that has not changed, only the code readiness has. This is the binding
      constraint on the alpha, not the codebase.
- [ ] **WhatsApp Business verification** — needed before a real number can send. The
      Direct+Finish loop runs end to end on the stub transport until then.
- [ ] **fal.ai account locked (billing)** — blocks real image generation.
- [ ] **HeyGen avatar video** — key configured, tool live, no real credits ever spent
      confirming a render completes.
- [ ] **Ayrshare** — adapter code path ready, no key configured locally. Deliberately not in
      default routing anyway (`PUBLISH_USE_AGGREGATOR=true` opts in); reserved for the
      long-tail platforms post-GA per plan §8.
- [ ] **Clerk dashboard config** — six custom org roles + OAuth providers. Dashboard-only,
      no code path.
- [ ] **`team.invite` / `.role.set`** — real Clerk calls, deliberately never fired at a real
      recipient.
- [ ] **Azure Blob storage** — code-ready, unprovisioned; local disk stands in. Per CLAUDE.md
      the sandbox cannot reach Azure, so this runs from a developer machine.
- [ ] **Compliance vertical decision** — which verticals (health, finance, legal) to support
      and how strictly. `genome.compliance.classify` exists and is the thing this decision
      would configure.
- [ ] **Pricing from real cost data** — `tool_calls.cost_cents` carries real per-call cost and
      `analytics.success_metrics` now reads the operational side of it, but nothing aggregates
      cost into a report a pricing decision could rest on. The `org_budgets` cap is a
      placeholder figure.

## Real security gap

- [ ] **Brand-level isolation is a table nothing consults.** `team.permission.set` writes
      `brand_members` rows; nothing in the auth or query layer reads them. An org member can
      reach every brand in the org today regardless of their assigned brands. Needs a decision
      on where the check belongs — Clerk-session resolution in `clerk-auth.ts`, or a per-tool
      scope check — before it is enforcement rather than a table nothing consults. This is the
      one item in this file that is a *hole*, not an absence.

## Migrations not yet applied

- [ ] **0029–0031 are generated and committed but not applied anywhere.** All three are
      purely additive (`ADD COLUMN` / `CREATE TABLE`), so an un-migrated database keeps
      working until something reads the new columns — at which point org governance, the
      trend time series, and the connection alerts fail at the query, not at boot. Run
      `npm run migrate -w @sparksocial/db` from a machine that can reach the server.

## Not built — code gaps

- [ ] **Automated product-screen / site capture** (`assemble.screen_capture`). Site
      *reading* exists for genome inference; Assemble-mode playbooks that need
      screen-recording footage still require a manual upload.
- [ ] **TikTok Creative Center trend source** — deliberately not built, no confidently
      documented public API found. The `TrendSource` seam is where it would land.
- [ ] **`bulk_connector`'s `folder` sub-kind** — honestly reports itself unbuildable in a
      hosted app. Needs redefining (a watched Blob container, say) before it is a real target.
- [ ] **Load and cost testing** — needs a real staging environment to mean anything. A local
      script against dev Postgres can validate correctness under concurrency (idempotency and
      budget races) but cannot produce capacity numbers.
- [ ] **Incident runbooks** — not started.

## Built but never live-verified

Code-complete and unit-tested; no key configured in this environment, so no call has ever
reached the vendor. Setup steps in `apps/api/.env.example`.

- [ ] Product Hunt, Pinterest, Google Drive, Canva.
- [ ] Native platform adapters (Meta, TikTok, LinkedIn, X, YouTube) — the code path is real;
      it is the approvals above that gate it.
- [ ] **Browser sign-in redirect loop** — last seen 16 Aug 2026, never established whether it
      was a real config issue or a stale-session artifact. Not re-tested since.

## Frontend surfaces — not verified in a browser

Both surfaces added 21 Aug (`StallNotice` in the Draft Panel, `PerformancePanel` on
`/agents`) are typechecked and prerender in `next build`, and **neither has been looked at
in a running browser**. Every `(app)` route sits behind Clerk, and signing in is not
something an agent can or should do. Worth ten minutes of clicking before the alpha:

- [ ] **`StallNotice`** — needs a genuinely blocked item to render against. The cheapest
      way to produce one is to schedule a post to a platform with no connection and let the
      scheduler reach its five-attempt ceiling.
- [ ] **`PerformancePanel`** — the case worth checking is the *empty* one: a brand with no
      campaign should show em dashes with reasons, never a column of confident zeros.

## Open decisions

1. [ ] Prototype (`.dc.html`) vs. the original Whimsical wireframe — never reconciled.
2. [ ] tRPC vs. the current hand-written REST door. CLAUDE.md invariant 1 says the router is
       *generated* from the registry; today it is a hand-written proxy pair. Worth resolving
       before the tool count grows again.
3. [ ] Framework major-version upgrades queued: Next 15→16, Zod 3→4, TS 5→7, Vitest 2→4,
       Tailwind 3→4, Clerk major.
4. [ ] Org/brand routing — shipped single-active-brand-per-workspace instead of the PRD's
       `/b/[brand]/...` multi-brand routes. Confirmed with the user, but worth re-flagging now
       that agency multi-tenancy sits on top of it.
5. [ ] Agency isolation enforcement — see "Real security gap" above. This is the decision that
       unblocks it.

## Known operational hazard

- [ ] **A long-lived `tsx watch` process can silently stop reloading.** Seen 17 Aug 2026: the
      local API froze at 106 registered tools while 32 more were added in source, and
      `GET /v1/tools` kept reporting the stale count with no error anywhere. Restarting picked
      all of them up, confirming the code was right and the process was stale. Root cause never
      diagnosed. Practical effect: anyone testing against a long-running dev server — including
      a human clicking through the browser — can be looking at a build hours out of date.
      Worth a health-check field (process start time + a reload counter) if it recurs; do not
      trust `tools: N` alone.
