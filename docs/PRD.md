# SparkSocialAI PRD

**Version 1.0 — Agent-first Social Operating System**

> Standalone PRD: product context + personas + goals + requirements + success metrics + risks + rollout. Each module includes a feature spec and a UI flow breakdown derived from the provided wireframe sketch.

---

## 1) Product Overview

### Product statement
SparkSocialAI is an agent-first social media operating system where an AI agent ("SPARK") plans, drafts, schedules, publishes, engages, and learns across connected social accounts — under configurable autonomy, governance, and team approvals.

### Core promise
Autonomous content ideation, creation and posting is the default for an active Agent Campaign. Approvals are an optional control layer that can be enabled per brand/campaign/content type/risk category.

### Primary user outcomes
1. A brand can set up SPARK and activate a campaign, and SPARK begins ideating, creating and posting autonomously.
2. SPARK can discover trends and repurpose them into publish-ready content.
3. SPARK can run automations (recipes) that continuously create and publish content.
4. Engagement is handled with intelligence and sales intent detection, with escalation paths.
5. SPARK can learn from campaigns and optimize for better engagement and performance.
6. SPARK can direct traffic to CTA and lead to definitive marketing outcomes like traffic and sales.

---

## 2) Problem Statement

Problems SparkSocialAI solves:
- **Inconsistent execution**: brands fail to post regularly due to time, skill, and planning load.
- **Fragmented workflow**: planning, writing, design, publishing, and engagement happen across separate tools.
- **Low velocity on trends**: by the time trends are noticed and repurposed, they're saturated.
- **Risk and trust issues**: off-brand tone, risky claims, or poor engagement responses can harm reputation.
- **Agency complexity**: multi-brand teams require governance, approvals, and repeatable systems.

---

## 3) Personas & Jobs-To-Be-Done

### Persona A — Solo SMB Owner
- **JTBD**: "Run my social presence automatically and grow leads while I focus on the business."
- **Needs**: autopublish, fast setup, minimal oversight, safe defaults.

### Persona B — Agency Operator
- **JTBD**: "Scale output across clients with approvals, brand kits, and predictable workflows."
- **Needs**: roles, approvals, brand governance, asset organization, repeatability.

### Persona C — Creator/Coach
- **JTBD**: "Turn ideas and trends into a week of content quickly, in my voice."
- **Needs**: repurposing, voice consistency, fast drafts, light media production.

### Persona D — Sales-driven Brand
- **JTBD**: "Convert DMs/comments into bookings by detecting intent and replying well."
- **Needs**: engagement intelligence, lead scoring, recommended actions, handoff routing.

---

## 4) Definitions & Concepts

- **Organization (Account)**: top-level container for brands, billing, security, governance.
- **Brand (Workspace)**: a single brand's settings, kits, integrations, teams, and agent(s).
- **SPARK Agent**: AI identity with autonomy configuration operating within a brand.
- **Campaign**: the operational "mission" for an agent (goal, type, offer context, accounts).
- **Draft Panel**: a Panel with a bundle of text drafts (carousel slides + captions + reel script) for content generation.
- **Trend**: a detected topic/pattern with metrics (volume, velocity, saturation, growth, relevance).
- **Automation Recipe**: scheduled automation that generates and publishes content (Trend/Bulk/RSS).
- **Governance**: brand voice + restricted topics + claims rules + compliance mode + approval workflows.
- **Queues**:
  - **Plan Queue**: what SPARK intends to do next
  - **Review Queue**: items awaiting approval (if enabled or flagged)
  - **Automation Queue**: outputs from recipes
  - **Engagement Queue**: DMs/comments/story replies and suggested actions

---

## 5) Goals, Non-Goals, Success Metrics

### Goals (v1)
1. Autonomous publishing by default for active agent campaigns on connected accounts.
2. Configurable oversight: approvals optional and configurable by risk/content/platform/role.
3. Trend-driven growth: discovery + repurpose flows produce publishable content fast.
4. Automation at scale: recipes continuously create/publish content with queue visibility.
5. Engagement intelligence: suggested replies + sales opportunities + escalation controls.
6. Governance everywhere: brand kit and rules consistently applied across modules.

### Non-goals (v1)
- Full video timeline editor (advanced post-production).
- Deep CRM (beyond sales opportunities, recommended actions, and basic routing).
- Ad account management as a core feature (can be future).

### Success metrics

**Activation**
- % who complete onboarding + connect ≥ 1 social account
- % who activate a campaign
- Time to first post published automatically after activation

**Production**
- Posts published per week per brand
- Draft edits per post (too high = low quality; too low + high failures = risk)
- Clicks for brand CTA for post published per week

**Discovery**
- Trend-to-post conversion rate
- Repurpose usage rate

**Automation**
- Recipes created per active brand
- Automation output approval rate (when enabled)

**Engagement**
- Reply SLA (time to reply)
- Sales opportunities detected per week
- "Next action taken" rate

**Trust/Safety**
- % of blocked/flagged prevented from publishing
- Incidents: off-brand or risky content published (target near-zero)

---

## 6) Product Scope & Information Architecture

