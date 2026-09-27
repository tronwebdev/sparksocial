# SparkSocial — Feature Guide

Every feature that is built, what it is for, **the steps to test it**, and how to
tell it worked.

Each entry is the same shape:

> **What it is** — one line.
> *Story* — whose job it does.
> **Where** — the screen.
> **Steps** — numbered, do these.
> **Pass when** — what you should see.

Work through it in order and it doubles as a first run of the product: §1 creates a
brand, and everything after it has something to act on.

**Before you start**

1. API answers at `http://localhost:8080/health` with `status: ok`.
2. Web app loads at `http://localhost:3000`.
3. Migrations are applied: `npm run migrate -w @sparksocial/db`.
4. Have `docs/TEST_BUSINESSES.md` open — three businesses with every answer ready
   to paste.

---

# 1. Getting started

## 1.1 Brands and workspaces

**What it is** — one account holds many brands; each has its own content, assets,
connections and rules, and they never see each other's.
*Story (agency operator)* — "Keep my clients properly separated."
**Where** — `/workspaces`, and the brand switcher at the top of the sidebar.

**Steps**
1. Sign in and complete onboarding once (§1.2) so one brand exists.
2. Open `/workspaces` → **Add Brand** → create a second, using a different test
   business.
3. Upload an asset to brand B (`/assets`).
4. Switch to brand A with the sidebar switcher and open `/assets`.

**Pass when** — brand A does not show brand B's asset. Calendar, settings and
connections are likewise separate.

## 1.2 Onboarding — the five questions

**What it is** — five questions producing a brand "genome": what you can show,
what you can film, what you are trying to achieve, whether anyone appears on camera.
*Story (solo owner)* — "Set me up without a two-hour form."
**Where** — `/onboarding`

**Steps**
1. Sign in with an account that has no brand — you are sent here automatically.
2. Answer all five using **Fernhill Roastery** from `TEST_BUSINESSES.md`.
3. Write down the answers you gave.
4. Finish and let it drop you into the app.

**Pass when** — you land in the app, not back at onboarding, and `/workspaces`
lists the brand.

## 1.3 Build a brand from a website

**What it is** — point SPARK at a URL and it fills the brand in from the page.
*Story (solo owner)* — "You can read what my business does."
**Where** — onboarding, the "read my website" option.

**Steps**
1. Start onboarding for a **new** brand.
2. Choose to supply a website instead of answering.
3. Paste a real small-business URL.
4. Read what comes back.

**Pass when** — name, category and one-liner are filled in and marked as
*inferred* rather than confirmed, so you can correct them before continuing.

---

# 2. Brand setup — Settings → Brand Kits

Everything here applies to every post automatically.

## 2.1 Workspace logo

**What it is** — the logo used on rendered images and video.
**Where** — Settings → Brand kits → *Workspace logo*

**Steps**
1. Press **Upload** and choose `docs/test-assets/fernhill-logo.png`.
2. Save.
3. Now clear it and press **Generate a placeholder** instead.

**Pass when** — the logo previews immediately after each action, and the generated
one is a plain flat shape with no lettering.

## 2.2 Colour theme

**What it is** — three colours in order: background, text on it, accent.
**Where** — Settings → Brand kits → *Color Theme*

**Steps**
1. Click a palette preset.
2. Now set the first two colours to something deliberately unreadable — e.g. mid
   grey text on light grey.
3. Look at the contrast strip underneath.
4. Fix it, and save.

**Pass when** — the strip shows your text colour on your background colour, so the
unreadable pair is obvious on screen before it ever reaches a post.

## 2.3 Brand voice

**What it is** — four tone sliders plus the narration voice for video.
*Story (creator)* — "It should sound like me."
**Where** — Settings → Brand kits → *Brand Voice*

**Steps**
1. Set **formal 0.9 / playful 0.1** and save.
2. Generate a draft (§3.2) and keep the text.
3. Come back, set **formal 0.1 / playful 0.9**, save.
4. Generate another draft on the same playbook.
5. Compare the two.

**Pass when** — the writing is visibly different between them.

## 2.4 Typography

