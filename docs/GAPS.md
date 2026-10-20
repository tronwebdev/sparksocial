# Open gaps

What is **not** done. Nothing else.

`STATUS.md` and git history narrate the done side. When an item closes, delete it — do not
tick it. The previous version of this file was a chronological log in which finished work
accumulated as `[x]` entries, 380 of 461 lines describing things that already worked, which
made it useless for the one question it exists to answer.

**Re-audited 17 Oct 2026** against the tree and the deployed manifest. The 21 Aug entries
below were re-checked rather than carried forward; what changed is marked.

**Re-running the audit:**

```bash
curl -s https://sparksocial-api.onrender.com/v1/tools
```

Diff that against the names declared in source — `grep -rhoE "name: '[a-z_]+\.[a-z_.]+'"
packages/*/src/*.ts` — and anything defined but not live is gated on a missing key in
`apps/api/src/tools.ts`. On 17 Oct that diff was **one** tool. Then confirm each apparent
gap by reading the source: most name-level mismatches are deliberate consolidations
documented in `STATUS.md`, not missing capabilities.

Two things that look like evidence and are not:

- **A disabled control's tooltip is not a gap report.** `PlanQueue`'s "Send now" said *"No
  publish-now tool exists"* for weeks. `publish.now` exists and the scheduler calls it on
  every post; the comment had searched for `content.publish_now` and reasoned from its
  absence. Check the registry, not the prose.
- **`STATUS.md` and this file go stale fast.** Both sat untouched from late August while the
  product moved. If the dates at the top are old, measure before you believe.

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
      trainings. Concretely, as of 17 Oct: no tool writes an agency identity or brand theme,
      no domain can be bound (`whitelabel.link.create` exists, domain binding does not), and
      no job source is connected. "Find Clients" is **deliberately** inert — it is prospecting
      by harvesting, and that was a decision, not an omission. §8.13 names them and then says their outputs are *"defined by separate PRD if
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
- [x] **Object storage — resolved 13–17 Oct.** Azure Blob is no longer the target; staging
      runs on Cloudflare R2 (`packages/storage/src/r2.ts`), provisioned and writing. Getting
      there turned up four separate faults worth remembering, because each masked the next and
      three of them presented as the same browser error: a doubled endpoint domain, the bucket
      addressed as a subdomain (which Chrome reports as an SSL error), a missing bucket CORS
      policy, and finally a signed `if-none-match` the browser never sent. **R2 error
      responses carry no `Access-Control-Allow-Origin`, so every one of them reaches the
      console as "blocked by CORS policy".** Trust `scripts/check-r2.mjs` over the browser: it
      is not subject to CORS and separates credentials from configuration in one command.
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

## Found by the 17 Oct audit — small, real, and nobody's blocker

Each verified against the registry, not inferred from a comment.

- [x] **Brand deletion — closed 19 Oct.** Was not on this list, which is its own small
      finding: the agency table drew the design's "remove workspace" action and quietly
      pointed it at Settings under a comment saying no tool deleted a brand. `brand.delete`
      and `brand.deletion.preview` now exist. `effect: 'destructive'`, so policy rule 5 holds
      it for an approval even for an owner, and the panel releases it with `approval.decide`
      — two attributable rows rather than one. The brand's name must be typed, checked in
      the tool and not only in the dialog. The cascade lives in `scoped.ts` because
      `test/isolation.test.ts` rejected the first version for importing `assets` directly,
      and is covered against real Postgres in `postgres.integration.test.ts`, including a
      second tenant holding rows under the same genome id. `tool_calls`, `credit_ledger`,
      `leads` and `idempotency_reservations` survive; `brandDeletion.ts` says why for each.
      Not yet diffed against a design — the prototype has `Settings WS Add Client` and no
      counterpart, so the panel borrows the Assets Library's confirmation frame.
- [x] **`genome.get` exists — closed 19 Oct.** `AgentStep` had been calling it; nothing was
      registered under that name, so every call returned `NOT_FOUND`, the effect
      early-returned, and the step showed an empty avatar/voice state for a brand that had
      both. A label for the name was already sitting in `toolLabel.ts` with no tool behind
      it, so the expectation predates the call. `scripts/check-tool-inputs.mjs` now reports
      all 337 call sites matching the registry.