### Account scope (Organization)
- Brands
- Agency Portal (website wizard, lead finder, trainings, billing, settings)

### Brand scope (Workspace)
- Agents
- Discovery (Trends)
- Calendar
- Automation Recipes
- Folder/Asset Library
- Settings (brand kit/voice/guardrails, integrations, engagement intelligence, teams)

### Roles & Permissions

**Roles (minimum set)**
- **Owner**: full access (billing, security, settings, publish, approvals).
- **Admin**: manage integrations, teams, settings, automations, publishing.
- **Editor/Creator**: create and edit drafts, generate media, schedule (if granted).
- **Approver**: approve/reject content and engagement replies; cannot change settings.
- **Viewer**: read-only access.
- **Client**: (unspecified in source)

**Permission Controls (workspace-configurable)**
- Publish permission (per role)
- Approval required for publish (on/off)
- Approval required for media generation (optional)
- Spend credits permission (on/off)
- Automation auto-publish allowed (on/off)

---

## 7) Global System Rules

1. Autopublish default **ON** for activated campaigns (unless user disables or policy restricts).
2. Approvals are optional and can be enabled:
   - globally (workspace)
   - per campaign
   - per content type/platform
   - triggered by governance rules (restricted topics, claims, strict mode)
3. Every agent action must be explainable ("why" visible) for:
   - trend selection
   - calendar recommendations
   - engagement classification
   - automation decisions
4. Unified statuses across content:
   - Draft → Needs Review → Approved → Scheduled → Published
   - Failed / Blocked
5. Queues are first-class: Plan, Review, Automation, Engagement — each visible and actionable.

---

## 8) Modules & Feature Requirements

Each module section includes: Description → Goals → Inputs/Config → Outputs → Functional requirements → UI flow breakdown (based on the sketch).

### 8.1 Authentication & Entry

**Description**: Users enter via pricing/plan selection and create an organization account via email/password or SSO.

**Goals**
- Fast account creation with plan context preserved
- Secure verification for email/password signups
- Smooth transition into agent narrative (SPARK introduction)

**Inputs/Config**
- Selected plan (trial vs paid)
- Auth choice (email/pass or SSO)

**Outputs**
- Authenticated account session
- Organization created (or ready to create on first brand creation)

**Functional requirements**
- Email/password signup with terms acceptance
- OTP verification with resend throttling and lockout
- SSO provider OAuth
- Login and password reset (implied)

**UI flow breakdown**
- `AUTH-01`: Start Trial / Get Started (from pricing plan)
- `AUTH-02`: Sign Up (Name, Email, Password or SSO; Terms checkbox)
- `AUTH-03`: Verify Email (OTP) (email/pass only)
- `AUTH-04`: Welcome Transition ("Meet SPARK") → proceed to onboarding

---

### 8.2 Brand Onboarding (Workspace Creation)

**Description**: A guided chat-style onboarding where SPARK captures brand identity, knowledge, guardrails, timezone, and social connections, then personalizes the agent.

**Goals**
- Capture enough data for SPARK to publish confidently
- Establish governance rules early
- Connect socials to enable autopublish and engagement ingest

**Inputs/Config**
- Brand name, description, logo
- Brand URL + PDFs/knowledge docs
- Voice sliders, restricted topics, claims to avoid, strict mode
- Timezone (required)
- Social accounts (OAuth)
- Agent alias + avatar + optional media identity (voice/cameo)

**Outputs**
- Brand workspace created
- Brand kit/voice/guardrails saved
- Integrations connected (if done)
- Initial agent identity saved
- Ready state for campaign creation

**Functional requirements**
- Save and reuse brand kit and guardrails across all modules
- Support skipping optional knowledge uploads without breaking onboarding
- Allow connecting accounts during onboarding or later

**UI flow breakdown**
- `ONB-01`: Brand Identity (name, description, logo)
- `ONB-02`: Brand Knowledge (URL, PDF upload, extra notes, skip)
- `ONB-03`: Voice + Guardrails + Timezone (sliders, restricted topics, claims, strict mode, timezone picker)
- `ONB-04`: Connect Social Accounts (connected profiles list + OAuth popup)
- `ONB-05`: Agent Personalization (alias, avatar upload/presets, optional cameo import, optional voice record/upload + Sora auth popup)
- `ONB-06`: Setup Complete ("Press & Hold to Continue") → Brand Home

---

### 8.3 Dashboards

**Description**: Two dashboards: Brand Home (workspace) and Account Home (org).

**Goals**
- Brand Home: drive next best action and show agent value immediately
- Account Home: manage multiple brands + access agency portal and billing

**Inputs/Config**
- Whether campaign exists
- Whether accounts are connected
- Whether recipes exist
- Whether engagement is eligible/active

**Outputs**
- Clear "setup required" CTA states
- Quick access to key modules

**Functional requirements**
- Prominent CTA to create first campaign if not active
- Preview widgets: calendar, discovery, engagement, automation, agent status

**UI flow breakdown**
- `DASH-B-01`: Brand Home Dashboard (campaign CTA + previews)
- `DASH-A-01`: Account Dashboard (brands list + agency portal tiles + billing/trainings/settings)