**What it is** — display and body typefaces for rendered posts.
**Where** — Settings → Brand kits → *Typography Style*

**Steps**
1. Pick a display face and a different body face.
2. Watch the sample block.
3. Save, then render an image post (§3.7).

**Pass when** — the sample renders in the chosen faces on your brand colours, and
the rendered image uses them too.

## 2.5 Strict compliance

**What it is** — restricted topics, claims to avoid and banned words, plus a switch
deciding whether a violation **blocks** a post or **holds** it.
*Story (agency operator)* — "This client must never say that."
**Where** — Settings → Brand kits → *Enable Strict Compliance*

**Steps**
1. Add `guaranteed` to **Claims to avoid** and `artisanal` to banned words.
2. Turn strict mode **on**. Save.
3. Generate five drafts (§3.2).
4. Read each one for those words.

**Pass when** — neither word appears. If one ever does, the post is marked
**blocked** with the reason on the item — it is not silently published.

## 2.6 Watermark

**What it is** — whether the logo is stamped on rendered media, and at what size
and opacity.
**Where** — Settings → Brand kits → *Watermark* (appears once a logo is set)

**Steps**
1. With a logo set, confirm the Watermark card is visible.
2. Leave it on, render an image post (§3.7), look at the output.
3. Turn the watermark **off**, save, render again.

**Pass when** — the first render has the logo bottom-left, the second has none, and
the logo is still set in §2.1 either way.

## 2.7 Brand knowledge

**What it is** — documents and pages SPARK may cite. Without them, guardrails hold
any specific factual claim.
*Story (any)* — "Only say what's actually true about us."
**Where** — Settings → Brand kits → *Brand Knowledge*

**Steps**
1. Upload `docs/test-assets/fernhill-knowledge-base.pdf` (or
   `harbour-lane-knowledge-base.pdf`).
2. Wait for it to finish processing — it reports pages and chunks.
3. Generate a draft that would need a specific fact.
4. Now generate one that states a number the document does **not** contain.

**Pass when** — step 4 is blocked or flagged with a grounding reason, and the
document counts toward the `knowledge` asset role so knowledge-dependent formats
resolve.

> **What it does not do.** Attaching knowledge does not feed the writer. The
> chunks are read by `guard.claim_grounding`, which *checks* what was written
> against them — the copy writer never receives them, in any mode. So a draft
> will not start quoting your prices because you uploaded a price list; it will
> start being stopped when it invents one. Supplying facts to a post is what the
> **intent** field and `assemble`-mode asset captions do.

## 2.8 Offer

**What it is** — what you sell, and your primary call to action.
**Where** — Settings → Brand kits → *Brand Knowledge* → Offer

**Steps**
1. Set the primary CTA to `Start a subscription`. Save.
2. Generate a draft on a **product** playbook.
3. Generate one on an **educational** playbook.

**Pass when** — the product post carries the CTA; the educational one does not.
Educational, proof and personality posts deliberately never pitch.

## 2.9 Templates

**What it is** — the layouts a post is built into: intros/outros, bumpers, caption
presets, lower-thirds.
**Where** — Settings → Brand kits → *Templates*

**Steps**
1. Open each of the four tabs.
2. Add a template: give it a name and save it.
3. Open the **Versioning & approvals** tab.

**Pass when** — the template you added persists after a refresh, and the Versioning
tab says **"Not built"** with an explanation. That is correct, not a defect.

## 2.10 Consent and avatar

**What it is** — whose face and voice SPARK may use, with a consent record, plus
avatar and voice-clone configuration.
*Story (creator)* — "Use my likeness, but only on the record."
**Where** — Settings → Brand kits → *People and likeness*

**Steps**
1. With **no** consent record, look at the available playbooks (§3.1).
2. Grant a consent record for a named person.
3. Look at the playbook list again.
4. Revoke the consent and look once more.

**Pass when** — avatar formats are unavailable at step 1, available at step 3, and
unavailable again at step 4.

## 2.11 What this brand has learned

**What it is** — SPARK adapts the content mix from measured results; this shows
what it has learned and lets you freeze it.
**Where** — Settings → Brand kits → *What this brand has learned*

