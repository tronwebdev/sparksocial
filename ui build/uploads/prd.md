# SparkSocialAI PRD
Version 1.0 — Agent-first Social Operating System
(This is a standalone PRD: product context + personas + goals + requirements + success metrics + risks + rollout. Each module includes a clear feature spec and a UI flow breakdown derived from the provided wireframe sketch.)
## 1) Product Overview
### Product statement
SparkSocialAI is an agent-first social media operating system where an AI agent (“SPARK”) plans, drafts, schedules, publishes, engages, and learns across connected social accounts—under configurable autonomy, governance, and team approvals.
### Core promise
Autonomous content ideation, creation and posting is the default for an active Agent Campaign. Approvals are an optional control layer that can be enabled per brand/campaign/content type/risk category.
### Primary user outcomes
- A brand can set up SPARK and activate a campaign, and SPARK begins ideating, creating and posting autonomously.
- SPARK can discover trends and repurpose them into publish-ready content.
- SPARK can run automations (recipes) that continuously create and publish content.
- Engagement is handled with intelligence and sales intent detection, with escalation paths.
- SPARK can learn from campaigns and optimise for better engagement and performance
- SPARK can direct traffic to CTA and lead to definitive marketing outcomes like traffic and sales.
## 2) Problem Statement
### Problems SparkSocialAI solves
- Inconsistent execution: brands fail to post regularly due to time, skill, and planning load.
- Fragmented workflow: planning, writing, design, publishing, and engagement happen across separate tools.
- Low velocity on trends: by the time trends are noticed and repurposed, they’re saturated.
- Risk and trust issues: off-brand tone, risky claims, or poor engagement responses can harm reputation.
- Agency complexity: multi-brand teams require governance, approvals, and repeatable systems.
## 3) Personas &amp; Jobs-To-Be-Done
### Persona A — Solo SMB Owner
- JTBD: “Run my social presence automatically and grow leads while I focus on the business.”
- Needs: autopublish, fast setup, minimal oversight, safe defaults.
### Persona B — Agency Operator
- JTBD: “Scale output across clients with approvals, brand kits, and predictable workflows.”
- Needs: roles, approvals, brand governance, asset organization, repeatability.
### Persona C — Creator/Coach
- JTBD: “Turn ideas and trends into a week of content quickly, in my voice.”
- Needs: repurposing, voice consistency, fast drafts, light media production.
### Persona D — Sales-driven Brand
- JTBD: “Convert DMs/comments into bookings by detecting intent and replying well.”
- Needs: engagement intelligence, lead scoring, recommended actions, handoff routing.
## 4) Definitions &amp; Concepts
- Organization (Account): top-level container for brands, billing, security, governance.
- Brand (Workspace): a single brand’s settings, kits, integrations, teams, and agent(s).
- SPARK Agent: AI identity with autonomy configuration operating within a brand.
- Campaign: the operational “mission” for an agent (goal, type, offer context, accounts).
- Draft Panel: a Panel with a bundle of text drafts (carousel slides + captions + reel script) for content generation
- Trend: a detected topic/pattern with metrics (volume, velocity, saturation, growth, relevance).
- Automation Recipe: scheduled automation that generates and publishes content (Trend/Bulk/RSS).
- Governance: brand voice + restricted topics + claims rules + compliance mode + approval workflows.
- Queues:
- Plan Queue: what SPARK intends to do next
- Review Queue: items awaiting approval (if enabled or flagged)
- Automation Queue: outputs from recipes
- Engagement Queue: DMs/comments/story replies and suggested actions
## 5) Goals, Non-Goals, Success Metrics
### Goals (v1)
- Autonomous publishing by default for active agent campaigns on connected accounts.
- Configurable oversight: approvals optional and configurable by risk/content/platform/role.
- Trend-driven growth: discovery + repurpose flows produce publishable content fast.
- Automation at scale: recipes continuously create/publish content with queue visibility.
- Engagement intelligence: suggested replies + sales opportunities + escalation controls.
- Governance everywhere: brand kit and rules consistently applied across modules.
### Non-goals (v1)
- Full video timeline editor (advanced post-production).
- Deep CRM (beyond sales opportunities, recommended actions, and basic routing).
- Ad account management as a core feature (can be future).
### Success metrics
Activation
- % who complete onboarding + connect ≥ 1 social account
- % who activate a campaign
- Time to first post published automatically after activation
Production
- Posts published per week per brand
- Draft edits per post (too high = low quality; too low + high failures = risk)
- Clicks for brand CTA for post published per week
Discovery
- Trend-to-post conversion rate
- Repurpose usage rate
Automation
- Recipes created per active brand
- Automation output approval rate (when enabled)
Engagement
- Reply SLA (time to reply)
- Sales opportunities detected per week
- “Next action taken” rate
Trust/Safety
- % of blocked/flagged prevented from publishing
- Incidents: off-brand or risky content published (target near-zero)
## 6) Product Scope &amp; Information Architecture
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
## 2) Roles &amp; Permissions
### Roles (minimum set) 
- Owner: full access (billing, security, settings, publish, approvals).
- Admin: manage integrations, teams, settings, automations, publishing.
- Editor/Creator: create and edit drafts, generate media, schedule (if granted).
- Approver: approve/reject content and engagement replies; cannot change settings.
- Viewer: read-only access.
- Client: 
### Permission Controls (workspace-configurable)
- Publish permission (per role)
- Approval required for publish (on/off)
- Approval required for media generation (optional)
- Spend credits permission (on/off)
- Automation auto-publish allowed (on/off)
## 7) Global System Rules
- Autopublish default ON for activated campaigns (unless user disables or policy restricts).
- Approvals are optional and can be enabled:
- globally (workspace)
- per campaign
- per content type/platform
- triggered by governance rules (restricted topics, claims, strict mode)
- Every agent action must be explainable (“why” visible) for:
- trend selection
- calendar recommendations
- engagement classification
- automation decisions
- Unified statuses across content:
- Draft → Needs Review → Approved → Scheduled → Published
- Failed / Blocked
- Queues are first-class: Plan, Review, Automation, Engagement each visible and actionable.
# 8) Modules &amp; Feature Requirements
Each module section includes: Description → Goals → Inputs/Config → Outputs → Functional requirements → UI flow breakdown (based on the sketch).
## 8.1 Authentication &amp; Entry
### Description
Users enter via pricing/plan selection and create an organization account via email/password or SSO.
### Goals
- Fast account creation with plan context preserved
- Secure verification for email/password signups
- Smooth transition into agent narrative (SPARK introduction)
### Inputs/Config
- Selected plan (trial vs paid)
- Auth choice (email/pass or SSO)
### Outputs
- Authenticated account session
- Organization created (or ready to create on first brand creation)
### Functional requirements
- Email/password signup with terms acceptance
- OTP verification with resend throttling and lockout
- SSO provider OAuth
- Login and password reset (implied)
### UI flow breakdown
AUTH-01: Start Trial / Get Started (from pricing plan)
AUTH-02: Sign Up (Name, Email, Password or SSO; Terms checkbox)
AUTH-03: Verify Email (OTP) (email/pass only)
AUTH-04: Welcome Transition (“Meet SPARK”) → proceed to onboarding
## 8.2 Brand Onboarding (Workspace Creation)
### Description
A guided chat-style onboarding where SPARK captures brand identity, knowledge, guardrails, timezone, and social connections, then personalizes the agent.
### Goals
- Capture enough data for SPARK to publish confidently
- Establish governance rules early
- Connect socials to enable autopublish and engagement ingest
### Inputs/Config
- Brand name, description, logo
- Brand URL + PDFs/knowledge docs
- Voice sliders, restricted topics, claims to avoid, strict mode
- Timezone (required)
- Social accounts (OAuth)
- Agent alias + avatar + optional media identity (voice/cameo)
### Outputs
- Brand workspace created
- Brand kit/voice/guardrails saved
- Integrations connected (if done)
- Initial agent identity saved
- Ready state for campaign creation
### Functional requirements
- Save and reuse brand kit and guardrails across all modules
- Support skipping optional knowledge uploads without breaking onboarding
- Allow connecting accounts during onboarding or later
### UI flow breakdown
ONB-01: Brand Identity (name, description, logo)
ONB-02: Brand Knowledge (URL, PDF upload, extra notes, skip)
ONB-03: Voice + Guardrails + Timezone (sliders, restricted topics, claims, strict mode, timezone picker)
ONB-04: Connect Social Accounts (connected profiles list + OAuth popup)
ONB-05: Agent Personalization (alias, avatar upload/presets, optional cameo import, optional voice record/upload + Sora auth popup)
ONB-06: Setup Complete (“Press &amp; Hold to Continue”) → Brand Home
## 8.3 Dashboards
### Description
Two dashboards: Brand Home (workspace) and Account Home (org).
### Goals
- Brand Home: drive next best action and show agent value immediately
- Account Home: manage multiple brands + access agency portal and billing
### Inputs/Config
- Whether campaign exists
- Whether accounts are connected
- Whether recipes exist
- Whether engagement is eligible/active
### Outputs
- Clear “setup required” CTA states
- Quick access to key modules
### Functional requirements
- Prominent CTA to create first campaign if not active
- Preview widgets: calendar, discovery, engagement, automation, agent status
### UI flow breakdown
DASH-B-01: Brand Home Dashboard (campaign CTA + previews)
DASH-A-01: Account Dashboard (brands list + agency portal tiles + billing/trainings/settings)
## 8.4 Agents &amp; Campaigns
### Description
Agents are the AI operators. Campaigns define what an agent should do: goals, offer context, channels, and autonomy responsibilities.
### Goals
- Make campaign creation simple but powerful
- Turn a brand + offer into an autonomous posting system
- Configure learning, optimization, engagement gating, and approvals
### Inputs/Config
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
### Outputs
- Active campaign
- Calendar plan + plan queue populated
- Posting begins autonomously (subject to approvals/governance)
### Functional requirements
- Campaign activation triggers:
- initial posting plan and schedule
- creation of content items with statuses
- Approvals can be enabled to route items to Needs Review instead of publishing
- Engagement intelligence is gated until “eligible”
### UI flow breakdown
AGT-01: Agents List (open command center; pause/resume; duplicate; delete)
CMP-01: Campaign Wizard
- CMP-01.1: Goal / Focus
- CMP-01.2: Campaign Type (agent suggests; user can choose)
- CMP-01.3: Offer Details (URL/docs/CTA URL tooltip)
- CMP-01.4: Select Accounts (AI preselect + connect new)
- CMP-01.5: Responsibilities &amp; Learning (autopublish default ON; approvals optional; engagement gated)
- CMP-01.6: Review &amp; Activate (summary → activate)
## 8.5 Command Center
### Description
The main supervision hub. It must always communicate who SPARK is, what it’s doing, what’s next, and whether it’s working. Includes the Chat Drawer control plane.
### Goals
- Make the agent feel “alive” and operational
- Provide controls without overwhelming
- Provide visibility into queues (plan, review, engagement, automation)
- Enable chat-driven commands and draft creation
### Inputs/Config
- Agent identity and campaign
- Current queues
- Approval settings
- Learning mode and cadence settings
### Outputs
- Live status banner
- Next actions queue
- Performance snapshot + recommendations
- Commands produce immediate visible outcomes
### Functional requirements
- Control toggles:
- pause agent
- adjust frequency
- approval mode on/off
- freeze/reset learning
- Explainability: “why” for agent actions
- Chat drawer triggers draft creation and scheduling actions
### UI flow breakdown
CC-01: Command Center Overview (identity bar, focus, upcoming actions, performance, controls, engagement feed entry, calendar entry)
CC-02: Chat Drawer (chat commands + “One Brief → Draft Pack” mode + draft preview panel)            - CC-02A: Post Draft Preview Viewer (tabs: carousel/captions/reel script/images;edit/regenerate/generate media)
           - CC-04: Placement Step (where to post + date/time picker + publish mode)