---

### 8.4 Agents & Campaigns

**Description**: Agents are the AI operators. Campaigns define what an agent should do: goals, offer context, channels, and autonomy responsibilities.

**Goals**
- Make campaign creation simple but powerful
- Turn a brand + offer into an autonomous posting system
- Configure learning, optimization, engagement gating, and approvals

**Inputs/Config**
- Agent identity (name/avatar)
- Campaign goal and type
- Offer details (URL/docs/CTA)
- Connected accounts selection
- Responsibilities:
  - generate drafts
  - schedule posts
  - autopublish (default ON once active)
- Learning toggles:
  - learn from performance
  - adjust content mix
- Engagement responsibilities gating

**Outputs**
- Active campaign
- Calendar plan + plan queue populated
- Posting begins autonomously (subject to approvals/governance)

**Functional requirements**
- Campaign activation triggers:
  - initial posting plan and schedule
  - creation of content items with statuses
- Approvals can be enabled to route items to Needs Review instead of publishing
- Engagement intelligence is gated until "eligible"

**UI flow breakdown**
- `AGT-01`: Agents List (open command center; pause/resume; duplicate; delete)
- `CMP-01`: Campaign Wizard
  - `CMP-01.1`: Goal / Focus
  - `CMP-01.2`: Campaign Type (agent suggests; user can choose)
  - `CMP-01.3`: Offer Details (URL/docs/CTA URL tooltip)
  - `CMP-01.4`: Select Accounts (AI preselect + connect new)
  - `CMP-01.5`: Responsibilities & Learning (autopublish default ON; approvals optional; engagement gated)
  - `CMP-01.6`: Review & Activate (summary → activate)

---

### 8.5 Command Center

**Description**: The main supervision hub. It must always communicate who SPARK is, what it's doing, what's next, and whether it's working. Includes the Chat Drawer control plane.

**Goals**
- Make the agent feel "alive" and operational
- Provide controls without overwhelming
- Provide visibility into queues (plan, review, engagement, automation)
- Enable chat-driven commands and draft creation

**Inputs/Config**
- Agent identity and campaign
- Current queues
- Approval settings
- Learning mode and cadence settings

**Outputs**
- Live status banner
- Next actions queue
- Performance snapshot + recommendations
- Commands produce immediate visible outcomes

**Functional requirements**
- Control toggles:
  - pause agent
  - adjust frequency
  - approval mode on/off
  - freeze/reset learning
- Explainability: "why" for agent actions
- Chat drawer triggers draft creation and scheduling actions

**UI flow breakdown**
- `CC-01`: Command Center Overview (identity bar, focus, upcoming actions, performance, controls, engagement feed entry, calendar entry)
- `CC-02`: Chat Drawer (chat commands + "One Brief → Draft Pack" mode + draft preview panel)
  - `CC-02A`: Post Draft Preview Viewer (tabs: carousel/captions/reel script/images; edit/regenerate/generate media)
  - `CC-04`: Placement Step (where to post + date/time picker + publish mode)
- `CC-03`: Command Center Calendar and Queue — shows all upcoming queue for campaign plus a calendar view to learn.
- `CC-04`: Command Center Performance and Learning — shows metrics (Impressions, Saves and Replies + Website traffic from CTA)
- `CC-04`: Command Engagement Intelligence — agent replies, comments and other engagement activity. Initial setup done in Settings page.
  - `ENG-04`: Eligibility Gate (ineligible notice; eligible configure state)
  - `ENG-04`: Active Engagement Feed with Tabs
    - `ENG-04.1`: Needs Review
    - `ENG-04.2`: Suggested Replies
    - `ENG-04.3`: Auto-Handled
    - `ENG-04.4`: Sales Opportunities (hot/warm/cold + recommended action + conversation drawer)

---

### 8.6 Content Creation & Draft Packs

**Description**: Text-first drafting (carousel/captions/reel scripts) with optional media generation. Draft Packs can be created from the chat drawer, calendar date action, trend repurpose, or automations.

**Goals**
- Fast drafts in brand voice
- Simple editing and regeneration
- One-click media generation
- Seamless placement into calendar and library

**Inputs/Config**
- Brief/prompt
- Apply Brand Kit toggle
- Output type selection (carousel/captions/reel script)
- CTA goal and link (when relevant)

**Outputs**
- Draft Pack + individual content items
- Media renders (carousel images, caption images, reels) where enabled
- Items placed on calendar with statuses

**Functional requirements**
- Draft editing is persistent
- Regeneration can happen per section
- Governance checks set status to Needs Review or Blocked
- Autopublish flow:
  - if approvals OFF and no flags → schedule/publish automatically
  - if approvals ON or flagged → Needs Review

**UI flow breakdown (where it appears in the sketch)**
- From `CC-02` Chat Drawer → `CC-03` Draft Viewer → `CC-04` Place to accounts/date
- From `CAL-02` Date Action Panel → create draft → place
- From `DISC-02` Trend Detail → generate content pack → place
- From `AUTO` outputs → appear in automation queue and calendar

---