**Steps**
1. Read the current confidence and what it is based on.
2. Press **Freeze**.
3. Refresh the page.

**Pass when** — it reports itself frozen and keeps what it already knew, rather
than resetting to nothing.

---

# 3. Making content

## 3.1 Playbooks

**What it is** — around fifteen content formats; which you are offered is decided
by your genome, never by your industry.
*Story (creator)* — "Show me formats I can actually make."
**Where** — Command Center (`/home`) → new post.

**Steps**
1. On **Fernhill Roastery** (physical craft), open the playbook list and note it.
2. Switch to **Northgate Actuarial** (data outcomes) and open the list again.
3. Open the **why** on any single playbook.

**Pass when** — the two lists differ meaningfully, and the why explains the choice
in terms of what the brand can show or film — never "because you're a coffee shop".

## 3.2 Drafting a post

**What it is** — turns a chosen format into real copy, beat by beat, in your voice.
**Where** — Command Center → new post → pick a playbook → draft.

**Steps**
1. Pick a playbook and press draft.
2. Optionally give an intent: `this week's Ethiopian arrival`.
3. Wait for every beat to fill.
4. Open the **Preview** tab and read the assembled post.

**Pass when** — every beat is filled at a sensible length, the post does not ask
for the booking twice, and it ends with **hashtags specific to this post** — not
`#smallbusiness` filler.

## 3.3 Regenerating one beat

**What it is** — rewrite just the hook, or just the CTA, leaving the rest alone.

**Steps**
1. In a drafted post, copy the text of two beats.
2. Regenerate **one** of them.
3. Compare both against what you copied.

**Pass when** — only the beat you asked for changed.

## 3.4 Variants and repurposing

**What it is** — several takes on one idea, or the same idea rebuilt as a different
format for a different platform.
*Story (creator)* — "Turn one idea into a week of content."

**Steps**
1. On a drafted post, generate **variants**.
2. Separately, **repurpose** a LinkedIn post into an X format.
3. Open the repurposed post's preview and count the hashtags.

**Pass when** — variants are genuinely different takes, and the repurposed X post
carries **at most two** hashtags — its own, sized for X, not the LinkedIn original's.

## 3.5 Generated media

**What it is** — images, AI b-roll, avatar video, voiceover and dubbing, generated
into individual beats.
**Where** — Draft Panel → a beat → the generate actions.

**Steps**
1. On an image playbook, generate an image into a beat.
2. On a video playbook, generate b-roll into one beat and a voiceover into another.
3. Note a beat's label and length, then dub that beat into another language.

**Pass when** — generated media replaces the beat and **keeps its timing and
label**. The dub replaces the beat in place rather than adding a second one.

## 3.6 Storyboard editing

**What it is** — add, remove, retime and relabel scenes; add a lower-third; override
the voice for one scene.
**Where** — Draft Panel → Storyboard.

**Steps**
1. Note the running total at the top.
2. Insert a scene, then retime an existing one.
3. Add a lower-third name plate to one scene.
4. Now try to retime a scene so the video is far longer than the format allows.

**Pass when** — the running total updates each time, and step 4 is **refused with
the reason**, not silently accepted.

## 3.7 Rendering

**What it is** — composes the beats into finished files, one per aspect ratio.

**Steps**
1. With colours, type and logo set (§2.1–2.4), open a finished post.
2. Render it.
3. Open the output.

**Pass when** — output uses your brand colours (first colour as ground, second as
the text on it), your typefaces, and your logo bottom-left.

---

# 4. Assets Library

## 4.1 Uploading and auto-captioning

**What it is** — your photos, video and documents, captioned automatically so they
can be found by meaning.
**Where** — `/assets`

**Steps**
1. Upload four or five images with meaningless filenames (`IMG_4821.jpg`).
2. Wait for captions to appear.
3. Search for something **in** one of the pictures, not its filename.

**Pass when** — search finds the image by its contents.

## 4.2 Folders and organisation

**What it is** — folders, moving, renaming, membership.
*Story (agency operator)* — "Keep a client's material in order."

**Steps**
1. Create a folder.
2. Move two assets into it.
3. Rename the folder, then refresh.

