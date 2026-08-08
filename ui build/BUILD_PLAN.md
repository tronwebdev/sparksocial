# SparkSocial — Full Build Plan

**Version 1.0 · July 2026**
Prototype (this project) = design source of truth. Builder = Claude Code. This document is the build contract.

---

# Part 1 — The App

## 1.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | Real routing, server components, API routes for the AI layer, single repo. Claude Code's strongest territory. |
| Styling | **Tailwind CSS + shadcn/ui** | Prototype tokens map 1:1 to a Tailwind theme; shadcn primitives restyled fully to SparkSocial (never default-looking). |
| Motion | **Framer Motion** | Drawer slides, generation states, streaming reveals, hold-to-confirm buttons. |
| Server state | **TanStack Query** | Campaigns, drafts, brand kits — cache, optimistic updates, polling generation jobs. |
| UI state | **Zustand** | Overlay/drawer state (Spark chat, draft panel), wizard steps. |
| Database | **Neon** (serverless Postgres) | Instant DB branching per preview deploy; plain Postgres = zero lock-in; lift-and-shift path to AWS Aurora at massive scale. Drizzle ORM for typed schema + migrations. |
| Auth | **Clerk** | Best-in-class auth with **organizations/workspaces + roles built in** — maps 1:1 to SparkSocial's workspace/member/admin model. |
| Media storage | **Cloudflare R2** + CDN | S3-compatible, **zero egress fees** — the biggest cost lever for a product whose output is images/video. |
| Realtime | **Ably** (or SSE) | Streams generation-job progress into the Draft Panel. |
| Background jobs | **Trigger.dev** (or Inngest) | Long-running generation pipelines (video = minutes), retries, step functions, per-step observability. |
| Video delivery | **Mux** | Transcode + adaptive streaming of generated videos; thumbnails; per-platform renditions. |
| Deploy | **Vercel** | Native Next.js; preview deploys per PR, each with its own Neon DB branch. |

> Where scale pressure actually lives in this product: **not the relational DB** (workspace/campaign data is modest) but **media storage + delivery** and the **generation pipeline** — hence R2 (zero egress), Mux (adaptive video), Trigger.dev (durable jobs). Every choice above is plain-standard (Postgres, S3 API, React) so nothing locks in.

## 1.2 Design tokens (extract from prototype → `tailwind.config.ts`)

- **Colors**: primary purple family, dark sidebar/canvas neutrals, surface/card grays, semantic (success/warn/error), platform accent colors (per social network). Pull exact hex values from the `.dc.html` files — they are Figma-exact.
- **Type**: the two families used in the prototype (display + UI), full size/weight/line-height scale as used per screen.
- **Radii / shadows / spacing**: read off the components; prototype values are authoritative.
- **Dark-on-light and light-on-dark** contexts both exist (sidebar vs. content) — encode as CSS variables, not hardcoded classes.

## 1.3 Routes

```
/login                       Auth (role-aware: admin / member states)
/onboarding                  Multi-step onboarding wizard → ends on dashboard w/ Create Campaign open
/                            Dashboard (Command Center)
/campaigns                   Campaign list
/campaigns/new               Create Campaign wizard (modal-route over dashboard)
/campaigns/[id]              Campaign detail
/calendar                    Content calendar
/drafts                      Drafts list
  → Draft Panel = intercepted route rendered as right-side panel over any screen
/settings/workspace/[section]   overview | brand-kits | engagement | members | billing | integrations | notifications
/settings/personal/[section]    profile | preferences | notifications | security
Spark chat = global overlay (Zustand), never a route — opens over any screen (matches prototype behavior)
```

## 1.4 Data model (Postgres on Neon, Drizzle ORM)

```
workspaces            id, name, url_slug, description, logo
workspace_members     workspace_id, user_id, role (admin|member), invited_by, status
users                 id, email, name, avatar
brand_kits            id, workspace_id, name, is_complete
  brand_colors        kit_id, hex, role (primary|secondary|accent|neutral)
  brand_logos         kit_id, storage_path, variant (full|mark|mono), safe_zone
  brand_fonts         kit_id, family, role (display|body), source
  brand_references    kit_id, storage_path, kind (image|video), analysis jsonb  ← Claude's aesthetic analysis
  brand_voice         kit_id, tone descriptors, do/don't lists, sample copy
campaigns             id, workspace_id, name, goal, platforms[], cadence, start/end, status
posts                 id, campaign_id, type (image|video|text|carousel|voice), status
                      (draft|generating|ready|scheduled|published), scheduled_at, platform,
                      content jsonb (copy, hashtags, cta)
assets                id, post_id, storage_path, mux_id, kind, provenance jsonb
                      (model, prompt, seed, references used, judge_score)
generation_jobs       id, post_id, pipeline, step, status, progress, error, cost_cents
conversations         id, workspace_id, user_id, title            (Spark chat)
messages              conversation_id, role, content jsonb
integrations          workspace_id, platform, account handle, oauth tokens (encrypted)
notifications         user_id, type, payload, read_at
```