### 8.7 Calendar

**Description**: The planning and execution view. Shows what will post, what posted, and what needs review. Supports date-based creation, agent planning, and drag-and-drop adjustments with impact warnings.

**Goals**
- Make the posting plan visible and editable
- Allow rapid "fill the week" actions
- Provide safe rescheduling with rebalancing suggestions
- Serve as the execution surface for autopublish

**Inputs/Config**
- Timezone
- Campaign cadence and posting windows
- Approval requirements and governance rules

**Outputs**
- Scheduled/published posts
- Needs Review items (if approvals/flags)
- Rebalanced weekly plan after changes
- Recommendations over time

**Functional requirements**
- Month view required; week view optional
- Filters by status/platform/type
- Drag impact prompt + rebalancing
- Post detail drawer with edit/regenerate/approve/publish actions

**UI flow breakdown**
- `CAL-01`: Calendar view (month + optional week; filters)
- `CAL-02`: Date Action Panel ("What would you like to post here?")
- `CAL-03`: Ask Agent to Plan (recommendation → accept → draft)
- `CAL-04`: Create Post for Date (brief → draft → choose accounts/time)
- `CAL-05`: Drag & Drop Adjustment (impact warning + "rebalance" option)
- `CAL-06`: Draft / Needs Review Detail Drawer (edit/regenerate/approve/schedule)

---

### 8.8 Engagement Intelligence

> Note: Setup is done from the workspace settings and shown in its active state inside the command center.

**Description**: A feed that consolidates DMs, comments, and story replies and lets SPARK suggest replies, auto-handle safe interactions, and surface sales opportunities — while respecting autonomy level and approvals.

**Goals**
- Reduce response time and missed messages
- Maintain brand voice and safety
- Detect sales intent and recommend next steps
- Keep humans in control when needed

**Inputs/Config**
- Engagement autonomy level
- Enabled engagement types (comments/DMs/story replies)
- Approval rules for sending replies
- Restricted topics/claims and strict compliance mode

**Outputs**
- Suggested replies
- Auto-handled log
- Sales opportunities list with actions
- Engagement audit trail (what SPARK did and why)

**Functional requirements**
- Eligibility gating:
  - ineligible (campaign still learning)
  - eligible but inactive (configure now)
  - active state with tabs
- Tabs:
  - Needs Review
  - Suggested Replies
  - Auto-Handled
  - Sales Opportunities
- Each item shows:
  - platform icon, original message, classification, "why"
  - suggested reply (editable)
  - actions: approve & send / edit / reject / take over

**UI flow breakdown**
- `ENG-01`: Eligibility Gate (ineligible notice; eligible configure state)
- `ENG-02`: Active Engagement Feed with Tabs
  - `ENG-02.1`: Needs Review
  - `ENG-02.2`: Suggested Replies
  - `ENG-02.3`: Auto-Handled
  - `ENG-02.4`: Sales Opportunities (hot/warm/cold + recommended action + conversation drawer)

---

### 8.9 Trend Discovery

**Description**: A discovery surface that ranks trends by velocity, saturation, and relevance to the brand. Trends can be repurposed into posts or reshared with CTA rewrites.

**Goals**
- Let brands act on trends before saturation
- Provide brand-safe repurposing
- Make trend → publish a short, reliable flow

**Inputs/Config**
- Filters: platform, content type, language, region
- Brand safety filter
- Watchlist keywords
- Influencer watchlist

**Outputs**
- Trend feed cards and detail pages
- Repurposed draft packs
- Reshare caption that routes to CTA

**Functional requirements**
- Trend cards show: volume, saturation, velocity, growth
- Trend detail includes:
  - metrics + time series
  - sample posts
  - generate content pack panel (brief title, goal, CTA, post types, brand kit toggle, A/B toggle optional)
  - recommendations row (time shift, format, hook) with apply buttons

**UI flow breakdown**
- `DISC-01`: Trend Feed (filters + trend cards + actions: open/repurpose/reshare)
  - Click Repurpose ⇒ generate a draft, then the preview screen to generate and publish
  - Click Reshare ⇒ gets CTA and goal and rewrites caption to share and reroute CTA to the added CTA link
- `DISC-02`: Trend Detail (metrics left; samples + content pack panel right; apply recommendations)

---

### 8.10 Automation Recipes

**Description**: Automation Recipes continuously generate and publish content on a schedule, using trend queries, bulk imports, or RSS feeds. All outputs flow into a queue and optionally into the calendar.

**Goals**
- Make social execution scalable and repeatable
- Offer "set-and-forget" autopublishing with optional review gates
- Provide transparency via the automation output queue

**Inputs/Config (common)**
- recipe name
- target accounts
- goal + CTA URL
- frequency schedule (hour/day/week)
- start/end options
- review-before-publish checkbox (optional)
- governance rules apply automatically

**Outputs**
- queued posts (Draft/Needs Review/Scheduled/Published)
- automation run logs (last run, next run, success/failure)

**Functional requirements**
- Recipes home shows:
  - recipe catalog: AutoTrend Engager, Bulk Connector, RSS Autopost
  - automation output queue with status filters
