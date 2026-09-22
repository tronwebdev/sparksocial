# SparkSocial — Feature Guide

Every feature that is built, what it is for, and how to try it.

Each entry follows the same shape:

> **What it is** — in one line.
> **The story** — whose job it does.
> **Where** — the screen.
> **Try it** — the steps.
> **Working looks like** — what you should see.

Work through it in order and it doubles as a first run of the product: section 1
sets a brand up, and everything after it has something to act on.

**Before anything:** the API answers at `http://localhost:8080/health` and the web
app at `http://localhost:3000`. Three ready-made businesses with all their answers
are in `docs/TEST_BUSINESSES.md`.

---

# 1. Getting started

## 1.1 Brands and workspaces

**What it is** — one account holds many brands; each brand has its own content,
assets, connections and rules, and they never see each other's.
**The story** *(agency operator)* — "Keep my clients properly separated."
**Where** — `/workspaces`, and the brand switcher at the top of the sidebar.

**Try it**
1. Sign in. If the account has no brand you are sent to onboarding.
2. After onboarding, open `/workspaces` and add a second brand.
3. Switch between them with the sidebar switcher.

**Working looks like** — each brand shows its own calendar, assets and settings.
Nothing from brand A appears in brand B. This is enforced in the database layer,
not by a filter on the screen.

## 1.2 Onboarding — the five questions

**What it is** — five questions that produce a brand "genome": what you can show,
what you can film, what you are trying to achieve, and whether someone will appear
on camera.
**The story** *(solo owner)* — "Set me up without a two-hour form."
**Where** — `/onboarding`

**Try it**
1. Answer the five questions using one of the test businesses.
2. Note the answers you give — they decide which content formats you get later.

**Working looks like** — you land in the app with a brand. The answers drive
everything downstream: give "physical craft" and you will be offered filming
formats; give "product UI" and you will be offered screen-recording ones.

## 1.3 Build a brand from a website

**What it is** — point SPARK at a URL and it fills in the brand from the page.
**The story** *(solo owner)* — "You already know what my business does. Read it."
**Where** — onboarding, the "read my website" option.

**Try it** — supply a real business URL instead of answering manually.

**Working looks like** — identity, category and one-liner come back filled in, each
marked as inferred rather than confirmed, so you can correct them.

---

# 2. Brand setup — Settings → Brand Kits

Everything here is applied to every post automatically. It is the highest-leverage
screen in the product.

## 2.1 Workspace logo

**What it is** — the logo used on rendered images and video.
**Where** — Settings → Brand kits → *Workspace logo*

**Try it**
1. Upload a PNG or JPEG, or paste a URL.
2. Or press **Generate a placeholder** if you have no logo yet.

**Working looks like** — the logo previews immediately and appears bottom-left on
anything SPARK renders. The generated one is deliberately a plain flat shape with
no lettering — a placeholder, not a brand identity.

## 2.2 Colour theme

**What it is** — three colours, in order: background, text on it, accent.
**Where** — Settings → Brand kits → *Color Theme*

**Try it**
1. Click a palette preset, or set each colour individually.
2. Watch the contrast strip underneath.

**Working looks like** — the strip shows your text colour on your background
colour, so an unreadable pair is obvious before it reaches a post. Photos and
video are never tinted with these.

## 2.3 Brand voice

**What it is** — four tone sliders (formal, playful, technical, bold) plus the
narration voice for video.
**Where** — Settings → Brand kits → *Brand Voice*

**Try it** — move the sliders, save, then generate a draft (§3.2) and read it.

**Working looks like** — the writing changes. High "formal" and low "playful"
produces visibly different copy from the reverse.

## 2.4 Typography

**What it is** — display and body typefaces for rendered posts.
**Where** — Settings → Brand kits → *Typography Style*

**Working looks like** — the sample renders in your chosen faces, on your chosen
colours, so type and colour are judged together.

## 2.5 Strict compliance

**What it is** — restricted topics, claims to avoid, and banned words, plus a
switch deciding whether a violation **blocks** a post or **holds** it for review.
**The story** *(agency operator)* — "Some things this client must never say."
**Where** — Settings → Brand kits → *Enable Strict Compliance*

**Try it**
1. Add a word the brand would never use — e.g. `guaranteed`.
2. Turn strict mode on.
3. Generate several drafts.