**Pass when** — the folder, its name and its contents all survive the refresh.

## 4.3 Roles and gaps

**What it is** — assets carry roles (social proof, product shot, work artifact…),
and SPARK can say which missing role blocks the most formats.

**Steps**
1. Set a role on one uploaded asset.
2. Open the gaps view for the brand.
3. Read the order of the list.

**Pass when** — gaps are ordered by how many formats each missing role would
unlock, so the top of the list is what to shoot first.

## 4.4 Rights and reuse cooldown

**What it is** — a rights status per asset, and a cooldown so the same photo is not
used every week.

**Steps**
1. Set one asset's rights status to restricted.
2. Draft several posts in a row on the same playbook.
3. Watch which assets get picked.

**Pass when** — a restricted asset is not used, and an asset used in one draft is
passed over for a fresh one in the next.

---

# 5. Campaigns and the calendar

## 5.1 Readiness check

**What it is** — before a campaign is created, a checklist of what would stop it
producing anything, split into **blockers** and **warnings**.
*Story (solo owner)* — "Tell me what's missing before I commit."
**Where** — `/campaign/new`, on confirm.

**Steps**
1. Use a brand with **no** connected account and **no** assets.
2. Start a campaign, choose an objective, and confirm.
3. Read the modal before doing anything else.

**Pass when** — the modal appears **before** the campaign is created. "Nowhere to
publish" is a **blocker**; a missing asset is a **warning** carrying the number of
extra posts it would unlock. The button reads **Create anyway** — you are not forced
to fix anything.

## 5.2 Creating a campaign

**What it is** — an objective and a window; SPARK plans the mix and fills a calendar.

**Steps**
1. Connect one account first (§6).
2. Create a campaign with objective **sales** over 30 days.
3. Open `/calendar`.
4. Count how many posts are promotional versus educational.

**Pass when** — the calendar has posts on it, and they are spread across content
pillars rather than being all promotional.

## 5.3 The calendar

**What it is** — the month, with drag-to-reschedule and slot recommendations.
**Where** — `/calendar`

**Steps**
1. Drag a post to a different day.
2. Refresh the page.
3. Now open the calendar of a brand with **no** campaign.

**Pass when** — the move survives the refresh, and the empty calendar explains
*why* it is empty rather than just saying "nothing scheduled".

## 5.4 Publishing

**What it is** — posts go out on schedule, or immediately.
**Where** — Draft Panel → Preview → Publish.

**Steps**
1. Connect **Bluesky** (§6) — it needs only a handle and an app password.
2. Open a finished draft, press Publish, choose Bluesky.
3. Open the post on Bluesky itself.

**Pass when** — the post is live, the text matches the preview exactly (including
hashtags), and the item in SPARK carries a receipt and a link back.

## 5.5 Rollback

**What it is** — take a published post back down.

**Steps**
1. On the post from §5.4, press rollback and confirm.
2. Check Bluesky.
3. Look at the item in SPARK.

**Pass when** — gone from the platform, but the record is **kept and marked rolled
back**, not deleted.

## 5.6 Tracked links

**What it is** — shortens your CTA link so clicks can be counted.

**Steps**
1. On a draft, shorten the link.
2. Look at the Preview.
3. Publish and open the live post.

**Pass when** — the short link sits **after** the hashtags, and the platform still
builds a preview card from it.

---

# 6. Connecting accounts

**What it is** — connect the platforms you publish to.
**Where** — Settings → Account Connection

**Connectable today:** X, TikTok, LinkedIn, YouTube, Google Business (OAuth), and
**Bluesky** (handle + app password, nothing to set up).
**Not configured:** Instagram, Facebook, Threads, Pinterest, Reddit — `docs/VENDOR_SETUP.pdf`.

**Steps**
1. Connect **Bluesky** first: your handle and an app password from your Bluesky
   settings. It needs no vendor setup, so it isolates "does connecting work".
2. Then connect an OAuth platform — X, TikTok or YouTube.
3. On the consent screen, note whether you are asked **which** account to use.
4. Back in SPARK, read the tile.
5. Leave it a while and re-open the page.