- Autopublish behavior:
  - default: publish automatically if approvals are OFF and content not flagged
  - if "review before publish" ON or approvals ON: route to Needs Review

**UI flow breakdown**
- `AUTO-01`: Recipes Home (catalog cards + output queue panel)
- `AUTO-02`: AutoTrend Engagement
  - `AUTO-02.1`: List (empty/created; pause/edit/delete)
  - Create new:
  - `AUTO-02.2`: Name + Select Accounts
  - `AUTO-02.3`: Trend Query (keywords, region, language, post age, exclude keywords)
  - `AUTO-02.4`: Preview Trends (confirm selection)
  - `AUTO-02.5`: Add CTA + Schedule (frequency; start/end; review checkbox)
- `AUTO-03`: Bulk Connector
  - `AUTO-03.1`: List (empty/created; pause/edit/delete; labels CSV/Canva/Drive/Folder)
  - `AUTO-03.2`: Name + Select Accounts
  - `AUTO-03.3`: Choose Source Type (CSV/Canva/Drive/Folder) + Auth (CSV upload template tooltip; Canva/Drive auth; Folder selection)
  - `AUTO-03.4`: Preview Table + Validate
  - `AUTO-03.5`: CTA + Schedule (choose frequency, posting cycle) + Review checkbox
- `AUTO-04`: RSS Feed Automation
  - `AUTO-04.1`: List (empty/created)
  - `AUTO-04.2`: Name + Select Accounts
  - `AUTO-04.3`: RSS URL + Preview
  - `AUTO-04.4`: CTA + Schedule + Review checkbox

---

### 8.11 Folder / Asset Library

**Description**: A lightweight DAM for organizing drafts and media outputs into folders, with quick reuse and repurpose actions.

**Goals**
- Keep assets organized per brand and campaign
- Make reuse simple (send to calendar, repurpose, attach captions)

**Inputs/Config**
- folder name
- asset metadata (caption, description, tags)

**Outputs**
- folder structure
- searchable assets
- "reuse" actions into calendar and draft packs

**Functional requirements**
- Folder list with empty state
- Folder detail grid/list view
- List view supports metadata editing (caption/description)
- Actions: upload, move, tag, reuse, repurpose

**UI flow breakdown**
- `LIB-01`: Folder List (empty → create first folder; list with created date/count)
- `LIB-02`: Folder Detail (grid/list; table metadata fields; actions)

---

### 8.12 Settings

**Description**: Two layers: Organization settings and Workspace (Brand) settings.

**Goals**
- Give org-level governance, billing, and security control
- Give brand-level controls for kit, integrations, engagement autonomy, teams

**Inputs/Config**
- org plan/credits/security
- workspace brand kit/voice/guardrails/knowledge
- integrations (scopes)
- roles and approval policies

**Outputs**
- enforceable permissions and safe operations
- audit and governance controls
- predictable cost and usage tracking

**Functional requirements**
- Organization settings include:
  - billing/plan/credits/overage policies
  - security (SSO/2FA)
  - audit log
  - data governance (residency/retention)
  - API keys/webhooks (optional)
- Workspace settings include:
  - brand kit & voice
  - brand knowledge docs
  - integrations per platform
  - engagement intelligence configuration
  - teams & roles
  - usage slice and alerts
  - import/export workspace

**UI flow breakdown**
- `SET-ORG-01`: Org Settings (overview, billing, security, governance, legal, integrations, affiliates, API, danger zone)
- `SET-WS-01`: Workspace Settings Tabs (overview, brand kit, engagement, integrations, usage, team/roles, import/export)

---

### 8.13 Agency Portal (Account Scope)

**Description**: An account-level portal for agencies that includes website wizard, lead/job finder, trainings, plans/billing, and settings.

**Goals**
- Provide agency "business enablement" tools beyond posting
- Centralize training, plans, and operations for agency users

**Outputs**
- Agency dashboard tiles and entry flows (defined by separate PRD if deeper)

**UI flow breakdown**
- Visible from Account Dashboard as portal tiles.

---

## 9) Governance & Autonomy Model

### Autonomy defaults
- Active campaign = autopublish **ON** by default (subject to integrations and plan constraints).
- Optional controls:
  - require approval before publishing
  - require approval before scheduling
  - require approval only when flagged by guardrails
  - restrict autopublish by content type/platform

### Guardrails enforcement
- Restricted topics/claims trigger:
  - Needs Review (soft) or Blocked (hard) depending on strict mode and rule type
- All flagged items show:
  - what rule triggered
  - recommended fix action

### Channels and Mediums

**1. Publishing Channels (Direct Post & Scheduling)**

Core social platforms (must-have at GA):
- Facebook Pages & Groups
- Instagram (Business accounts, Reels, Stories, Posts)
- LinkedIn (Profiles & Company Pages)
- Twitter / X
- YouTube (Videos, Shorts, Community posts)
- TikTok (Videos & Ads library posts if available)
- Pinterest
- Sora

Secondary / Optional (v1.1+ or v2):
- Google Business Profile (posts, updates, offers)
- Snapchat Spotlight / Public Profiles
- Reddit (communities)
- Medium / Substack (for long-form blog posts)