**Working looks like** — the word does not appear. If it ever does, the post is
marked blocked with the reason on it, rather than quietly going out.

## 2.6 Watermark

**What it is** — whether the logo is stamped onto rendered images and video, and
at what size and opacity.
**Where** — Settings → Brand kits → *Watermark* (appears once a logo is set)

**Working looks like** — turning it off keeps your logo for everything else and
only stops the stamp. Bottom-left, where no platform draws its own controls.

## 2.7 Brand knowledge

**What it is** — documents and site pages SPARK is allowed to cite. Without them,
guardrails hold any specific factual claim.
**The story** *(any)* — "Only say things that are actually true about us."
**Where** — Settings → Brand kits → *Brand Knowledge*

**Try it**
1. Upload `docs/test-assets/fernhill-knowledge-base.pdf`, or ingest a site.
2. Generate a draft and look for a specific number or claim.

**Working looks like** — before attaching anything, drafts stay general. After,
they cite real specifics from the document.

## 2.8 Offer

**What it is** — what you sell and your primary call to action.
**Working looks like** — the CTA appears in posts that should sell, and is
deliberately withheld from educational, proof and personality posts.

## 2.9 Templates

**What it is** — the layouts a post is built into: intros/outros, bumpers,
caption presets, lower-thirds.
**Where** — Settings → Brand kits → *Templates*

**Note** — the **Versioning & approvals** tab says "Not built", which is correct:
nothing in the product records a brand-kit version yet.

## 2.10 Consent and avatar

**What it is** — whose face and voice SPARK may use, with a consent record behind
it, plus AI avatar and voice-clone configuration.
**The story** *(creator)* — "Use my likeness, but only with a record of me saying so."
**Where** — Settings → Brand kits → *People and likeness*

**Working looks like** — avatar formats stay unavailable until a consent record
exists. Revoking consent withdraws them again.

## 2.11 What this brand has learned

**What it is** — SPARK adjusts the content mix from measured results. This shows
what it has learned and lets you freeze it.
**Where** — Settings → Brand kits → *What this brand has learned*

**Working looks like** — freezing stops further adaptation without discarding what
is already known.

---

# 3. Making content

## 3.1 Playbooks

**What it is** — around fifteen content formats. Which ones you are offered is
decided by your genome, never by your industry.
**The story** *(creator)* — "Show me formats I can actually make."
**Where** — Command Center (`/home`), when creating a post.

**Try it** — compare the offered formats for two different test businesses.

**Working looks like** — a brand with physical craft gets filming formats; a SaaS
brand gets screen-recording ones. Each carries a **why** explaining the choice.

## 3.2 Drafting a post

**What it is** — turns a chosen format into real copy, beat by beat, in your voice.
**Where** — Command Center → new post → pick a playbook → draft.

**Try it**
1. Draft a post. Optionally give an intent ("this week's Ethiopian arrival").
2. Open the Preview tab.

**Working looks like** — every written beat is filled at a sensible length for its
slot, the post does not ask for the booking twice, and it ends with **hashtags**
that are specific to the post. An X post gets at most two hashtags; LinkedIn gets
about four.

## 3.3 Regenerating one beat

**What it is** — rewrite just the hook, or just the CTA, leaving the rest alone.
**Working looks like** — only the beat you asked for changes.

## 3.4 Variants and repurposing

**What it is** — several takes on the same idea, or the same idea rebuilt as a
different format for a different platform.
**The story** *(creator)* — "Turn one idea into a week of content."
**Working looks like** — a repurposed post gets **its own** hashtags sized for the
new platform, not the original's.

## 3.5 Generated media

**What it is** — images, AI b-roll, avatar video, voiceover, and dubbing into
another language, generated into individual beats.
**Where** — Draft Panel → a beat → the generate actions.

**Working looks like** — generated media replaces that beat and keeps its timing
and label. Dubbing replaces the beat in place rather than adding a second one.

## 3.6 Storyboard editing

**What it is** — add, remove, retime and relabel scenes; add a lower-third name
plate; override the voice for one scene.
**Working looks like** — the running total updates, and an edit that would push
the video outside the format's allowed length is refused with the reason.

## 3.7 Rendering

**What it is** — composes the beats into finished files, one per aspect ratio.
**Working looks like** — your brand colours, type and logo appear in the output.

---

# 4. Assets Library