- [x] **The crawl could hand an error page to the inference pass — closed 19 Oct.** An
      nginx 403 body is 105 characters, and the bar for "this page has content" was 80. So
      the error page counted as a crawled page, which discarded the `blocked` failure (only
      reported when *nothing* was crawled), and the model was asked to infer a brand from
      the word "Forbidden". Pages whose own status says they failed now have to clear a much
      higher bar before they are believed.
- [x] **A malformed inference ended onboarding outright — closed 19 Oct.** The client's
      `withShapeRetry` only checks that a `tool_use` block came back and returns its contents
      unread, so the schema check that matters sat outside every retry. Reproduced live: the
      model answered with its own tool-call markup as a string
      (`identity: "
<parameter name=\"businessName\">…"`). One bad draw was fatal. The
      call and the content check are now retried together, and the rejected field paths are
      logged — `app.ts` serialises only `code` and `message`, so the Zod issues reached
      neither the customer nor the log.
- [x] **HeyGen blamed the customer's photo for our billing — closed 19 Oct.** Every failed
      `talking_photo` upload said "HeyGen rejected the photo (400)". The live 400 was
      `{"code": 400133, "message": "Insufficient credit…"}`. Mapped by cause now; only a
      genuine image rejection mentions the image.
- [ ] **HeyGen's `v1/talking_photo` is a legacy endpoint.** Its own responses carry a notice
      that it is removed on **2026-10-31**. Not acted on from that text alone — it arrived
      inside an API response rather than from the documentation — but it wants checking
      against HeyGen's docs and migrating before the date, because avatar-from-photo stops
      working entirely when it goes.
- [x] **The browser recorder could not upload at all — closed 19 Oct.** `MediaRecorder`
      emits `audio/webm;codecs=opus`; `audio/webm` was missing from the allowlist (while
      `video/webm` was present) and the enum compared the parameterised string literally.
      Both halves fixed. The same file's doc comment already recorded the same class of bug
      shipping once before, for `application/pdf`.
- [x] **Timezones: eighteen of them, four times over — closed 19 Oct.** Onboarding, the
      governance panel, the agency wizard and the personal profile each carried their own
      short list, together covering five regions, and the first select was labelled
      *Country* while its options were IANA region prefixes. A brand in Karachi, Jakarta,
      Mexico City, Istanbul or Seoul could not state where it was — and `campaign.calendar`
      passes this zone straight to `Intl`, so it places every scheduled post. One module now,
      418 zones from the runtime, offsets computed live. The label says Region, because a
      real country mapping is a dataset and `Intl.Locale.prototype.getTimeZones` is absent
      from Safari and from the Node this repo builds on.
- [x] **Two brand-colour pickers, two screens apart — closed 19 Oct.** The Brand Kit step
      and the Brand Details step both rendered `BrandColorPicker` bound to the same
      `brandColors` field. The palette is chosen on Brand Details, beside the logo generated
      from it; the Brand Kit step now shows it rather than offering a second way to set it.
- [x] **Onboarding records consent — closed 19 Oct.** `PersonalizeStep` was the only caller
      of `genome.consent.grant` and nothing imported it, so a voice cloned in onboarding
      played back in preview and then refused at generation time with `FORBIDDEN`. The
      attestation is now asked by `AgentStep` at the moment a likeness is about to be
      created — consent written first, clone second, so a failed grant cannot leave a genome
      pointing at a likeness nobody agreed to. It asks for a name rather than a tick, because
      the rights guardrail checks consent per subject. `genome.avatar.generate` still never
      asks: no real person is involved.
      `PersonalizeStep` itself stays unrendered and is now genuinely dead — it asks for
      pasted HeyGen and ElevenLabs ids, which is the interface `AgentStep` replaced. Worth
      deleting once somebody confirms nothing else wants it.
- [x] **The Agent step can pick a stock voice — closed 19 Oct.** It offered only "clone a
      real person's voice", though five real ElevenLabs ids and a `stockVoiceId` field to
      store the choice both existed, reachable only from Settings. The picker sits in the
      slot Sora Cameo vacated. `voice.preview` now resolves the way `content.voice.generate`
      always has — clone, then the brand's stock pick, then the default — instead of
      refusing with "no voice yet… or paste an existing voice id", which named a control on
      no screen and was wrong about the product: a brand without a clone is not voiceless.