Cross-posting utilities:
- WordPress (blog sync)
- Shopify Blog (optional commerce tie-in)

**2. Discovery Channels (Trends, Insights, Inspiration)**

Social-native trend feeds:
- Twitter/X Trending API (topics & hashtags)
- Sora AI Trending API
- TikTok Creative Center / Sounds library (trending sounds, hashtags)
- YouTube Trending API (videos, shorts, trending searches)
- Instagram Explore / Hashtags API (limited official API but possible through partners)
- Pinterest Trends (official trends API in beta)
- Sora

Content & news:
- Google Trends API (search demand insights)
- Reddit API (hot/rising threads in target subreddits)
- RSS feeds (general news, industry blogs)

Media & assets:
- Pexels / Unsplash / Pixabay APIs (images & video stock for content creation)
- Giphy API (GIFs for posts)
- Spotify/TikTok Sounds (for reels/shorts audio)

### Product Wireframe (v1)
https://whimsical.com/sparksocial-wireframe-map-UKqqgyCeEdmYcGmzuMJgGU

---

## 10) Risks & Mitigations

- **Risk**: wrong or off-brand autoposting
  **Mitigation**: optional approvals + strict mode + flagging + "why" + rollback controls
- **Risk**: automation floods feeds/calendars
  **Mitigation**: queue caps, frequency limits, preview steps, relevance thresholds
- **Risk**: engagement misfires
  **Mitigation**: autonomy levels + approval requirements + allow take over + audit logs
- **Risk**: integration failures cause silent misses
  **Mitigation**: connection health indicators + alerts + retry flows

---

## 11) Rollout Plan

**Phase 1 — Core Agent OS**
- onboarding + brand kit + integrations
- agent + campaign wizard
- command center + calendar with autopublish
- library basics
- discovery feed (basic)
- automation recipes (RSS + CSV bulk)

**Phase 2 — Growth Systems**
- trend detail + repurpose packs
- AutoTrend recipes
- engagement intelligence (suggest replies + needs review)

**Phase 3 — Monetization & Scale**
- sales opportunities routing enhancements
- performance learning recommendations
- org governance depth + agency portal expansion

---

## 12) Open Questions to Finalize

- Eligibility rule for engagement intelligence (time-based, volume-based, or hybrid)?
- Default approval policy per plan (SMB vs Agency)?
- Trend sources and granularity in v1 (which platforms, what metrics are feasible)?
- Recipe output format defaults (single post vs pack) per recipe type?
- Credit model: what consumes credits, and how budget alerts work?

---

## Appendix: UI Flow Map (Quick Index)

- **AUTH**: AUTH-01 → AUTH-04
- **Onboarding**: ONB-01 → ONB-06
- **Dashboards**: DASH-B-01, DASH-A-01
- **Agents/Campaign**: AGT-01, CMP-01.1 → CMP-01.6
- **Command Center**: CC-01 → CC-04
- **Calendar**: CAL-01 → CAL-06
- **Engagement**: ENG-01 → ENG-02.4
- **Discovery**: DISC-01 → DISC-02
- **Automation**: AUTO-01 → AUTO-04.4
- **Library**: LIB-01 → LIB-02
- **Settings**: SET-ORG-01, SET-WS-01

---
---

# Platforms and Approvals

## SparkSocial AI — Integrations & Approvals Register

**Version**: 0.1 · **Date**: July 7, 2026 · **Owner**: Godswill / Tronweb

**Purpose**: The single source of truth for kicking off every developer approval and integration. Your channel list collapses into ~12 approval tracks, not 20+ platforms — because one provider governs many surfaces (apply to Meta once, unlock Facebook + Instagram + Threads). File by track, not by channel.

> All access rules are as of July 2026 and shift quarterly. Confirm on each developer portal before committing. Start the slow-approval tracks (Meta, LinkedIn, TikTok, Google) now — they gate GA regardless of build order.

---

## Part A — Publishing & Discovery Approval Tracks

Each track = one developer account / app / review process that unlocks the child surfaces beneath it. "Approval friction" is the realistic effort to production access.

### Track 1 — Meta (one Graph API app, one App Review cycle)
The highest-leverage single application. Governs four surfaces.

| Child platform | Mediums / surfaces | Notes |
|---|---|---|
| Facebook | Page posts, Reels, Stories, video, links; Groups | `pages_manage_posts`, `pages_read_engagement` scopes |
| Instagram (Business/Creator) | Feed posts, Reels, Stories, Carousels | `content_publish` scope; Business account required |
| Threads | Text, single image, single video, carousels (≤10) | Own scopes (`threads_content_publish` etc.), same Meta app; auth runs through the linked Instagram account |
| (Listening perms) | mentions, comment read/manage | Add these scopes in the same App Review to save a cycle |

**Cost**: Free. **Friction**: App Review, ~1–3 weeks; longest predictable publishing pole. **Priority**: FILE FIRST.

### Track 2 — Google (one Cloud project, per-API enablement + OAuth verification)