**Pass when** — step 3 asks which account; the tile shows **your** account name and
picture rather than a generic platform name; health shows when the token expires;
and the token refreshes on its own before it does.

---

# 7. Discovery

## 7.1 Trends

**What it is** — what is moving now, scored against your brand.
*Story (creator)* — "What should I post about today?"
**Where** — `/discovery`

**Steps**
1. Open Discovery and let it load.
2. Open the **why** on the top-scoring trend.
3. Scan the list for anything wildly unrelated to the business.
4. Run `npx tsx --env-file-if-exists=apps/api/.env scripts/check-trend-sources.mts`.

**Pass when** — every trend carries a score and a why; nothing off-brand appears
(it is removed, not shown faintly); and the script reports which sources are live.
Four of eight are expected: YouTube, Hacker News, Product Hunt, Google Trends.

## 7.2 Turning a trend into a post

**Steps**
1. Pick a trend with a decent score.
2. Press repurpose.
3. Read the resulting draft.

**Pass when** — the draft is about that trend, in your brand's voice, using a
format your brand can actually make.

## 7.3 Watchlist, muting and influencers

**Steps**
1. Add a topic to the watchlist.
2. Mute one source.
3. Reload Discovery.

**Pass when** — the watched topic is tracked and the muted source no longer
contributes to the feed.

## 7.4 Hooks

**What it is** — opening lines drawn from what is working, adapted to your brand.

**Steps**
1. Open the Hooks tab.
2. Take one hook into a draft.

**Pass when** — the hooks read as usable openers for *your* brand, not generic
copywriting templates.

---

# 8. Automation recipes

**What it is** — standing rules that keep producing content: watch trends for
keywords, pull an RSS feed, or import a CSV in bulk.
*Story (agency operator)* — "Keep output going without me starting it."
**Where** — `/automation`

**Steps**
1. New recipe → **auto trend** → add two or three broad keywords → save.
2. Run it and open the output queue.
3. Now edit the recipe to use one absurd keyword (`zzzqqq`) and run again.
4. Approve one output and reject another.
5. Pause the recipe.

**Pass when** — step 2 produces outputs for review; step 3 returns a message saying
*which* reason nothing came back — no trends matched those words, or they matched
but scored too low for this brand; approve/reject each act on only that output; and
a paused recipe produces nothing further.

---

# 9. Engagement Intelligence

**What it is** — incoming comments and DMs, classified, with drafted replies and
sales opportunities pulled out.
*Story (sales-driven brand)* — "Turn DMs into bookings."
**Where** — `/agents?tab=engagement`

**Steps**
1. Open a conversation and read its classification.
2. Draft a reply and read it before doing anything else.
3. Check it has **not** been sent.
4. Approve it.
5. Open the sales opportunities list.

**Pass when** — the reply is in your brand's voice rather than generic; nothing is
sent until step 4 unless auto-handling is explicitly on; opportunities are
intent-scored and carry a recommended next action; anything risky is escalated
rather than answered.

---

# 10. Capture — Direct + Finish

**What it is** — SPARK tells you exactly what to film, you send it over WhatsApp,
and it finishes it into a post.
*Story (solo owner)* — "I'll film it if you tell me what to point at."

**Steps**
1. Pick a format that needs footage you do not have.
2. Start a capture session and read the brief.
3. Send a clip back over WhatsApp.
4. Now send a deliberately poor clip — very dark, or very short.

**Pass when** — the brief is specific and shootable (not "film something nice");
the sent media is ingested and attached to the post; and the poor clip **degrades
to a simpler format** rather than failing outright.

---

# 11. Oversight and governance

## 11.1 Approval mode

**What it is** — autopublish, or hold everything for review.
**Where** — Settings, and per campaign.

**Steps**
1. Set approval mode to **review**.
2. Publish a post from a campaign.
3. Find it in the review queue and approve it.
4. Now create a post with **no campaign** and try to publish it.

**Pass when** — step 2 is held rather than published, step 3 publishes it, and
step 4 is held **regardless of mode** — autonomy is a property of the campaign.

## 11.2 Approval rules

**What it is** — finer control: hold by platform, content type, risk or role.