- [x] **Sora Cameo is commented out — 19 Oct.** OpenAI publishes no Cameo API. It had been
      drawn disabled with a tooltip, which reads to the team as a note and to a customer as
      a broken button on the last screen of onboarding. The markup is kept commented with
      its coordinates so restoring it is a two-marker deletion. **The gap itself is still
      open** — see the Sora entry below.
- [x] **The voice controls have a waveform — closed 19 Oct.** The recorder gave no feedback
      beyond the button turning red, and nothing could be heard before it was cloned, so a
      muted microphone and a good take were indistinguishable until ElevenLabs answered
      minutes later on another screen. Now: a live level drawn from the `MediaStream` while
      recording, and a waveform of the captured or uploaded clip with playback before
      anything leaves the browser — an uploaded file goes through the same review, since a
      file picked from disk is named rather than heard and is the case most likely to be
      wrong. Built on `AnalyserNode` and `decodeAudioData` rather than a waveform library;
      the bar-height reduction is pure, in `packages/shared/src/audioPeaks.ts`, and tested.
      *Also corrected against the design while in there:* the recording label is
      **"Recording…"**, not "Stop recording", and the mic glyph pulses —
      `recordAnim: 'ss-pulse 1s ease-in-out infinite'` in `SparkSocial Onboarding.dc.html`.
      The keyframes already existed in `tokens.css` and matched.
- [x] **The test-voice player is the one the design draws — closed 19 Oct.** `VoicePlayer`
      at 457,236 built to its own measurements: the 32px play circle at 10,7 with the
      design's own glyph path, elapsed at 41,17 in 10.5/500, the seekable 281x17.9 track at
      65,14 with its black bar, gradient fill and 17.9px knob, and the duration at 354,17.
      What was there was the pill, the button, and one status string where the whole
      transport should have been — so the control whose only job is to let you listen to
      something could not say where you were in it, go back three seconds, or report how
      long it was. Click-to-seek is the design's; drag and arrow keys are not, and are here
      because a drawn knob that cannot be dragged is a control lying about what it is.
      Seek verified against a real 20-second clip: clicking at 75% lands at 15.02s, dragging
      past the right-hand end clamps to exactly 1.0.
      The clock is `clockMMSS` in `packages/shared`, not the design's
      `"0:" + floor(t).padStart(2,'0')` — which is right for its own 46-second mock and
      renders 65 seconds as `0:65`. The 280-character cap moved under the textarea, since
      the design leaves the player no room for it and `voice.preview` enforces the ceiling
      because ElevenLabs bills per character.
- [ ] **Nothing in the pipeline enforces the rules of hooks.** `eslint-plugin-react-hooks`
      is not configured, and `next build` prints "Skipping linting", so a hook placed after
      an early return type-checks, builds, and then throws React error #310 at runtime —
      during render, which takes the whole app down to the "client-side exception" screen
      rather than degrading. It happened in `BrandKitStep` on 19 Oct and was found only by
      walking the deployed flow in a browser. `apps/web` has no component tests either, so
      there are currently three layers that all pass a component that cannot render.
- [x] **The crawled brand kit reaches the screen that uses it — closed 20 Oct.**
      `genome.bootstrap_from_url` wrote the palette, fonts and logo onto governance and
      `BrandDetailsStep` initialised both to empty and never read them back, so the crawl
      found `#146b33` and the brand's real wordmark and the very next screen showed an empty
      swatch row and an empty logo tile. Not cosmetic: "Generate logo" is on that screen and
      takes the palette, so a logo was generated against no colours while the real ones sat
      in the database, and anything picked there overwrote them unseen.
- [x] **The palette extractor reads a neutral brand — closed 20 Oct.** missoma.com, whose
      identity is gold and cream, returned `#0000ee, #0a4563, #1a73e8`: browser default link
      blue and Google blue off an embedded widget. Chroma was both causes — it admitted an
      accident because it was saturated and discarded the identity because it was not.
      Three changes. The probe now reports each colour's **share of the viewport**, which is
      the signal chroma was standing in for: a link's blue is a few hundred pixels and a
      cream background is a third of the page. UA defaults are refused outright. And plain
      white and black are refused at any size, because admitting large neutrals fixed the
      cream and immediately put `#ffffff` at the head of both missoma's and stripe's
      palettes — the line is the tint, since `#f6f1e7` is a decision and `#ffffff` is what
      you get for not making one.
      Measured after, with the real crawler: missoma `#0a4563`; stripe `#0d1738, #533afd,
      #e8e9ff…` (its navy and its purple); clientforce unchanged at `#146b33, #d9edf2,
      #f2decd`, the warm cream surviving as a tinted neutral.