Access control: every table scoped by `workspace_id`, enforced in the data layer (Drizzle + Clerk org context); role checks for admin-only mutations (billing, members, integrations). Clerk organizations are the source of truth for membership/roles; `workspace_members` mirrors it for joins.

## 1.5 Component inventory (from prototype → shadcn-based library)

**Primitives (restyled shadcn)**: Button (primary/secondary/ghost/danger + hold-to-confirm variant), Input, Textarea, Select, Checkbox, Switch, Tabs, Tooltip, Dialog, DropdownMenu, Avatar, Badge/Chip, Progress, Skeleton, Toast.

**SparkSocial composites** (build exactly to prototype):
- `AppShell` — dark sidebar + top bar + content canvas
- `SidebarNav` — sections, active states, workspace switcher
- `CampaignCard`, `DraftCard`, `CalendarCell`, `PostPreview` (per platform frame)
- `SparkChat` — global overlay: New Chat / My Conversations tabs, suggestion chips, streaming responses (the prototype's `Spark Chat.dc.html` is the spec)
- `DraftPanel` — right slide-in panel, all 22 states from prototype: closed tab, generating, per-type editors (image / video / text / carousel / voice), current draft vs. drafts list, chat drawer, date & time picker with calendar select
- `CreateCampaignWizard` — multi-step modal flow
- `BrandKitEditor` — colors, logos, fonts, references upload, voice
- `SettingsLayout` — two-pane settings with section nav (26 screens' worth of sections from prototype)
- `HoldButton` — press-and-hold confirm (onboarding finale)
- `GenerationStatus` — job progress with step labels, streamed via Ably/SSE

## 1.6 Screen-by-screen build order

1. Design tokens + primitives + `AppShell`
2. Auth + Onboarding (role-aware login → onboarding → dashboard handoff)
3. Dashboard / Command Center (incl. Spark chat overlay + brand-kit completion chip → settings deep link)
4. Settings (workspace 7 sections, personal 4 sections; deep-linkable `#section` anchors like the prototype)
5. Create Campaign wizard
6. Calendar
7. Draft Panel (all 22 states) — the most intricate surface; build last, against a working generation API
8. Integrations OAuth flows
9. Notifications, billing

Each screen: build → compare side-by-side against the corresponding `.dc.html` → match spacing/type/color exactly. The prototype's absolute-positioned fidelity converts to flex/grid, responsive at ≥1280 desktop first, then tablet/mobile passes.

---

# Part 2 — The Content Engine

**Principle: AI generates the organic content; code guarantees the brand.**
Text-to-video alone cannot guarantee exact hex colors, logo placement, or typography. So the engine is three layers: Claude directs and judges, generation models create raw material conditioned on brand references, and a deterministic composition layer applies the brand system as code.

## 2.1 Layer 0 — Brand Kit ingestion (runs once per kit, re-runs on edit)

Input: user-added colors, logos, fonts, reference images, reference videos.
Pipeline (Trigger.dev job):
1. **Claude Vision analysis** of every reference image/video (keyframes extracted via ffmpeg): produces a structured **Brand Aesthetic Profile** — composition preferences, lighting style, subject matter, color usage in practice, texture/grain, pacing (for video), do/don't list.
2. **Voice analysis** of any sample copy → tone descriptors, vocabulary, emoji policy, CTA style.
3. **Logo prep**: background removal check, mono variant, safe-zone box.
4. **Palette → LUT**: generate a color-grade LUT from the brand palette for video grading.
5. Store all of it as the `brand_context` object — the single artifact injected into every generation.

## 2.2 Layer 1 — Claude as Creative Director

For each post the campaign plan calls for:
1. **Creative brief** (Claude, with `brand_context` + campaign goal + platform specs): hook, copy, visual concept, shot list (for video), aspect ratio, duration.
2. **Prompt compilation**: brief → model-specific prompts, embedding aesthetic descriptors from the Brand Aesthetic Profile; selects which brand reference images/clips to pass as conditioning inputs.
3. Copy itself is written by Claude directly (voice-matched), never by the image/video model.

## 2.3 Layer 2 — Generation (all via **fal.ai** as unified gateway)

One API key, one integration pattern; models are endpoint strings — swap freely as the leaderboard moves. Current routing table (July 2026):

| Asset | Primary | Why | Fallback |
|---|---|---|---|
| **Video (hero/brand film)** | **Seedance 2.x** | Reference-rich conditioning: feed brand reference images + clips directly per generation; best motion/physics; multi-shot consistency | Kling 3.0 (native 4K/60fps, 15s) |
| **Video (w/ dialogue or synced audio)** | **Veo 3.1** | Best synchronized audio incl. dialogue; cheap Fast/Lite tiers for iteration | Seedance (native audio) |
| **Video (precise art direction)** | **Runway Gen-4.5** | Best control surface (camera, motion, scene consistency) when the brief demands directed shots | — |
| **Images (photographic/social)** | **FLUX (latest, Kontext)** | Reference/style conditioning from brand images; edit-in-place for revisions | Imagen |
| **Images (text-heavy: quotes, promos)** | **Ideogram (latest)** | Best in-image typography — though final brand type is still overlaid in Layer 3 | gpt-image |
| **Voiceover** | **ElevenLabs** | Brand voice profile, per-workspace voice | — |
| **Music beds** | Licensed library API first | Rights-safe | gen-music model |

Iteration strategy: generate drafts on cheap/fast tiers (Veo Fast, Seedance Fast — cents per clip), regenerate the user-approved concept once on the premium tier. This is how quality stays high and cost stays sane.

## 2.4 Layer 3 — Brand Composition (deterministic, **Remotion**)

React-based video rendering — same language as the app, Claude Code-native:
- **Typography**: titles, captions, subtitles set in the actual brand fonts (never AI-rendered text)
- **Color grade**: brand LUT applied to AI footage
- **Logo**: placed per safe-zone rules; animated sting/end-card from a per-brand template
- **Structure**: multi-shot assembly (AI clips are 5–15s; posts are assembled sequences), transitions, platform-specific safe areas (TikTok/Reels UI zones), aspect crops per platform from one master
- **Statics**: same via Satori/Canvas — AI image as layer, brand type/logo/frame composed on top
- Output: Remotion Lambda render → Mux → per-platform renditions

## 2.5 Layer 4 — The Judge loop (this is the "true intelligence")

Every rendered asset goes back to **Claude Vision** with the brand kit:
- Scores: palette adherence, logo clarity, typography correctness, aesthetic-profile match, platform fitness, copy-voice match
- Below threshold → Claude writes a *corrective* prompt diff and the pipeline retries (max N, budget-capped)
- Passing assets land in the Draft Panel with score + provenance visible
- Every user accept/reject/edit is logged → periodically distilled by Claude into updates to the Brand Aesthetic Profile → **the engine gets more on-brand with use**

## 2.6 Pipeline shape (per post)

```
brief (Claude) → prompts (Claude) → generate (fal: Seedance/Veo/FLUX/…)
→ compose (Remotion + brand system) → judge (Claude Vision)
   ↳ fail: corrective retry (≤N)     ↳ pass: Draft Panel → user approve → schedule/publish
```

All steps = one Trigger.dev run; progress streamed to the Draft Panel via Ably/SSE (matches the prototype's generating states).

## 2.7 Cost guardrails

- Per-workspace monthly generation budget; per-job cost recorded (`generation_jobs.cost_cents`)
- Draft tier ≈ $0.02–0.09/sec video; premium finals ≈ $0.20–0.60/sec — budget model: drafts free-feeling, finals metered
- Judge loop capped at 2 retries before surfacing to user with Claude's notes

---

# Part 3 — Handoff package (produced at end of refinement)

1. `BUILD_PLAN.md` (this doc)
2. `tokens.json` + `tailwind.config.ts` starter — exact values extracted from the prototype
3. `FLOW_MAP.md` — every clickable element → destination/behavior, per screen
4. `SCREENS/` — per-screen spec: annotated states, interactions, animation timings
5. `COMPONENTS.md` — composite inventory with props + which screens use them
6. `CONTENT_ENGINE.md` — Part 2 expanded: prompt templates, judge rubric, Remotion template specs
7. The prototype itself — running reference implementation

**Build sequence for Claude Code**: tokens → primitives → shell → auth/onboarding → dashboard → settings → campaign wizard → calendar → generation API + pipeline → draft panel → judge loop → integrations → billing.

---

*Model choices verified against July 2026 landscape; the fal.ai gateway pattern means any of them swap without re-architecting. Re-verify pricing/leaderboards at build time.*