CC-03: Command Center Calendar and Queue: This tab shows all the upcoming queue for campaign and also a calendar view to learn.CC-04: Command Center Performance and Learning: This tab shows metrics (Impressions, Saves and Replies + Website traffic (gotten from CTA)
CC-04: Command Engagement Intelligence: This tab agent replies, comments and other engagements activity. Initial Setup is done in the Settings Page:ENG-04: Eligibility Gate (ineligible notice; eligible configure state)   ENG-04: Active Engagement Feed with Tabs
- ENG-04.1: Needs Review
- ENG-04.2: Suggested Replies
- ENG-04.3: Auto-Handled
- ENG-04.4: Sales Opportunities (hot/warm/cold + recommended action + conversation drawer)
## 8.6 Content Creation &amp; Draft Packs
### Description
Text-first drafting (carousel/captions/reel scripts) with optional media generation. Draft Packs can be created from the chat drawer, calendar date action, trend repurpose, or automations.
### Goals
- Fast drafts in brand voice
- Simple editing and regeneration
- One-click media generation
- Seamless placement into calendar and library
### Inputs/Config
- Brief/prompt
- Apply Brand Kit toggle
- Output type selection (carousel/captions/reel script)
- CTA goal and link (when relevant)
### Outputs
- Draft Pack + individual content items
- Media renders (carousel images, caption images, reels) where enabled
- Items placed on calendar with statuses
### Functional requirements
- Draft editing is persistent
- Regeneration can happen per section
- Governance checks set status to Needs Review or Blocked
- Autopublish flow:
- if approvals OFF and no flags → schedule/publish automatically
- if approvals ON or flagged → Needs Review
### UI flow breakdown (where it appears in the sketch)
- From CC-02 Chat Drawer → CC-03 Draft Viewer → CC-04 Place to accounts/date
- From CAL-02 Date Action Panel → create draft → place
- From DISC-02 Trend Detail → generate content pack → place
- From AUTO outputs → appear in automation queue and calendar
## 8.7 Calendar
### Description
Calendar is the planning and execution view. It shows what will post, what posted, and what needs review. It supports date-based creation, agent planning, and drag-and-drop adjustments with impact warnings.
### Goals
- Make the posting plan visible and editable
- Allow rapid “fill the week” actions
- Provide safe rescheduling with rebalancing suggestions
- Serve as the execution surface for autopublish
### Inputs/Config
- Timezone
- Campaign cadence and posting windows
- Approval requirements and governance rules
### Outputs
- Scheduled/published posts
- Needs Review items (if approvals/flags)
- Rebalanced weekly plan after changes
- Recommendations over time
### Functional requirements
- Month view required; week view optional
- Filters by status/platform/type
- Drag impact prompt + rebalancing
- Post detail drawer with edit/regenerate/approve/publish actions
### UI flow breakdown
CAL-01: Calendar view (month + optional week; filters)
CAL-02: Date Action Panel (“What would you like to post here?”)
CAL-03: Ask Agent to Plan (recommendation → accept → draft)
CAL-04: Create Post for Date (brief → draft → choose accounts/time)
CAL-05: Drag &amp; Drop Adjustment (impact warning + “rebalance” option)
CAL-06: Draft / Needs Review Detail Drawer (edit/regenerate/approve/schedule)
## 8.8 Engagement Intelligence (NOTE: Setup is done from the workspace settings and shown in its active state inside the command center)
### Description
A feed that consolidates DMs, comments, and story replies and lets SPARK suggest replies, auto-handle safe interactions, and surface sales opportunities—while respecting autonomy level and approvals.
### Goals
- Reduce response time and missed messages
- Maintain brand voice and safety
- Detect sales intent and recommend next steps
- Keep humans in control when needed
### Inputs/Config
- Engagement autonomy level
- Enabled engagement types (comments/DMs/story replies)
- Approval rules for sending replies
- Restricted topics/claims and strict compliance mode
### Outputs
- Suggested replies
- Auto-handled log
- Sales opportunities list with actions
- Engagement audit trail (what SPARK did and why)
### Functional requirements
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
- platform icon, original message, classification, “why”
- suggested reply (editable)
- actions: approve &amp; send / edit / reject / take over
### UI flow breakdown
ENG-01: Eligibility Gate (ineligible notice; eligible configure state)
ENG-02: Active Engagement Feed with Tabs
- ENG-02.1: Needs Review
- ENG-02.2: Suggested Replies
- ENG-02.3: Auto-Handled
- ENG-02.4: Sales Opportunities (hot/warm/cold + recommended action + conversation drawer)
## 8.9 Trend Discovery
### Description
A discovery surface that ranks trends by velocity, saturation, and relevance to the brand. Trends can be repurposed into posts or reshared with CTA rewrites.
### Goals
- Let brands act on trends before saturation
- Provide brand-safe repurposing
- Make trend → publish a short, reliable flow
### Inputs/Config
- Filters: platform, content type, language, region
- Brand safety filter
- Watchlist keywords
- Influencer watchlist
### Outputs
- Trend feed cards and detail pages
- Repurposed draft packs
- Reshare caption that routes to CTA
### Functional requirements
- Trend cards show: volume, saturation, velocity, growth
- Trend detail includes:
- metrics + time series
- sample posts
- generate content pack panel (brief title, goal, CTA, post types, brand kit toggle, A/B toggle optional)
- recommendations row (time shift, format, hook) with apply buttons
### UI flow breakdown
DISC-01: Trend Feed (filters + trend cards + actions: open/repurpose/reshare)
- Click Repurpose ⇒ generate a draft, then the preview screen to generate and publish 
- Click Reshare ⇒ gets CTA and goal and rewrites caption to share the share and also reroute CTA to the added CTA link
DISC-02: Trend Detail (metrics left; samples + content pack panel right; apply recommendations)
## 8.10 Automation Recipes
### Description
Automation Recipes continuously generate and publish content on a schedule, using trend queries, bulk imports, or RSS feeds. All outputs flow into a queue and optionally into calendar.
### Goals
- Make social execution scalable and repeatable
- Offer “set-and-forget” autopublishing with optional review gates
- Provide transparency via the automation output queue
### Inputs/Config (common)
- recipe name
- target accounts
- goal + CTA URL
- frequency schedule (hour/day/week)
- start/end options
- review-before-publish checkbox (optional)
- governance rules apply automatically
### Outputs
- queued posts (Draft/Needs Review/Scheduled/Published)
- automation run logs (last run, next run, success/failure)
### Functional requirements
- Recipes home shows:
- recipe catalog AutoTrend Engager, Bulk Connector, RSS Autopost
- automation output queue with status filters
- Autopublish behavior:
- default: publish automatically if approvals are OFF and content not flagged
- if “review before publish” ON or approvals ON: route to Needs Review
### UI flow breakdown
AUTO-01: Recipes Home (catalog cards + output queue panel)
AUTO-02: AutoTrend Engagement
- AUTO-02.1: List (empty/created; pause/edit/delete)
Create new 
- AUTO-02.2: Name + Select Accounts
- AUTO-02.3: Trend Query (keywords, region, language, post age, exclude keywords)
- AUTO-02.4: Preview Trends (confirm selection)
- AUTO-02.5: Add CTA + Schedule (frequency; start/end; review checkbox)
AUTO-03: Bulk Connector
- AUTO-03.1: List (empty/created; pause/edit/delete; labels CSV/Canva/Drive/Folder)
- AUTO-03.2: Name + Select Accounts
- AUTO-03.3: Choose Source Type (CSV/Canva/Drive/Folder)  + Auth (CSV upload template tooltip; Canva/Drive auth; Folder selection)
- AUTO-03.4: Preview Table + Validate
- AUTO-03.5: CTA + Schedule (choose frequency, and posting cycle) + Review checkbox
AUTO-04: RSS Feed Automation
- AUTO-04.1: List (empty/created)
- AUTO-04.2: Name + Select Accounts
- AUTO-04.3: RSS URL + Preview
- AUTO-04.4: CTA + Schedule + Review checkbox
## 8.11 Folder / Asset Library
### Description
A lightweight DAM for organizing drafts and media outputs into folders, with quick reuse and repurpose actions.
### Goals
- Keep assets organized per brand and campaign
- Make reuse simple (send to calendar, repurpose, attach captions)
### Inputs/Config
- folder name
- asset metadata (caption, description, tags)
### Outputs
- folder structure
- searchable assets
- “reuse” actions into calendar and draft packs
### Functional requirements
- Folder list with empty state
- Folder detail grid/list view
- List view supports metadata editing (caption/description)
- Actions: upload, move, tag, reuse, repurpose
### UI flow breakdown
LIB-01: Folder List (empty → create first folder; list with created date/count)
LIB-02: Folder Detail (grid/list; table metadata fields; actions)
## 8.12 Settings
### Description
Two layers: Organization settings and Workspace (Brand) settings.
### Goals
- Give org-level governance, billing, and security control
- Give brand-level controls for kit, integrations, engagement autonomy, teams
### Inputs/Config
- org plan/credits/security
- workspace brand kit/voice/guardrails/knowledge
- integrations (scopes)
- roles and approval policies
### Outputs
- enforceable permissions and safe operations
- audit and governance controls
- predictable cost and usage tracking
### Functional requirements
- Organization settings include:
- billing/plan/credits/overage policies
- security (SSO/2FA)
- audit log
- data governance (residency/retention)
- API keys/webhooks (optional)
- Workspace settings include:
- brand kit &amp; voice
- brand knowledge docs
- integrations per platform
- engagement intelligence configuration
- teams &amp; roles
- usage sliice and alerts
- import/export workspace
### UI flow breakdown
SET-ORG-01: Org Settings (overview, billing, security, governance, legal, integrations, affiliates, API, danger zone)
SET-WS-01: Workspace Settings Tabs (overview, brand kit, engagement, integrations, usage, team/roles, import/export)
## 8.13 Agency Portal (Account Scope)
### Description
An account-level portal for agencies that includes website wizard, lead/job finder, trainings, plans/billing, and settings.
### Goals
- Provide agency “business enablement” tools beyond posting
- Centralize training, plans, and operations for agency users
### Outputs
- Agency dashboard tiles and entry flows (defined by separate PRD if deeper)
### UI flow breakdown
Visible from Account Dashboard as portal tiles.
# 9) Governance &amp; Autonomy Model
### Autonomy defaults
- Active campaign = autopublish ON by default (subject to integrations and plan constraints).
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
Channels and Mediums
## 1. Publishing Channels (Direct Post &amp; Scheduling)
### Core social platforms (must-have at GA):
### Facebook Pages &amp; Groups
### Instagram (Business accounts, Reels, Stories, Posts)
### LinkedIn (Profiles &amp; Company Pages)
### Twitter / X
### YouTube (Videos, Shorts, Community posts)
### TikTok (Videos &amp; Ads library posts if available)
### Pinterest
- Sora
### Secondary / Optional (v1.1+ or v2):
### Google Business Profile (posts, updates, offers)
### Snapchat Spotlight / Public Profiles
### Reddit (communities)
### Medium / Substack (for long-form blog posts)
### Cross-posting utilities:
### WordPress (blog sync)
### Shopify Blog (optional commerce tie-in)
### 
## 2. Discovery Channels (Trends, Insights, Inspiration)
### Social-native trend feeds:
### Twitter/X Trending API (topics &amp; hashtags)
- Sora AI Trending API
### TikTok Creative Center / Sounds library (trending sounds, hashtags)
### YouTube Trending API (videos, shorts, trending searches)
### Instagram Explore / Hashtags API (limited official API but possible through partners)
### Pinterest Trends (official trends API in beta)
- Sora
### Content &amp; news:
### Google Trends API (search demand insights)
### Reddit API (hot/rising threads in target subreddits)
### RSS feeds (general news, industry blogs)
### Media &amp; assets:
### Pexels / Unsplash / Pixabay APIs (images &amp; video stock for content creation)
### Giphy API (GIFs for posts)
### Spotify/TikTok Sounds (for reels/shorts audio)
# 
# Product Wireframe (v1)
https://whimsical.com/sparksocial-wireframe-map-UKqqgyCeEdmYcGmzuMJgGU
# 10) Risks &amp; Mitigations
- Risk: wrong or off-brand autopostingMitigation: optional approvals + strict mode + flagging + “why” + rollback controls
- Risk: automation floods feeds/calendarsMitigation: queue caps, frequency limits, preview steps, relevance thresholds
- Risk: engagement misfiresMitigation: autonomy levels + approval requirements + allow take over + audit logs
- Risk: integration failures cause silent missesMitigation: connection health indicators + alerts + retry flows
# 11) Rollout Plan
### Phase 1 — Core Agent OS
- onboarding + brand kit + integrations
- agent + campaign wizard
- command center + calendar with autopublish
- library basics
- discovery feed (basic)
- automation recipes (RSS + CSV bulk)
### Phase 2 — Growth Systems
- trend detail + repurpose packs
- AutoTrend recipes
- engagement intelligence (suggest replies + needs review)
### Phase 3 — Monetization &amp; Scale
- sales opportunities routing enhancements
- performance learning recommendations
- org governance depth + agency portal expansion
# 12) Open Questions to Finalize
- Eligibility rule for engagement intelligence (time-based, volume-based, or hybrid)?
- Default approval policy per plan (SMB vs Agency)?
- Trend sources and granularity in v1 (which platforms, what metrics are feasible)?
- Recipe output format defaults (single post vs pack) per recipe type?
- Credit model: what consumes credits, and how budget alerts work?
## Appendix: UI Flow Map (Quick Index)
- AUTH: AUTH-01 → AUTH-04
- Onboarding: ONB-01 → ONB-06
- Dashboards: DASH-B-01, DASH-A-01
- Agents/Campaign: AGT-01, CMP-01.1 → CMP-01.6
- Command Center: CC-01 → CC-04
- Calendar: CAL-01 → CAL-06
- Engagement: ENG-01 → ENG-02.4
- Discovery: DISC-01 → DISC-02
- Automation: AUTO-01 → AUTO-04.4
- Library: LIB-01 → LIB-02
- Settings: SET-ORG-01, SET-WS-01