- [x] **The crawl's niche and description reach the screen — closed 20 Oct.** Two separate
      holes on Brand Details. `identity.category` is free text by design — the model
      describes what the site says rather than picking from a list it has never seen — so
      the real answers (`"Jewellery brand / DTC e-commerce"`, `"B2B SaaS"`) matched no option
      and the select sat on "Choose one". `resolveNiche` in `packages/shared` maps it, and
      falls back to "Something else" keeping the original wording rather than losing it.
      `one_liner` was never loaded at all: the field's placeholder is a hard-coded example
      about AI agents, so a jewellery brand that had just been read correctly showed an empty
      box suggesting it sold software — and `canGenerateLogo` requires that field, so
      "Generate logo" sat disabled saying "Add what your brand does first" about a brand
      whose description was already in the database.
- [x] **The OpenAI fallback was dead, and nothing knew — closed 20 Oct.** It sent
      `max_tokens`, which every configured tier refuses outright: *"Unsupported parameter:
      'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."*
      Verified against the live API — `gpt-6-astra`, `gpt-6.1-sol` and `gpt-6-luna` all 400
      on the old parameter and 200 on the new one. So the one-shot retry that exists to
      survive a primary-vendor failure had never once worked.
      Found the only way it could be: Anthropic hit `"Your credit balance is too low to
      access the Anthropic API"` mid-session, the fallback fired for real for the first
      time, and onboarding showed `OpenAI fallback returned 400.` A fallback only runs when
      the primary is already failing, so nothing exercises it on a good day — the same
      "only shows up on the day you need it" shape as the stale `gpt-image-1` model id.
- [ ] **The fallback cannot serve a forced tool call on the tier that was asked for.** Fixed
      to the extent it can be on `/v1/chat/completions`, and the limitation is real.
      Measured against the live API, all three configured tiers, 20 Oct:

                     text only   + tools   + tools, reasoning_effort 'none'
          astra        200         400       400 (rejects 'none')
          sol          200         400       400 (rejects 'none')
          luna         200         400       200

      `Function tools with reasoning_effort are not supported for <model> in
      /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort
      to 'none'` — and the two larger tiers accept only low/medium/high/xhigh. So a forced
      tool call now goes to `gpt-6-luna` with `reasoning_effort: 'none'` whatever tier it
      asked for. Every writer in this codebase forces a tool call, so the alternative was a
      fallback that could serve nothing but the agent loop's free-text turns.
      The cost is a quality drop on exactly the calls that matter most, during an incident.
      `/v1/responses` would let the larger tiers serve tools and is a different request and
      response shape end to end — worth doing if the fallback ever stops being a last resort.
- [ ] **Nothing exercises the OpenAI fallback on a good day.** The bug above shipped because
      the fallback path has no test that reaches a real vendor and no synthetic check at
      boot. A periodic one-token call against each configured tier would have caught it the
      day the parameter changed rather than the day Anthropic ran out of credit. Same
      argument as `secrets.manifest`'s required/optional split: a dependency that is only
      touched during an incident needs its own heartbeat.
