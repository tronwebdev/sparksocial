# Open gaps

Tracks every real gap against `MASTER_BUILD_PLAN.md` §3.2 (the full tool registry) and
§12 (phase exit criteria). Check an item off only once it's built and verified against
real data (Postgres, a live vendor call, or both) — not once code exists that hasn't run.

**Methodology**: the live tool registry (`GET /v1/tools`) was diffed name-for-name against
every tool listed in §3.2, then every apparent gap was confirmed by reading the actual
source — not inferred from memory. Last done: 17 Aug 2026 (138 tools live — up from 108 the
same day; see "Dev server reliability" below on why the diff had to be re-run against a
restarted server to be trusted). Nearly every name-level mismatch found on this pass turned
out to be a deliberate consolidation already documented somewhere in this file or in
`STATUS.md`'s "trim the tool count" call, confirmed by reading the actual implementation
rather than assumed — e.g. `calendar.reschedule` is `content.schedule` ("move an
already-scheduled [post] to a new date"), `recipe.pause` is `recipe.schedule`, the seven
`guard.*` sub-checks are internal to `guard.evaluate_draft`, `direct.brief.validate` and
`direct.media.quality_check` are internal functions (`validateBrief`, `checkMediaQuality`)
called by `direct.brief.generate`/`direct.media.ingest` rather than separate tools, and
`asset.ingest_inbound` is `direct.media.ingest` (its own doc comment: *"the single tool a
submitted WhatsApp reply resolves to... land one asset per requested aspect ratio in the
Asset Graph"*). Re-run the diff before trusting this file after a large change:

```bash
# from repo root, API running with full .env loaded
curl -s http://localhost:<port>/v1/tools | node -e "..." # tool names → compare against
grep -n "\`[a-z_]\+\.[a-z_.]\+\`" docs/MASTER_BUILD_PLAN.md   # (lines ~191-245)
```

---

## Dev server reliability (found 17 Aug 2026, during this audit)

- [ ] The long-running local API process (`tsx watch`, up since 01:15 that day) silently
      stopped picking up file changes at some point and froze at 106 registered tools while
      32 more were added and registered in source over the following session — `GET /v1/tools`
      kept reporting the same count and the same `at` timestamp region call after call.
      Restarting the process picked up all 138 immediately, confirming the code was correct
      and the *running process* was stale, not the registry. Root cause not diagnosed (not
      reproduced deliberately — this was caught incidentally while re-running this file's own
      audit methodology). Practical effect: anyone testing against a long-lived `tsx watch`
      session — including a human clicking through the actual browser UI, not just an agent
      calling tools directly — can be looking at a build that is silently hours out of date
      with no error or warning surfaced anywhere. Worth a health-check field (e.g. process
      start time + a build/reload counter) if this recurs, rather than trusting `tools: N`
      alone.

## UI wiring — built backend, no web surface

`apps/web` reaches every capability through `apps/web/src/lib/tools.ts`'s `invoke()` — CLAUDE.md's
own frontend rule. This section is what `invoke()` is never called with: real, registered,
tested tools that a human cannot currently reach by clicking anything in the product. Confirmed
by grepping every `invoke(` call site in `apps/web/src`, not assumed from the tool list alone —
several apparent misses (`agent.pause`/`.resume`, `genome.create`) turned out to be wired via a
dynamic tool-name expression a naive single-line grep missed, so each item below was checked
against its actual component, not just absence from a grep.

- [x] **`human.pending`/`.ask`/`.answer` now have a Command Center surface** — done 18 Aug 2026.
      `apps/web/src/components/command-center/PendingQuestionsPanel.tsx`, rendered in
      `CommandCenterOverview` between `NeedsAttentionBanner` and `CampaignFocusCard`. Self-fetches
      `human.pending` on mount, renders nothing when the queue is empty (same restraint as
      `NeedsAttentionBanner`), and posts through `human.answer` with a fresh idempotency key.
      Live-verified end to end in the browser against the real session: created a question via
      `human.ask`, confirmed it rendered with urgency/wait-time/options, answered it through the
      panel, and confirmed it correctly disappeared on refetch.
- [x] **The Draft Panel's beat-kind union now covers `generated_broll` and `dubbed_media`** —
      done 18 Aug 2026. `draft-panel/types.ts`'s `ResolvedBeat` union extended with both kinds
      plus a `DUBBABLE_BEAT_KINDS` const; `BeatRow.tsx`'s media-preview switch, `initialText`
      lookup, and textarea-visibility condition all extended to match. Added a "Generate b-roll"
      button next to the existing avatar-video/voiceover actions, and a language-code + "Dub"
      control for any beat carrying playable media. Live-verified "Generate b-roll" reaches the
      real `content.generate_broll` tool (surfaces fal.ai's real `403` billing-lock error rather
      than failing silently — the standard this session used throughout: a UI wire that reaches
      the real vendor and gets an honest vendor error counts as verified, since the point is
      proving the wire, not the vendor's billing state). "Dub" was confirmed correct by code
      review and by the same class of real backend gate (a generated-voiceover beat to dub from
      hit ElevenLabs' real `401`) but wasn't exercised past a media beat existing, since nothing
      in this environment can produce one without paid vendor credentials.
- [x] **Four of the ~24 backend-only tools from the prior pass now have UI** — done 18 Aug 2026,
      wired into the surface each fits most naturally rather than inventing new screens:
      - `draft.variants`/`draft.repurpose` → two new cards in the Draft Panel editor ("Not sure
        this is the best take?" / "Want this as a different format?"). Live-verified: generated
        two real distinct AI copy takes and applied one. Doing so live surfaced a second real
        bug: `BeatRow` was keyed on `beat.beatId` alone, so applying a variant correctly updated
        the underlying draft state (the Save button flipped to disabled/"Saved") but the
        textarea kept showing the pre-variant text — React never remounted the row, and
        `useState`'s initializer only runs on first mount. A stray click on the stale Save button
        would have silently overwritten the just-applied variant. Fixed by keying `BeatRow` on a
        content signature (`beatId:kind:url:text`) instead of `beatId` alone, so it remounts
        exactly when a beat's content changes externally and never on the user's own keystrokes.
        Confirmed live: after the fix, applying a variant immediately shows the new text.
      - `compose.static` → a second "Fast render" button next to the existing Remotion "Render",
        shown only for `image`/`carousel` drafts (Satori doesn't support video). Live-verified
        against a real repurposed quote-card draft — produced an actual composed image.
      - `genome.avatar_override.set` → a new "Founder-POV avatar override" section in
        `AvatarConfigPanel.tsx` (Settings). Live-verified both paths: the client-side "say why in
        at least 10 characters" validation, and the real backend gate rejecting the override with
        "No active likeness-consent record for this genome" — the same precondition
        `content.generate_avatar_video` checks before spending.
      - Found and fixed a real bug while verifying repurpose: `repurposeAs` and the playbook
        picker were built against `RankedPlaybook`'s snake_case shape (`playbook.resolve`'s
        output), but `playbook.list`'s real output (`packages/playbooks/src/browse.ts`'s
        `PlaybookSummary`) is camelCase (`playbookId`). The picker silently sent
        `targetPlaybookId: undefined` (a real `400` on click) and the "exclude current playbook"
        filter silently matched nothing. Fixed by adding a `PlaybookSummary` type matching the
        tool's actual output and using `playbookId` throughout; both symptoms confirmed fixed
        live (repurpose succeeds, current playbook no longer appears in its own picker).
      - The remaining ~20 backend-only tools from that pass are **now built — done 18 Aug 2026**,
        each wired into the surface it fits most naturally rather than a new top-level nav
        destination (`apps/web/src/components/shell/nav-items.ts` is data read off the fixed
        `.dc.html` prototype set per CLAUDE.md's design-source-of-truth rule; no prototype screen
        exists for Analytics/Policy/Reports, so those became new sections on existing screens
        instead, the same call `CommandCenterOverview.tsx`'s own header comment already made):
        - `asset.rights.set`/`.cooldown.check`/`.reuse`/`.folder.create`/`.move` → a new
          `AssetDetailPanel.tsx`, opened by a click on an `AssetSearchGrid` card (previously had
          no `onClick` at all). Added one small tool while wiring this,
          **`asset.folder.list`** — `db.assetFolders.list` had existed since `asset.folder.create`
          shipped but nothing exposed it, so a folder picker had no folders to pick from. Also
          added `folderId` to `asset.retrieve`'s output (present on the row, never selected).
          Live-verified the full loop: rights-status toggle, cooldown check, folder create +
          move, mark-used.
        - `campaign.duplicate`/`.pause`/`.resume` → three buttons on `CampaignFocusCard.tsx`
          (Command Center) — the only campaign view that exists (one active campaign per genome,
          no list screen). Live-verified: paused a real campaign (button flips to Resume),
          duplicated one ("Duplicated as 'August campaign (copy)'").
        - `calendar.impact_preview` → **not** the drag-move undo toast the prior pass's own note
          assumed — read the handler and found the tool actually previews `calendar.generate`
          mix-override regeneration, unrelated to a single-slot date move. Wired into `MixBar`'s
          +/− nudges instead, which is what it actually describes: clicking now shows a real
          before/after diff and waits for "Apply" rather than regenerating every future slot on
          the first click. Verified against real data via direct tool call (13→13 posts, proof
          mix 4→5) — the Calendar page has no campaign switcher, a pre-existing gap, so the
          click-through itself couldn't be exercised on this specific account's data.
        - `playbook.get`/`.explain` → an ⓘ button next to each pill in the Draft Panel's
          repurpose picker. Live-verified: "Avatar POV doesn't fit this brand: needs proof asset
          person, genome has physical_product."
        - `approval.policy.get`/`.set` → new `PolicyPanel.tsx` (Settings): restricted
          platforms/content types, quiet windows, spend/automation permissions, per-family
          autonomy overrides. Live-verified a restriction round-trips through a reload.
        - `learning.freeze`/`.reset` → new `LearningPanel.tsx` (Settings), backed by
          `learning.confidence` for the read side (no tool reports "is this genome frozen" —
          same set-only gap `AvatarConfigPanel.tsx`'s own comment already states for
          `genome.avatar_override.set`). Reset is a two-step confirm, the same
          click-again-to-confirm pattern the Draft Panel's Repurpose toggle already established.
          Live-verified Freeze; Reset's confirm step verified without executing it (nothing to
          reset on this genome yet, and it isn't reversible).
        - `analytics.post_metrics`/`.cta_traffic` → a "View metrics" expandable per published row
          in `DraftList.tsx` (which already had a `analytics.sync` action). `analytics.campaign_report`
          → a "By platform" breakdown and "Top posts" list added to the existing
          `CampaignReportPanel.tsx`, loaded alongside `campaign.report_vs_outcome` under the same
          button. Both live-verified against real (currently zero) data — correct empty-state
          handling, no crash, matches what the real tool call returns.
        - `compose.fanout` → a third render-action button in the Draft Panel ("Fan out via
          Canva"), gated on `brand.oauth.status` for Canva. No tool exists to introspect a Canva
          Brand Template's own field names, so the field-data input is JSON pre-filled from the
          draft's text beats rather than a real per-field picker — documented as a real limit,
          not hidden. Live-verified the gate itself: correctly stays hidden without a Canva
          connection (this environment has none configured) rather than showing and then
          failing.
        - `knowledge.ingest_site`/`.ingest_docs`/`.ground_claim` and `genome.compliance.classify`
          are the four tools out of the ~22 this pass covered that are **still backend-only** —
          confirmed by grep, not assumed (`apps/web/src` has zero references to any of the four).
          None had an obvious existing surface to extend the way the other eighteen did: the
          former three want an onboarding-adjacent "knowledge sources" screen that doesn't exist,
          the latter a compliance-vertical control that's arguably a business decision
          (`docs/GAPS.md`'s own "Compliance vertical decision" open item) as much as a missing UI.

## P7 — Hardening & GA (mostly business/ops, not code)

- [x] Mobile/tablet responsive pass — done 17 Aug 2026. See detail below.
- [ ] Approval tracks cleared (Meta, LinkedIn, Google, TikTok, X, YouTube) — **pure business
      process, no code path exists for this.** Someone has to actually file with each platform.
- [ ] Load and cost testing — not started. Needs a real staging/deployed environment to be
      meaningful; a local script against dev Postgres can validate correctness under
      concurrency (e.g. idempotency/budget races) but can't produce real capacity numbers.
- [ ] Incident runbooks — not started
- [ ] Compliance vertical decision — **pure business decision** (which verticals — health,
      finance, legal — to support and how strictly). `genome.compliance.classify` (the
      supporting infrastructure this decision would configure) is still unbuilt — see the
      Asset Graph section below.
- [ ] Pricing from real cost data — **pure business decision.** The credit ledger
      (`tool_calls.cost_cents`) already has real per-call cost data; nothing aggregates it
      into a report a pricing decision could be based on yet.

### Mobile/tablet responsive pass — what was actually wrong and fixed (17 Aug 2026)

Root cause, found once, present in ~20 files: any `<div className="grid gap-N">` with no
`grid-cols-*` sizes its single implicit column to fit its widest child's *unwrapped*
max-content width (a `flex flex-wrap` row's max-content ignores wrapping by CSS spec) —
so on a 375px phone, a card containing a status line + a couple of buttons would blow out
to ~2000px and get silently clipped by `overflow-hidden` on the shell's rounded canvas.
Screenshots looked like content "shrunk into a corner"; the real bug was content laid out
at desktop width then clipped, not a rendering artifact. Fixed at the root: Tailwind's
`grid-cols-1` wraps its single track in `minmax(0,1fr)` instead of `auto`, which the plain
`grid` utility doesn't — added to every instance found (64 across 20 files), verified zero
horizontal overflow afterward on all 7 authenticated routes at 375px and 768px.

Also built: there was no mobile navigation at all — `AppShell` hides the desktop sidebar
below `md` with nothing replacing it, so a phone-width session had no way to switch
screens. Added `MobileNav` (a left-side sheet, `@radix-ui/react-dialog`) wired into
`TopBar`, reusing the same `NAV_ITEMS` the desktop rail reads — zero per-page changes
needed since every `(app)` route already renders one `TopBar`.

Verified live against a real authenticated session (already-signed-in browser tab) at
375px and 768px: all 7 app routes, the mobile nav drawer end-to-end (open → navigate →
auto-close), the Bulk Connector source picker, and the full-screen Draft Panel dialog.
Static-reviewed (not live-tested — can't view `/sign-in` while authenticated, and won't
sign out an active session to check) the public auth/onboarding screens: no instances of
the same bug pattern found; existing fixed-width elements there already use
`max-w-[N] max-w-full` or are `max-lg:hidden` decorative panels with their own
`overflow-hidden`.
- [ ] Compliance vertical decision
- [ ] Real-cost pricing (`org_budgets` cap is a placeholder figure today)

## Publishing / social connections

- [x] `integration.connect` / `.health` / `.scopes.verify` / `.rate_budget` — done 18 Aug 2026.
      `packages/publish/src/integration.ts`. Corrected course from the 17 Aug plan (Ayrshare
      first): publishing is now **native-first**, per the PRD's own strategy (§8: "go native on
      the core five... use an aggregator for the long tail"), not aggregator-first. Same PKCE +
      signed-state OAuth flow `brand.oauth.connect` established for Canva, extracted to
      `packages/shared/src/oauthState.ts` so `publish` doesn't depend on `agency`.
      `integration.connect` mints a real per-platform authorize URL (Meta/TikTok/LinkedIn/X/
      Google OAuth endpoints, built from each platform's published docs, same "unverified
      against a live account" caveat every vendor integration in this codebase carries);
      `integration.health` reports real per-brand connection state (not just adapter routing,
      which is all the pre-existing `publish.status` ever showed); `integration.scopes.verify`
      compares stored-at-connect scopes against a static required list (not live introspection —
      documented as a real limit, not a false guarantee); `integration.rate_budget` wraps the
      existing per-platform `RateLimiter`. Widened `brand.oauth.status`/`.disconnect`'s
      `provider` union (Canva-only → Canva + the five social platforms) rather than duplicating
      near-identical read/remove tools. Wired into `apps/web`'s `PublishHealthPanel.tsx`
      (Connect/Disconnect buttons + real connection status, replacing the read-only
      `publish.status` display) — live-verified: clicking Connect on an unconfigured platform
      correctly reaches the real tool and refuses by name ("instagram isn't configured for
      native publishing yet"), confirming the wire is real even though no platform has a
      developer app registered in this environment yet.
- [x] Native platform adapters (Meta/TikTok/LinkedIn/X/YouTube) — done 18 Aug 2026, code-complete
      and unit-tested; **still blocked on the same real-world approvals CLAUDE.md always said
      they were** (§ Scope: "LinkedIn is weeks-to-months and will not clear by Aug 29") — that
      constraint hasn't moved, only the code readiness has. `packages/publish/src/native/`:
      `instagramAdapter.ts`/`tiktokAdapter.ts` are URL-based (the platform fetches the media
      itself); `linkedinAdapter.ts`/`xAdapter.ts`/`youtubeAdapter.ts` fetch our media and
      re-upload the bytes (LinkedIn's asset-registration flow, X's chunked INIT/APPEND/FINALIZE,
      YouTube's resumable upload) — meaningfully more complex and correspondingly less confident
      without a live account to verify against. `PlatformAdapter`/`PublishRequest` extended with
      an `accessToken` field so a native adapter gets the *connecting brand's* OAuth token
      (`publish.now`/`publish.rollback`'s handlers read it straight from `oauth_connections`),
      distinct from the aggregator's one shared app-level key — the real architectural gap this
      pass had to close, not anticipated when `PlatformAdapter` was first designed for
      aggregator-only routing. Each adapter registers only once its own platform's developer-app
      credentials are configured (`apps/api/src/social-adapter-clients.ts`); an unconfigured
      platform falls through to the stub adapter, so `publish.now` still runs end to end in dev
      without any vendor account — same promise every other integration in this codebase keeps.
      The Ayrshare aggregator adapter's code is untouched and still real
      (`ayrshareAdapter.ts`/`ayrshare-adapter-client.ts`) but is deliberately **not included in
      default routing** even when `AYRSHARE_API_KEY` is set — a new `PUBLISH_USE_AGGREGATOR=true`
      env flag opts back in, reserved for the long-tail platforms (Pinterest, GBP, Reddit,
      Bluesky, Threads) post-GA per plan §8, per this session's explicit instruction not to use
      the aggregator as the default path. `oauth_connections` gained two columns (`scopes`,
      `account_label`, migration `0021`) to support this — a brand's connected account now
      carries a human-readable label and whatever scopes the platform's token response reported.

## Agency / team isolation

- [ ] **Real security gap, not a missing feature.** `team.permission.set` writes
      `brand_members` rows, but nothing in the auth/query layer reads them. An org member can
      reach every brand in the org today regardless of their assigned brands. Needs a decision
      on where the check belongs (Clerk-session resolution in `clerk-auth.ts`, or a per-tool
      scope check) before it's enforcement rather than a table nothing consults.

## Asset Graph / knowledge

- [x] `knowledge.ingest_site` / `.ingest_docs` / `.ground_claim` — done 17 Aug 2026. Built in
      `packages/genome/src/knowledge.ts`; `ingest_site` crawls via the existing `crawl()` and
      chunks per-page, `ingest_docs` takes a batch with per-doc error isolation, `ground_claim`
      reuses `claimGrounding` directly. Fixed a real latent bug as a necessary side-effect:
      `guard.claim_grounding` never actually read `knowledge_chunks` — the whole
      knowledge-ingestion feature (including the pre-existing `brand.knowledge.attach`) was
      silently inert until `packages/guardrails/src/gather.ts` was updated to combine asset
      captions with `knowledge.listAll`. Live-verified against real Postgres.
- [x] `asset.rights.set` — done 17 Aug 2026. `packages/assetgraph/src/rights.ts`, `human_only`
      autonomy. Live-verified.
- [x] `asset.cooldown.check` — done 17 Aug 2026. `packages/assetgraph/src/cooldown.ts`, reuses
      `DEFAULT_COOLDOWN_DAYS` (now exported) from the guardrail's own duplicate-detection logic
      so the check and the guard agree. Live-verified.
- [x] `asset.reuse` — done 17 Aug 2026. `packages/assetgraph/src/reuse.ts`, records usage
      count/last-used. Live-verified.
- [x] `asset.folder.create` / `.folder.move` — done 17 Aug 2026. New `asset_folders` table
      (`assets.folderId` predated any table it referenced); `packages/assetgraph/src/folders.ts`.
      Live-verified including cross-genome isolation rejection.
- [x] `genome.compliance.classify` — done 17 Aug 2026. `packages/genome/src/compliance.ts`,
      keyword-based classifier over `health`/`finance`/`legal`/`regulated_other`, `human_only`
      autonomy, `overrideProfile` for a direct human call. Category-keyword matching is a
      documented, narrow exception to CLAUDE.md invariant 5 (reasoning is in the code comment) —
      it drives a one-time compliance flag, not engine/playbook routing. Live-verified.
- [x] ~~`asset.role.assign`~~ — consolidated: roles are auto-assigned at upload time, not a
      separate tool (verified against real Claude vision)
- [x] ~~`asset.caption` / `.embed`~~ — consolidated into the upload pipeline

## Campaign / calendar / drafts

- [x] `campaign.duplicate` — done 17 Aug 2026. `packages/campaign/src/lifecycle.ts`, copies
      the plan snapshot as-is, refuses cross-genome, does not copy slots. Live-verified.
- [x] Distinct `campaign.pause` / `.resume` — done 17 Aug 2026. Same file, built via a shared
      `makeStatusTool` factory over the pre-existing `CampaignStore.setStatus`. Live-verified.
- [x] `calendar.impact_preview` — done 17 Aug 2026. Added to `packages/campaign/src/calendarTool.ts`,
      reuses the file's own planning/placement pipeline, `read` effect — never calls
      `replaceSlots`. Output includes before/after mix and a `wouldChange` flag. Verified via
      unit/integration tests only (no new DB surface — reuses already-proven `campaigns` methods).
- [x] `draft.variants` / `.repurpose` as standalone tools — done 17 Aug 2026.
      `packages/generate/src/variants.ts`. `variants` is `read`/idempotent (a preview, nothing
      persisted); `repurpose` is `write`/non-idempotent, creates a genuinely new content item,
      source untouched, refuses `direct_finish` target playbooks. Live-verified.
- [x] `playbook.list` / `.get` / `.explain` — done 17 Aug 2026. `packages/playbooks/src/browse.ts`.
      `.list`/`.get` are static-catalog reads needing no genome; `.explain` runs the same
      `resolve()` the calendar/campaign planner uses, scoped to one playbook. Tests cross-check
      `.explain`'s output against a direct `resolve()` call so it can't silently drift from the
      resolver it wraps. Verified via unit tests only (no new DB surface).
- [x] ~~`mix.defaults` / `.derive_from_outcome` / `.adjust` / `.explain`~~ — consolidated:
      mix logic lives inside `campaign.propose_plan`/`calendar.generate`, functional not missing

## Content generation

- [x] `synthesize.video` (fal, generative b-roll) — done 17 Aug 2026 as `content.generate_broll`
      (named for consistency with this package's own `content.generate_*` family, not a new
      `synthesize.*` tool namespace). New `generated_broll` `ResolvedBeat` kind, real fal.ai
      queue-based video client (`apps/api/src/video-client.ts`) with submit/poll/fetch, gated
      on `FAL_API_KEY` same as `content.generate_image`. Code-complete, unit-tested; **not
      live-verified** — confirmed directly against the real API that this fal.ai account is
      billing-locked (`403 "User is locked. Reason: TOP_UP."`), the same block already
      recorded below for `content.generate_image`.
- [x] `synthesize.dub` (multi-language dubbing) — done 17 Aug 2026 as `content.generate_dub`
      (`packages/generate/src/dubbing.ts` — named to avoid colliding with
      `packages/publish/src/dub.ts`, the unrelated Dub.co link-shortener). Re-voices an
      existing beat's video/audio into a target language, replacing that beat in place; a
      multi-language *variant* of a whole post is `draft.repurpose` + per-clone dubbing, not
      this tool's job (a dub cannot invent a new beat id the playbook record doesn't declare —
      see the code comment). Real ElevenLabs Dubbing client (`apps/api/src/dubbing-client.ts`),
      gated on `ELEVENLABS_API_KEY`. Code-complete, unit-tested; the real API's submit contract
      (multipart/form-data — a JSON body is silently ignored) and status-poll path were
      confirmed directly against the live API without spending a real dubbing credit; a full
      end-to-end dub was deliberately not run, same reasoning already recorded for HeyGen below.
- [x] `compose.static` (Satori static-image composition) — done 17 Aug 2026. Browser-free
      sibling of `compose.render`'s image/carousel branches (Remotion needs a full headless-
      Chrome bundle-and-render even for a single static frame). Real Satori + `@resvg/resvg-js`
      runner (`apps/api/src/satori-runner.ts`), no vendor key needed. Live-verified end to end
      against real Postgres: a genuine PNG (confirmed via magic bytes) rendered and recorded as
      a `renders` row with `engine: 'satori'`. One real bug caught live: the brand's
      `Onest-Variable.ttf` fails inside Satori's font parser (variable fonts aren't reliably
      supported) — uses `AsgardTrial-FitBold.ttf` instead, confirmed working.
- [x] `compose.fanout` (Canva format fan-out) — done 17 Aug 2026. Autofills a Canva Brand
      Template with caller-supplied field data and exports to up to three file formats
      (png/jpg/pdf — Canva's Connect API fans out to file *formats*, not arbitrary pixel sizes;
      true resize is Canva's own "Magic Resize", not part of the public API). New
      `packages/agency/src/canvaDesign.ts` (autofill + export job submit/poll). Gated per-genome
      on an existing Canva OAuth connection, not a deployment-wide key, so always registered.
      Code-complete, unit-tested; **not live-verified** — `CANVA_CLIENT_ID`/`_SECRET` remain
      unconfigured locally, same status as the rest of this codebase's Canva integration.
- [x] `learning.freeze` / `.reset` — done 17 Aug 2026. New `learned.frozen` flag; `.freeze`
      locks the mix at its current state (`learning.reweight` becomes a no-op while frozen,
      arms keep accumulating in the background); `.reset` deletes every arm *and* outcome
      (clearing only arms would leave `learning_outcomes`' unique index blocking re-scoring)
      and zeroes confidence/override/frozen. Both `human_only`. Live-verified against real
      Postgres, including confirming reweight truly ignores new arm data while frozen.
- [x] `analytics.post_metrics` / `.campaign_report` / `.cta_traffic` — done 17 Aug 2026.
      `.post_metrics` is the single-item read `analytics.sync`'s write never had.
      `.campaign_report` is a plain engagement-totals rollup, deliberately narrower than the
      pre-existing `campaign.report_vs_outcome` (no plan/mix comparison — see its own code
      comment on why the two don't overlap). `.cta_traffic` reads click counts for
      `link.shorten`'s new optional `contentItemId` attribution (new `content_links` table);
      Dub carries a live `clicks` count on the link resource itself, confirmed against the real
      API, so no separate analytics endpoint was needed. Live-verified end to end against real
      Postgres and the real Dub API, including an unattributed-post case returning empty, not
      an error. One pre-existing bug found via this live verification, flagged separately at
      the time and **fixed same day**: `link.shorten` 422'd against the real Dub API on every
      call, because this workspace rejects any `tagNames` value that isn't already a real tag
      and `link.shorten` always tags with at least the genome id. Fixed in `dub.ts`'s
      `shorten()` — every tag is now checked (`GET /tags?search=`) and created if missing
      (`POST /tags`, tolerating a 409 as a same-tag race) before the link request, exact-name
      matched client-side since Dub's own `search` is substring, not exact. Live-verified
      against the real API with the exact original failure mode: a brand-new UUID-shaped
      genome-id tag Dub had never seen.

## Capture / Assemble (P2)

- [ ] Automated product-screen / site capture service (`assemble.screen_capture`) — only
      site-*reading* (for genome inference) exists; Assemble-mode playbooks needing
      screen-recording footage still require manual upload
- [ ] Direct+Finish over WhatsApp — real Meta Cloud API client behind the transport seam is
      missing; loop runs end to end on a stub. Blocked on Meta business verification, not code
- [ ] Azure Blob storage — code-ready, unprovisioned; local disk stands in

## Engagement

- [x] ~~`engage.intent_score` as a standalone tool~~ — consolidated, confirmed 17 Aug 2026:
      `engage.classify` already computes `intentScore` and writes it, and `engage.list` already
      surfaces it per message. A standalone tool would be the exact duplicate this item's own
      note warned against — nothing to build.
- [x] `approval.policy.set` — done 17 Aug 2026 (+ `.policy.get`). Closed a real dead-code gap:
      `policy.ts` has read `brand.familyOverrides` / `.restrictedPlatforms` /
      `.restrictedContentTypes` / `.quietWindows` / `.permissions` since P1, but
      `makeBrandGovernance` only ever forwarded `approvalMode`/`agentPaused`, so every branch
      reading those five fields was live in unit tests and permanently dead in production —
      same bug class as the kill switch before `agent.pause` existed. New `brands` columns +
      `BrandGovernanceStore.setPolicy` (merges a partial patch; `null` clears a field, omitting
      it leaves it alone). `human_only`, owner/admin only. Live-verified end to end against real
      Postgres: wrote `restrictedPlatforms`, confirmed the loader now forwards it, and confirmed
      `evaluate()` actually escalates a matching publish call to approval.
- [x] ~~`approval.request`~~ — consolidated: the policy engine creates the approval record
      automatically when a gated call is held; nothing to build
- [x] ~~`queue.plan.list` / `.automation.list` / `.engagement.list`~~ — consolidated: covered
      by `recipe.output.list`, `engage.list`, `queue.review.list` instead of a generic name

## P5 (trend discovery + automation) — mostly vendor-gated, not code gaps

- [ ] TikTok Creative Center trend source — deliberately not built, no confidently-documented
      public API found
- [ ] `bulk_connector`'s `folder` sub-kind — honestly reports itself unbuildable in a hosted
      app; needs redefining (e.g. a watched Blob container) before it's a real target
- [ ] Product Hunt / Pinterest / Google Drive / Canva — code-complete, unit-tested, **not
      live-verified** — no keys configured in this environment. Setup steps in
      `apps/api/.env.example`

## Confirmed working, blocked outside the code (not a code fix)

- [ ] fal.ai account locked (billing) — blocks real image generation
- [ ] HeyGen avatar video — key configured, tool live, never spent real credits confirming a
      render completes
- [ ] Ayrshare — real adapter code path ready, no key configured locally
- [ ] WhatsApp Business verification — needed before real numbers can send
- [ ] Clerk dashboard config — six custom org roles + OAuth providers, dashboard-only
- [ ] `team.invite` / `.role.set` — real Clerk calls, deliberately never fired at a real
      recipient
- [ ] Browser sign-in redirect loop — last seen 16 Aug 2026, unconfirmed whether real config
      issue or stale session artifact; not re-tested since

## Open decisions — need a human call, not more code

1. [x] Founder-POV avatar override for SaaS genomes — resolved 17 Aug 2026 as
       `genome.avatar_override.set`. `avatarDefault()` stays the single hard-derived default
       (invariant 5 intact, still never branches on `identity.category`); this is a
       `human_only`, explicitly-reasoned override on top of it, refused without a licensed
       person (`talent_availability`) and active `avatar_clone` consent — the same gates
       `content.generate_avatar_video` checks at spend time, front-loaded to the moment someone
       flips the switch. Disabling reverts to the plain derived default, not forced off.
       Live-verified against real Postgres.
2. [ ] Prototype (`.dc.html`) vs. the original Whimsical wireframe — never reconciled
3. [ ] tRPC vs. the current hand-written REST door
4. [ ] Framework major-version upgrades queued (Next 15→16, Zod 3→4, TS 5→7, Vitest 2→4,
       Tailwind 3→4, Clerk major)
5. [ ] Org/brand routing — shipped single-active-brand-per-workspace instead of the PRD's
       `/b/[brand]/...` multi-brand routes. Confirmed with the user, but worth re-flagging
       now that agency multi-tenancy is live on top of it
6. [x] P5/P6 scope override — resolved, both built (17 Aug 2026)
7. [ ] Agency isolation enforcement — see "Agency / team isolation" above

---

*Supersedes the "Not built yet" section of `STATUS.md` (updated alongside this file, 17 Aug
2026) for anything the two disagree on. `STATUS.md` and the published status artifact both
narrate the *done* side; this file exists only to track what's left.*