**Steps**
1. Add a rule holding everything for one specific platform.
2. Publish to that platform, then to another.

**Pass when** — only the named platform is held.

## 11.3 Review queue

**Steps**
1. Create two or three held items.
2. Open the queue in the Command Center.
3. Act on one.

**Pass when** — everything waiting on a person is in one place, and acting on one
removes only that item.

## 11.4 Guardrails

**What it is** — every draft is checked before scheduling and again before
publishing: claim grounding, banned phrases, restricted topics, per-platform
limits, duplicates, AI disclosure, rights, avatar saturation.

**Steps**
1. With §2.5 configured, generate a batch of drafts.
2. Find one that was blocked or flagged.
3. Open it.
4. Draft the same intent twice and look for the duplicate warning.

**Pass when** — a blocked post **stays visible with the reason on it**. The check
never deletes the evidence.

## 11.5 Ask Spark and notifications

**Steps**
1. Open Ask Spark and ask something about the current brand.
2. Trigger work that needs a decision from you.
3. Open the notification.

**Pass when** — the answer is grounded in this brand, and the work **waits** for
your answer rather than guessing.

## 11.6 The agent

**Steps**
1. Open agent status and pause it.
2. Wait past its normal interval.
3. Resume, then open the run log.

**Pass when** — nothing happens while paused, and each run in the log carries its
reasoning.

---

# 12. Analytics

**What it is** — what happened after publishing: per-post metrics, brand trend over
time, campaign reports, CTA click traffic, success metrics.
**Where** — Command Center overview, and campaign reports.

**Steps**
1. Publish at least one post (§5.4).
2. Open the Command Center overview.
3. Open the campaign's report.

**Pass when** — the report compares what was **promised against what happened**,
rather than only showing totals.

---

# 13. Team, roles and organisation

**What it is** — invite people, set roles, permissions and groups; set budgets and
credit limits; configure SSO; read an audit log.
*Story (agency operator)* — "Different people, different powers."
**Where** — Settings → Team Roles, and Settings → Credit & Usage.

**Steps**
1. Invite a second user as **viewer**.
2. As that user, try to publish a post.
3. Set a very low budget cap and generate several drafts.
4. Open the audit log.

**Pass when** — the viewer cannot publish; the budget **refuses spend** rather than
overspending quietly; and every action appears in the audit log.

---

# 14. Agency features

**What it is** — a client roster, white-labelled links, and client proposals
shareable on a public link.
**Where** — `/agency`, shared proposals at `/p/<token>`.

**Steps**
1. Open the roster and check every brand is listed.
2. Draft a proposal for one client and share it.
3. Open the share link in a **private window**, signed out.
4. Accept or decline it there.

**Pass when** — the link opens with no login, shows the plan, and the decision is
recorded back in SPARK.

---

# 15. Import, export and portability

**What it is** — export a brand whole, import it elsewhere.
**Where** — Settings → Import / Export

**Steps**
1. Export a fully set-up brand.
2. Create an empty brand.
3. Import the export into it.
4. Compare brand kit, knowledge and assets against the original.

**Pass when** — genome, rules, assets and knowledge all arrive, and the imported
brand behaves like the original when you draft a post.

---

# Known limits

Correct behaviour today, not defects. Do not log these as failures.

| Thing | Why |
|---|---|
| Instagram, Facebook, Threads, Pinterest, Reddit will not connect | No app credentials set — `docs/VENDOR_SETUP.pdf` |
| LinkedIn publishing may be refused | Platform approval pending; the connection itself works |
| 4 of 8 trend sources live | Reddit, X, TikTok, Pinterest need keys |
| Brand kit **Versioning** tab says "Not built" | Nothing records a brand-kit version yet |
| Copy comes from the OpenAI fallback | The Anthropic organisation is disabled |
| Aggregator publishing off | `AYRSHARE_API_KEY` unset; native adapters in use |

---

# Reporting a problem

Give the **section number**, what you did, what you saw, what you expected. For a
publish failure the item itself carries the reason — copy that rather than "it
didn't work". Browser console for screen problems; the API terminal for anything
server-side.