- [ ] **The owed `.dc.html` fidelity diff — two screens of ten read, 20 Oct.** CLAUDE.md has
      recorded this as owed since the 17 Oct audit. `scripts/colour-audit.mjs` ranks each
      screen by colours it paints that its own design never specifies, splitting them into
      **borrowed** (present in a sibling prototype, usually a deliberate system value) and
      **invented** (in no prototype at all). Only the second list is worth reading:

          screen           colours  borrowed  invented
          settings              41         8        20
          command-center        64         6        14
          discovery             41         7         7
          agency               119         1        19
          assets                28         1         3
          calendar              22         0         2
          dashboard             25         1         1
          automation            48         0         0
          onboarding            23         5         0
          engagement             8         2         0
          draft-panel           12         0         0

      Splitting the two buckets changed the picture: `engagement` had read as 75% off-design
      and is 0% invented — every one of its six was the brand gradient borrowed from Auth.
      `discovery` fell from 40% to 14% the same way. The first version over-reported, badly.
      **Done: onboarding, discovery, agency, command-center, assets, automation, calendar,
      dashboard, draft-panel, engagement.** Only `settings` is unread, and its 20 are
      vendor brand hex (TikTok, Reddit, Bluesky) plus `COLOUR_PRESETS`, five named brand
      kits a customer picks from — product data, not chrome. Onboarding's five remaining are `PALETTE`, the
      swatches a customer picks. Discovery's five are app-wide conventions used in 3–6 files
      each — muted-source amber, the metric tones — for states no prototype draws.
      Agency's chips now come from one `statusTints.ts` rather than four copies that had
      already diverged on the red, and its mark gradients say why four of the five are not
      in the prototype. Its remaining count is unchanged on purpose: the values are still
      off-design, but in one documented place instead of scattered.
      `settings` leads on invented count and most of it is vendor brand hex (Reddit's
      `#ff4500` and friends), so the true worklist there is smaller than 22.
      *Copy diffing is not worth repeating.* `scripts/design-copy.mjs` exists and mostly
      produces false positives: a prototype draws one populated happy path per screen, so
      nearly every difference is the empty state, unknown status or error the app invented
      around it. `#F1F1F4` in `PlanQueue` reads as drift and is the chip for a status the
      design never drew; `CTA Clicks` became `Posts published` because
      `analytics.brand_series` has no click field, which `KpiRow` explains in place. The
      colour axis carries the signal.
- [x] **The Failed chip is the design's — closed 20 Oct.** `PlanQueue` painted it
      `#FDE9E2` over `#D2470F` with a `#F35525` ring. Those first two are the *Dashboard*
      prototype's **"Warm"** chip — a lead-temperature badge — and the correct ring bolted
      onto them is what made the whole thing look deliberate. `SparkSocial Automation.dc.html`
      draws the real one: `#FDECEC`, ring `#F35525`, text `#F35525`. `blocked` ("Stopped")
      keeps the warm pair on purpose: a guardrail hold is not a failure, and the two chips
      being identical was its own small lie.
      The agency reds stay where they are — a declined proposal and a lost lead are ordinary
      outcomes, not errors.
- [x] **~~`PostPreview` cites a measurement that is in no prototype~~ — wrong, corrected
      20 Oct.** It cites `#CFFCCF` / `#13AD12` and both are in `DP prevText.dc.html`, written
      as `rgb(207,252,207)` and `rgb(19,173,18)`. The comment was right and the audit was
      blind: `colour-audit.mjs` matched only `#rrggbb`, and **48 of the 61 prototypes write
      at least some colours as `rgb()`**. Kept rather than deleted because an entry accusing
      correct code of being wrong is worth leaving visible once it has been corrected.
      Fixed in the script, which now reads both forms — and the line that reads `rgb()` had
      its own bug: a `` written into the file as a literal backspace byte, so the regex
      silently matched nothing and the first "fixed" run reported the identical numbers.
- [ ] **No `content.delete`.** The calendar and the Plan Queue both draw a delete control and
      both disable it. Removing a planned post is a thing the PRD's calendar flows assume
      (`CAL-05`, `CAL-06`) and the registry has no tool for. The nearest neighbours —
      `asset.archive`, `recipe.delete` — show the shape it should take.
- [x] **"Send now" — closed 17 Oct** by `content.publish_payload`, which assembles what
      `publish.now` takes and stops there. Not `content.publish_now`, deliberately: the invoke
      layer runs `claim_grounding` and `compliance_profile` against a tool's **input**, so a
      tool taking only `{ contentItemId }` would publish with those guards blind — and
      `compliance.ts` says of its verticals *"do not ship these without this in place"*. The
      alternative, a handler calling `invokeTool` on `publish.now`, would have been the first
      reentrant tool in the codebase. Two honest calls instead. The scheduler now shares the
      same three assembly functions rather than owning the only copy.
- [x] **Status set — closed 17 Oct.** `failed` added beside `blocked`, and the scheduler
      splits them: a guardrail refusal stays `blocked` (the content must change), while a
      genome that vanished, a playbook that stopped resolving, a draft that produced no copy
      and five exhausted publish attempts are now `failed` (the content is fine; fix the
      cause and reschedule). `status` is a plain `text` column, so no migration. The `Failed`
      chip `PlanQueue` already drew is now reachable, and `DraftsList` offers "Retry" against
      `blocked`'s "Resume".