| Child platform | Mediums / surfaces | Notes |
|---|---|---|
| YouTube (Data API v3) | Long-form videos, Shorts, Community posts, comment threads | Sensitive-scope OAuth verification/audit required for publishing; search burns quota fast (100 units/call) |
| Google Business Profile | Posts, updates, offers, events | Separate API enablement; strong local-SEO value for SMB persona |
| (Discovery) YouTube Trending | Trending videos/searches | Same project, quota-priced |

**Cost**: Free, quota-metered. **Friction**: OAuth verification (video/security review) — weeks. **Priority**: FILE EARLY.

### Track 3 — X / Twitter (pay-per-use developer account)

| Surface | Mediums | Notes |
|---|---|---|
| X | Posts, threads, replies, media, polls; mentions; Trending topics | Sign up, load credits, call same day |

**Cost**: Pay-per-use (~$0.20/post w/ URL); flat tiers closed to new devs since Feb 2026; 2M read/mo ceiling before ~$42K/mo enterprise. **Friction**: Low approval, high cost-modeling work. **Priority**: FILE ANYTIME — budget is the real task.

### Track 4 — LinkedIn (Marketing Developer Partner + Community Management API)

| Child surface | Mediums | Notes |
|---|---|---|
| Personal Profiles | Text, image, video, article, document posts | |
| Company Pages | Org posts, all above | Community Management API for comment/mention handling |

**Cost**: Free with partner status. **Friction**: HARDEST. LinkedIn rejects anything resembling a generic scheduler; approval takes weeks–months. Frame SparkSocial as an enterprise agency community-management workflow, with a real customer story — that's what gets through. SNAP/Sales Navigator onboarding is closed right now. **Priority**: FILE FIRST, ship LinkedIn behind a "coming soon" flag.

### Track 5 — TikTok (Content Posting API + mandatory audit)

| Surface | Mediums | Notes |
|---|---|---|
| TikTok | Video posts, photo carousels (direct publish or creator-review flow) | 6 req/min posting cap; sandbox trap — posts invisible until audit clears |
| (Discovery) Creative Center | Trending sounds, hashtags, creative insights | Separate access; primary trend source |

**Cost**: Free. **Friction**: Sandbox audit ~1–2 weeks clean. Confirm audit cleared before debugging "missing" posts. Research API is academic-only — not usable for commercial listening. **Priority**: FILE EARLY.

### Track 6 — Pinterest (one app)

| Surface | Mediums | Notes |
|---|---|---|
| Pinterest | Image pins, video pins, boards | Rate-limited per category |
| (Discovery) Pinterest Trends | Trend API (beta) | Same app |

**Cost**: Free. **Friction**: Light. **Priority**: MEDIUM.

### Track 7 — Reddit (commercial API agreement)

| Surface | Mediums | Notes |
|---|---|---|
| Reddit | Text, link, image posts to communities | Community rules/mod risk — post carefully |
| (Discovery) hot/rising | Subreddit monitoring, buyer-intent + complaints | Highest-value discovery surface for SaaS/MMO audiences |

**Cost**: ~$0.24 / 1K calls or ~$12K/yr commercial. **Friction**: Budget line, not a review gauntlet. **Priority**: MEDIUM (discovery value is high).

### Track 8 — Bluesky (AT Protocol, OAuth)

| Surface | Mediums | Notes |
|---|---|---|
| Bluesky | Text, image, video posts; firehose | Free; OAuth (dev preview); 5K points/hr |

**Cost**: Free. **Friction**: Minimal. **Priority**: EASY WIN — cheap coverage + free listening firehose.

### Track 9 — Sora / OpenAI

| Surface | Mediums | Notes |
|---|---|---|
| Sora | Posting + trending | Surface not yet stable for third-party publish/listen; owned-notifications only |

**Cost**: TBD. **Friction**: Unknown/evolving. **Priority**: MONITOR — don't build against it yet.

### Track 10 — Snapchat (Snap Kit + Marketing API) — v1.1+

| Surface | Mediums | Notes |
|---|---|---|
| Snapchat | Spotlight videos, Stories, public profile | Programmatic public-content posting is niche/limited; Marketing API is ad-oriented |

**Priority**: DEFER to v1.1. Low ROI vs. approval effort at GA.

### Track 11 — WordPress (REST API / WP.com OAuth or self-host app passwords) — cross-post utility
Blog sync for long-form. Per-site auth. **Cost**: Free. **Friction**: Low. **Priority**: v1.1 cross-posting.

### Track 12 — Shopify (Partners app) — optional commerce tie-in
Shopify Blog sync + future commerce hooks. **Priority**: v2 / parking lot.

### Dropped from the "apply" list (don't waste team time)
- **Medium** — API officially deprecated and unsupported; skip.
- **Substack** — no official posting API (only a thin public-profile read API); posting exists only via unofficial reverse-engineered clients. Skip for compliant v1.

### Discovery & asset sources needing no formal review (API-key signups)
Google Trends (unofficial/partner libs), RSS feeds (none), Pexels / Unsplash / Pixabay (stock image + video), Giphy (GIFs). Instagram Explore/hashtag data has no compliant official listening endpoint → aggregator only.