## 4.1 Uploading and auto-captioning

**What it is** — your photos, video and documents, captioned automatically so they
can be retrieved by meaning.
**Where** — `/assets`

**Try it** — upload a handful of images, then search for what is *in* them rather
than their filenames.

**Working looks like** — search finds an image by its contents.

## 4.2 Folders and organisation

**What it is** — folders, moving, renaming, membership.
**The story** *(agency operator)* — "Keep a client's material in order."

## 4.3 Roles and gaps

**What it is** — assets carry roles (social proof, product shot, work artifact…),
and SPARK can tell you which missing role is blocking the most formats.
**Working looks like** — the gap list is ordered by how many formats each missing
role would unlock, so you know what to shoot first.

## 4.4 Rights and reuse cooldown

**What it is** — rights status per asset, and a cooldown so the same photo is not
used every week.
**Working looks like** — an asset used recently is passed over for a fresh one.

---

# 5. Campaigns and the calendar

## 5.1 Readiness check

**What it is** — before a campaign is created, a checklist of what would stop it
producing anything, split into **blockers** and **warnings**.
**The story** *(solo owner)* — "Tell me what's missing before I commit, not after."
**Where** — `/campaign/new`, on confirm.

**Try it** — create a campaign on a brand with no assets and no connected account.

**Working looks like** — a modal appears **before** creation. "Nowhere to publish"
is a blocker; a missing asset is a warning with the number of extra posts it would
unlock. You can still proceed — the button says "Create anyway".

## 5.2 Creating a campaign

**What it is** — an objective and a window; SPARK plans the mix and fills a calendar.
**Working looks like** — the calendar has posts on it, balanced across content
pillars rather than all promotional.

## 5.3 The calendar

**What it is** — the month, with drag-to-reschedule and slot recommendations.
**Where** — `/calendar`

**Working looks like** — an empty calendar explains *why* it is empty rather than
just saying "nothing scheduled".

## 5.4 Publishing

**What it is** — posts go out on their schedule, or immediately.
**Where** — Draft Panel → Preview → Publish.

**Try it** — publish to Bluesky, which needs only a handle and an app password.

**Working looks like** — the post appears on the platform and the item carries a
receipt and a link back.

## 5.5 Rollback

**What it is** — take a published post back down.
**Working looks like** — removed from the platform; the record is kept, marked
rolled back, rather than deleted.

## 5.6 Tracked links

**What it is** — shortens your CTA link so clicks can be counted.
**Working looks like** — the short link is appended after the hashtags, where the
platform will still build a preview card from it.

---

# 6. Connecting accounts

**What it is** — connect the platforms you publish to.
**Where** — Settings → Account Connection

**Connectable today:** X, TikTok, LinkedIn, YouTube, Google Business (OAuth), and
**Bluesky** (handle + app password, no setup at all).
**Not configured:** Instagram, Facebook, Threads, Pinterest, Reddit — see
`docs/VENDOR_SETUP.pdf`.

**Try it**
1. Connect Bluesky first — it needs nothing set up.
2. Then an OAuth platform. You should be asked *which* account to use.

**Working looks like** — the tile shows **your** account name and picture, not a
generic platform name. Health shows the connection and when its token expires;
tokens refresh on their own before they do.

---

# 7. Discovery

## 7.1 Trends

**What it is** — what is moving right now, scored against your brand.
**The story** *(creator)* — "What should I post about today?"
**Where** — `/discovery`

**Working looks like** — every trend carries a score and a **why**. Things your
brand cannot credibly speak to are removed, not shown faintly. A trend everyone
has already done scores near zero however hot it is.

**Live sources:** YouTube, Hacker News, Product Hunt, Google Trends.
Reddit, X, TikTok and Pinterest need keys — run
`npx tsx --env-file-if-exists=apps/api/.env scripts/check-trend-sources.mts`
to see exactly which and why.

## 7.2 Turning a trend into a post

**Working looks like** — a draft about that trend, in your voice, using a format
your brand can actually make.

## 7.3 Watchlist, muting and influencers

**What it is** — follow topics, mute a source that is noisy, and watch specific
accounts.

## 7.4 Hooks

**What it is** — opening lines drawn from what is working, adapted to your brand.

---

# 8. Automation recipes