- [ ] ~~**The content status set does not match PRD §7 rule 4.**~~ *(superseded by the entry
      above; kept one release for anyone reading an older checkout)* The PRD names *Draft → Needs
      Review → Approved → Scheduled → Published, Failed / Blocked*. `ContentStatus` is
      `draft, needs_review, approved, scheduled, published, blocked, rolled_back` — no
      `failed`, plus a `rolled_back` the PRD does not name. Every technical failure
      (`markBlocked` after the scheduler's five attempts, a dead platform connection, a
      playbook that no longer resolves) lands in `blocked` beside genuine policy blocks, with
      the distinction carried only in a reason string.
- [x] ~~**`PlanQueue` renders a `Failed` chip the backend cannot produce.**~~ Closed by the
      same change — the chip now has a status behind it.
- [ ] ~~**`PlanQueue` renders a `Failed` chip the backend cannot produce.**~~ The status chip map
      includes `failed: { label: 'Failed', … }`; nothing ever sets it. A dead branch today,
      and a half-built answer to the item above — whoever adds `failed` should check this
      first, because the UI is already waiting for it.
- [x] **Brand palette from a crawl — closed 19 Oct.** `crawl.ts` now runs a probe on the
      entry page that reads the site's `--brand*` custom properties, its button and header
      fills, its heading and body typefaces and its masthead logo;
      `genome.bootstrap_from_url` returns them and writes them onto brand governance where
      nothing had been chosen yet. The "Use this brand preset" toggle is live and switches
      back to the owner's own choices. Measured, not assumed: stripe.com yields
      `#533afd` + `sohne-var`, clientforce.io `#146b33` + `Schibsted Grotesk` and its real
      logo. The judgement — which colours are the brand's and which are the paper — is pure
      and unit-tested in `packages/genome/test/brandKit.test.ts`; the probe itself needs a
      browser and therefore decides nothing.
      *Found on the way:* `page.evaluate(fn)` of anything with a named inner function died
      with `ReferenceError: __name is not defined`, because tsx compiles named functions to
      esbuild's `keepNames` helper and that helper does not exist inside the page. The
      existing `page.evaluate` calls survived only by being single anonymous arrows. Shimmed
      in `crawl.ts` via `addInitScript`.
- [ ] **`analytics.sync` is the only tool not live** — gated on `AYRSHARE_API_KEY`. Until it
      is set, every performance surface shows its empty state truthfully and the learning loop
      has no outcomes to learn from. This is the key with the widest blast radius.
- [ ] **Sora Cameo** has no public API to build against. The onboarding control is drawn,
      disabled and says so. Listed here because it is the one disabled control in onboarding
      that is *not* going to be fixed by writing code.
- [ ] **Clerk is on development keys against a public domain.** Dev instances authenticate via
      a `__clerk_db_jwt` dev-browser cookie rather than a first-party session, which browsers
      increasingly restrict — the visible signature is page navigations working while `fetch`
      calls to `/api/*` intermittently 404 (`__clerk_hs_reason=dev-browser-missing`). A
      production instance with the deployed domain registered is the fix, and it should land
      before design partners touch staging.

## Verification owed

**Done.** A signed-in browser pass ran on 2026-08-21 against the real API and dev Postgres,
covering `/home`, `/agents`, `/account`, `/settings`, `/calendar`, `/discovery`, `/assets`,
`/automation` and `/command-center`, plus the campaign wizard end to end and the Draft Panel.
The five cases this section said to reach deliberately were reached; what they turned up is
below, because the point of the pass was to find things a type system cannot check.

Confirmed working as designed: `PerformancePanel` with no campaign (em dashes with reasons
beside real zeros, and the 7d/30d/90d toggle moves the window), `KnowledgePanel`'s
nothing-attached warning, `ConnectAccountsStep`'s refusal-by-name, `PlanQueue` and the audit
log's "rejected before policy" rows, and the calendar showing no filters while it is empty.

### Found by looking, fixed in this pass