---

## Part B — Content Engine & Utility Integrations (the strong 5–10)

SPARK is agent-first, so the content-creation stack is the actual product engine — this is where to over-invest. Tiered by criticality.

### Tier 1 — Core content engines (must-have at GA)

1. **HeyGen** — AI video engine. The anchor. Video Agent turns one prompt into a finished video (script → avatar → voiceover → captions → B-roll); also avatar/spokesperson video, talking-photo, TTS, and dubbing/translation to 175+ languages with lip-sync. Ships MCP + Agent Skills + Direct API, pay-as-you-go from $5, SOC 2 / GDPR, 99.9% uptime — built for agentic workflows, which matches SPARK exactly. Powers faceless-channel and multi-language content, huge for the creator/MMO audience.
2. **ElevenLabs** — AI voice & audio. Voiceover, dubbing, multilingual narration, audiograms, podcast-clip audio. HeyGen already supports ElevenLabs voices internally, but you want it standalone for non-avatar audio (text posts → audiograms, sound-on Reels without an avatar).
3. **AI image generation** — social graphics. Most social output is images, and text-legible graphics (quote cards, carousels, ad creatives) need a text-capable model (Ideogram/Flux-class) rather than generic diffusion. Candidate to run on own ClientForce inference infra to control cost and brand-consistency.
4. **Canva** — brand design & format fan-out. (Already connected via MCP.) Templated, on-brand design and one-source-to-many-format resizing (1 concept → the 8 aspect ratios each channel demands). Fills the "keep it on-brand at volume" job that raw generation misses.
5. **Stock media** — Pexels + Unsplash + Pixabay (unified). Free B-roll, backgrounds, and imagery to populate the Asset Library and feed HeyGen/Canva. One normalized connector over all three.

### Tier 2 — Crucial utility infrastructure

6. **Unified publishing aggregator** — for the long tail only. (Ayrshare / Blotato / bundle.social / Mallary — all cover 9–15 platforms behind one endpoint and skip every review queue.) Strategic call: go native on the core 5 (Meta, X, LinkedIn, TikTok, YouTube) where you own the relationship, data depth, and margin — and use an aggregator to reach GA faster on the long tail (Pinterest, Snapchat, Google Business, Reddit, Bluesky, Threads) without waiting on every audit. Revisit bringing the tail in-house post-GA. Keeps you off a full third-party dependency for your primary channels while still shipping breadth.
7. **Auto-caption / subtitle engine**. Burned-in captions are table stakes for Reels/Shorts/TikTok. HeyGen captions its own output, but user-uploaded and non-avatar clips need a transcription/caption pass (AssemblyAI / Whisper-class). Directly moves short-form performance.
8. **Link attribution** — Dub or Bitly. Tracked short links + UTM on every posted link. Feeds Engagement Intelligence and — the cross-product hook — pipes click/lead data into ClientForce so social becomes a measurable top-of-funnel source, not a vanity channel.

### Tier 3 — Optional / fast-follow

9. **Licensed music/audio** (Epidemic Sound-class). Platform-native trending sounds (TikTok/Reels) are largely API-inaccessible for owned use; a licensed library covers sound-on posts safely. v1.1.
10. **Analytics warehouse hook**. Not an "apply" integration — analytics flow from the platform APIs themselves into your own store; note it for the data layer, not the approval sprint.

---

## Part C — Recommended Kickoff Sequence

**This week (slow approvals, gate GA):**
1. Meta App Review — publishing + listening scopes together (Track 1).
2. LinkedIn Marketing Developer Partner — with the enterprise/agency framing (Track 4).
3. Google Cloud project + YouTube OAuth verification (Track 2).
4. TikTok app + Content Posting audit (Track 5).

**Parallel (fast / budget tasks):**
5. X developer account + cost model (Track 3).
6. Reddit commercial agreement (Track 7); Bluesky OAuth (Track 8) — easy win.
7. HeyGen, ElevenLabs, Canva (connected), stock media — API keys, no review (Tier 1 engines).

**After core lands:**
8. Aggregator bake-off for the long tail (Track-tail + Integration 6).
9. Pinterest (Track 6); caption engine + link attribution (Integrations 7–8).

**Defer**: Snapchat, WordPress, Shopify, Sora (Tracks 9–12) → v1.1/v2.

---

## Open Questions

1. **Aggregator vs. all-native** (eng + finance): confirm the native-core / aggregator-tail split, or go all-native for control? Native-tail costs eng weeks; aggregator costs margin + a dependency.
2. **Image engine build-vs-buy** (eng): own model on ClientForce infra vs. third-party API — brand consistency and cost argue for own, speed argues for buy.
3. **HeyGen billing mode** (finance): MCP (plan credits) vs. Direct API (metered wallet) — pick per expected volume; the two pools are independent.
4. **LinkedIn application entity** (Godswill): submit under Tronweb parent or SparkSocial, with which customer story? Blocking for LinkedIn only.
5. **Reddit posting risk** (product): per-community mod rules make automated posting risky — gate behind stricter approval than other channels?