**What it is** — standing rules that keep producing content: watch trends for
keywords, pull an RSS feed, or import a CSV in bulk.
**The story** *(agency operator)* — "Keep output going without me starting it."
**Where** — `/automation`

**Try it**
1. New recipe → **auto trend** → add two or three keywords → save.
2. Run it.
3. Open the output queue.

**Working looks like** — outputs appear for review, or a message explaining
*which* reason nothing came back: no trends matched those words, or they matched
but scored too low for this brand. Those need different fixes, so they are
reported differently.

**Also** — recipes can be scheduled, paused, and their output approved or rejected
individually.

---

# 9. Engagement Intelligence

**What it is** — incoming comments and DMs, classified, with drafted replies and
sales opportunities pulled out.
**The story** *(sales-driven brand)* — "Turn DMs into bookings."
**Where** — `/agents?tab=engagement`

**Try it**
1. Open a conversation.
2. Draft a reply.
3. Check the sales opportunities list.

**Working looks like** — replies are in your brand's voice, not generic. Nothing
is sent until you approve it unless you have explicitly turned auto-handling on.
Intent is scored, opportunities carry a recommended next action, and anything
risky is escalated rather than answered.

**Also** — WhatsApp in and out, lead capture and import, and a full audit of every
reply that went out.

---

# 10. Capture — Direct + Finish

**What it is** — SPARK tells you exactly what to film, you send it over WhatsApp,
and it finishes it into a post.
**The story** *(solo owner)* — "I'll film it if you tell me what to point at."

**Try it** — from a format that needs footage you do not have, start a capture
session and follow the brief.

**Working looks like** — the brief is specific and shootable. Sent media is
ingested and attached to the post. If quality is poor, it degrades to a simpler
format rather than failing.

---

# 11. Oversight and governance

## 11.1 Approval mode

**What it is** — autopublish, or hold everything for review.
**Where** — Settings, and per campaign.

**Working looks like** — in review mode nothing publishes until approved. A post
belonging to no campaign is always held, whatever the mode.

## 11.2 Approval rules

**What it is** — finer control: hold by platform, by content type, by risk, by role.

## 11.3 Review queue

**Where** — the queue in the Command Center. Everything waiting on a person.

## 11.4 Guardrails

**What it is** — every draft is checked before it is scheduled and again before it
publishes: claim grounding, banned phrases, restricted topics, per-platform limits,
duplicate detection, AI disclosure, rights, avatar saturation.
**Working looks like** — a blocked post stays visible with the reason on it. The
check never deletes the evidence.

## 11.5 Ask Spark and notifications

**What it is** — ask SPARK anything in context; it asks you back when it needs a
decision.
**Working looks like** — questions appear as notifications and the work waits for
your answer rather than guessing.

## 11.6 The agent

**What it is** — pause, resume, set how often it acts, and read a log of every run
with the reasoning.
**Working looks like** — paused means paused; the run log explains each decision.

---

# 12. Analytics

**What it is** — what happened after publishing: per-post metrics, brand trend
over time, campaign reports, CTA click traffic, and the PRD's success metrics.
**Where** — Command Center overview and campaign reports.

**Working looks like** — a campaign report compares what was promised against what
happened, rather than only showing totals.

---

# 13. Team, roles and organisation

**What it is** — invite people, set roles and permissions, group them, set budgets
and credit limits, configure SSO, and read an audit log of every action.
**The story** *(agency operator)* — "Different people, different powers."
**Where** — Settings → Team Roles, and Settings → Credit & Usage.

**Working looks like** — a viewer cannot publish. Budget limits refuse spend
rather than overspending quietly. Every tool call is in the audit log.

---

# 14. Agency features

**What it is** — a client roster, white-labelled links, and client proposals that
can be shared on a public link and accepted without an account.
**Where** — `/agency`, and shared proposals at `/p/<token>`.

**Working looks like** — a proposal link opens for someone with no login, shows
the plan, and records their decision.

---

# 15. Import, export and portability

**What it is** — export a brand whole, import it elsewhere.
**Where** — Settings → Import / Export

**Working looks like** — an exported brand carries its genome, rules, assets and
knowledge, and restores to the same state.

---

# Known limits

These are correct behaviour today, not defects:

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

Give the **feature and section number**, what you did, what you saw, and what you
expected. For a publish failure the item itself carries the reason — copy that.
Browser console for screen problems, the API terminal for anything server-side.