- [x] **Every semantic-colour tint in the product rendered transparent.** `tailwind.config.ts`
      mapped colours to bare `var(--ss-*)`, which Tailwind 3 cannot inject an alpha channel
      into, so it emitted no `bg-warn/10` rule at all — 36 utilities across 10 files, every
      amber "held for review" block, green publish receipt and red rollback notice with no
      fill. It fails open, which is why it survived: measured `rgba(0, 0, 0, 0)` in the
      browser. Fixed with a `color-mix` helper, which leaves the 22 `.tsx` sites that use
      `var(--ss-*)` directly working — switching `tokens.css` to RGB channels would have
      broken all of them.
- [x] **`genome.create` declared `idempotent: true` and inserted a genome on every call.**
      The registry flag only stops the middleware demanding a key. Re-running onboarding —
      routine, since `genome.bootstrap_from_url` fails when the vendor is down — left one
      brand with two genomes and the switcher listing the same name twice with nothing to
      tell them apart. The tool's own comment described preventing exactly this. Now reuses
      the brand's genome and merges the identity, so a retry that corrects the name works;
      verified against Postgres (three calls, two genomes) and covered by 8 unit tests.
- [x] **Six `Explanation` sentences printed raw asset-role enums**, and one printed
      `1 gap(s)`. `ASSET_ROLE_WORDS` / `assetRoleWordList` in `packages/shared` now supply the
      words, and `ResolvedPlaybook.missingRoles` is `AssetRole[]` rather than `string[]` —
      the playbook schema already typed it that way, and widening it is what cost the callers
      the safety that let this happen.
- [x] **The platform label map existed three times**, two copies covering only the five
      native platforms, so Settings listed `youtube_long` and `facebook_group` beside a
      properly-named "YouTube Shorts". One `apps/web/src/lib/platforms.ts`, with a fallback
      that prettifies an unmapped platform instead of printing a token.
- [x] **Connection cards overlapped their own status pill.** `min-w-0` on the text column let
      it shrink below its content while the badge kept its width, so the text ran underneath.
- [x] **The campaign wizard's mix chart carried no information.** Bar widths divided by
      `buildableNow`, which is `0` for any brand before its first capture session, so every
      width came out `count * 100%` and the track clipped all five to full. It was also
      labelled "0 posts SPARK can make right now" above rows summing to 13. Now scaled and
      labelled by the mix total, which is what `planCampaign` sizes the mix to.
- [x] **"Posts planned: 0" on the confirm step** — same substitution, on the screen that asks
      you to commit. Now "0 of 13" with a note about what closes the gap, which matches the
      calendar that appears next.
- [x] **`playbook.resolve`'s summary had no case for "all formats need filming".** It fell
      into the partial branch and read "7 formats fit this local business, 7 of them once
      something gets filmed", implying some subset was postable today. None was — and that is
      the state every brand is in before its first capture session.
- [x] **`engage.eligibility`'s `why.summary` was the `reason` string verbatim**, printed
      directly above the popover, so "Show reasoning" returned the line just read. It now
      explains why the gate has two conditions, which is the part not on the screen.
- [x] **The brand-kit pairing this section flagged was real, and worse than described.**
      `resolveKit` was documented as refusing to derive contrast because "a wrong guess
      produces white text on cream" — but `DEFAULT_TYPE` is `#FFFFFF`, so a brand naming one
      light ground got precisely white on cream, rendered and published silently. Always
      choosing white is as much a guess as choosing by luminance. Now picks black or white by
      WCAG relative luminance — never a derived hue, so it still invents no brand colour, and
      it cannot do worse than the constant on any input. Tested to clear 4.5:1.

### Still owed

- [ ] **`StallNotice`** — still not reached. It needs a post to exhaust the scheduler's
      five-attempt ceiling against an unconnected platform, which no screen can force; it
      wants a seeded fixture or a wait.
- [x] **`apps/web` can now import `@sparksocial/shared`,** which CLAUDE.md always permitted
      and the build always refused. The cause was not the missing build output: it was webpack
      taking the package's `./types.js` specifiers literally, where `tsx` (how `apps/api` runs)
      resolves them to `.ts`. `next.config.ts` now sets `resolve.extensionAlias` so webpack
      tries `.ts`/`.tsx` first, and `oauthState` is no longer re-exported from the barrel —
      one server-only module importing `node:crypto` made the whole barrel unusable in any
      browser bundle. Proven by deriving `assets/roles.ts` from `ASSET_ROLE_WORDS` and running
      a real `npm run build:web`: compiled, 24/24 static pages.

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
