# SparkSocial AI — Content Engine Specification

**Version:** 1.0
**Status:** For engineering review
**Owner:** Godswill / Tronweb
**Scope:** The content generation subsystem of SparkSocial AI. Supersedes the "Content Generation" section of SparkSocial PRD v1.0.

---

## 0. Why this document exists

Everything else in the SparkSocial PRD — Command Center, Calendar, Trend Discovery, Automation Recipes, Asset Library, Engagement Intelligence, Agency Portal — is well-understood surface area. Any competent team can build it.

The Content Engine is the product. It is the only part that determines whether a customer keeps paying after month two.

The failure mode we are engineering against is specific and common: **AI social tools generate high volumes of content that does not serve the business.** A barbershop receives an AI avatar saying "book your appointment today." A B2B SaaS receives a motivational quote card. Both cancel within 30 days. Volume is not the product. Fit is the product.

This spec defines how SPARK achieves fit across arbitrary business types without a hand-maintained per-niche lookup table.

---

## 1. Core architectural thesis

### 1.1 Niche is not the primitive

The naive design is a taxonomy: `web_design_agency → [content_type_a, content_type_b, ...]`. This does not scale. You will cover 40 niches, ship, and then fail permanently on the long tail — mobile welders, exam prep tutors, B2B logistics brokers, Nigerian tailors.

Niche is a *label*. It is not what determines what content works.

### 1.2 What actually determines content fit

Four orthogonal properties, which compose:

| Dimension | Question it answers | Values |
|---|---|---|
| **Proof asset** | What does this business own that proves it is good? | `person` / `product_ui` / `physical_craft` / `finished_work` / `physical_product` / `data_outcomes` |
| **Capture capability** | What can they physically show us? | `screen` / `space` / `work_artifacts` / `product` / `nothing` |
| **Objective** | What is a good month? | `leads` / `bookings` / `trials` / `sales` / `audience` / `hiring` |
| **Talent availability** | Is there a human willing to be on camera or licensed for cloning? | `yes_licensed` / `yes_unlicensed` / `no` |

An influencer feels like an obvious case only because their proof asset *is* their face and voice. Generalize the property, not the persona.

### 1.3 The generation-mode insight

Every piece of content SparkSocial produces falls into one of three modes. Most competitors implement only the first.

| Mode | Definition | Applies when |
|---|---|---|
| **SYNTHESIZE** | SPARK creates the asset end to end — avatar video, voice clone, generated image/video, text-to-video | Proof asset is a person, or fully generative visuals are acceptable |
| **ASSEMBLE** | SPARK composes from material the customer already owns — screenshots, portfolio, testimonials, docs, photo library, past posts. Nothing new is filmed | Proof asset already exists in digital form |
| **DIRECT + FINISH** | SPARK cannot generate this content. It issues a precise capture brief to a human, receives raw footage, then edits, captions, hooks, and schedules it | Proof asset is physical and un-generatable |

**DIRECT + FINISH is the moat.** It is the only reason a local business stays subscribed, and no major competitor does it. It also maps directly onto the WhatsApp surface already built for Iyobo: the capture brief arrives as a WhatsApp message, the owner films 20 seconds on their phone, replies with the video, and SPARK returns a finished post.

Engineering must treat all three modes as first-class. Do not build Synthesize first and bolt the others on.

---

## 2. System overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      WORKSPACE GENESIS                          │
│         (onboarding → Brand Genome + Asset Graph seed)          │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
        ┌───────────────┐              ┌──────────────────┐
        │ BRAND GENOME  │              │   ASSET GRAPH    │
        │  (structured  │              │ (Asset Library + │
        │   profile)    │              │   embeddings)    │
        └───────┬───────┘              └────────┬─────────┘
                │                               │
                └──────────────┬────────────────┘
                               ▼
                    ┌──────────────────────┐
                    │   PLAYBOOK RESOLVER  │
                    │ (precondition match) │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │     MIX ENGINE       │
                    │ (ratios + scheduling)│
                    └──────────┬───────────┘
                               ▼
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌───────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  SYNTHESIZE   │   │     ASSEMBLE     │   │ DIRECT + FINISH  │
│   pipeline    │   │     pipeline     │   │     pipeline     │
└───────┬───────┘   └────────┬─────────┘   └────────┬─────────┘
        └────────────────────┼──────────────────────┘
                             ▼
                  ┌─────────────────────┐
                  │   GUARDRAIL LAYER   │
                  │ (claims, brand,     │
                  │  platform, dupe)    │
                  └──────────┬──────────┘
                             ▼
                  ┌─────────────────────┐
                  │  PUBLISH + LEARN    │
                  │ (perf → mix reweight)│
                  └─────────────────────┘
```

---

## 3. Brand Genome

The Brand Genome is the structured representation of a customer that every downstream decision reads from. It is built once during Workspace Genesis and continuously refined.

### 3.1 Onboarding capture — five questions, not a taxonomy

Do **not** present a dropdown of 200 industries. Ask five things and infer the rest.

| # | Question (user-facing) | Populates |
|---|---|---|
| 1 | "Paste your website or Instagram." | category, offer, tone, price tier, geography, language |
| 2 | "Is there someone willing to be the face of this?" | `talent_availability` |
| 3 | "What can you show me?" (multi-select with icons: my screen / my space / my finished work / my product / nothing yet) | `capture_capability`, `proof_asset` |
| 4 | "What does a good month look like?" | `objective` |
| 5 | "Connect or upload what you already have." | Asset Graph seed |

Everything else is inferred by an LLM enrichment pass over the crawled site, socials, and uploaded assets. Show inferences back to the user as **editable chips**, not as a form to fill. Confirmation is cheap; data entry is churn.

### 3.2 Schema

```json
{
  "genome_id": "gen_01H...",
  "workspace_id": "ws_01H...",
  "version": 3,

  "identity": {
    "business_name": "string",
    "category": "b2b_saas",
    "sub_category": "sales_automation",
    "one_liner": "string",
    "geography": { "scope": "global|national|local", "locale": "en-NG", "radius_km": null },
    "languages": ["en"],
    "price_tier": "budget|mid|premium|enterprise"
  },

  "dimensions": {
    "proof_asset": ["product_ui", "data_outcomes"],
    "capture_capability": ["screen"],
    "objective": "trials",
    "secondary_objectives": ["audience"],
    "talent_availability": "yes_licensed"
  },

  "voice": {
    "tone_vector": { "formal": 0.3, "playful": 0.6, "technical": 0.7, "bold": 0.8 },
    "pov_statements": ["Software should be delegated to, not operated."],
    "banned_phrases": ["game-changer", "revolutionary"],
    "required_disclaimers": [],
    "reading_level": 8
  },

  "audience": {
    "segments": [
      { "label": "SMB founders", "pains": ["..."], "platforms": ["linkedin", "x"] }
    ]
  },

  "offer": {
    "products": [{ "name": "ClientForce", "price": "…", "cta_url": "…" }],
    "primary_cta": "Start free trial"
  },

  "constraints": {
    "compliance_profile": "none|health|finance|legal|regulated_other",
    "avatar_enabled": false,
    "max_posts_per_week": 12,
    "approval_mode": "autopublish|review"
  },

  "learned": {
    "top_formats": ["workflow_clip", "problem_first_education"],
    "best_post_times": [],
    "mix_weights_override": null,
    "confidence": 0.0
  }
}
```

**Implementation notes**

- `dimensions` is the routing key for the entire engine. Treat it as the primary index.
- `genome.version` increments on every material change; regenerate cached playbook resolutions on bump.
- `learned` starts empty and is populated by the learning loop (§7). Until `confidence > 0.4`, defer to template defaults.
- Agencies: one genome **per client**, plus one for the agency itself. See §9.

---

## 4. Asset Graph

We already ship an Asset Library. The Asset Graph is not a new product surface — it is the Asset Library plus an embedding and retrieval layer, wired into the campaign flow. Do not build a second UI.

### 4.1 What changes about the existing Asset Library

1. **Every asset gets typed.** Add an `asset_role` field on top of the existing media type.
2. **Every asset gets embedded and captioned.** On upload, run a vision/audio pass to produce a semantic description, then embed with `text-embedding-3-large` @ 1536 dims (consistent with the ClientForce embedding standard).
3. **Assets become retrievable by intent**, not just browsable by folder. The Assemble pipeline queries the graph; the user does not hand-pick files.
4. **Ingest new source types**: screen recordings, product docs/help center, past published posts with their performance numbers, testimonial text, client case studies.

### 4.2 Asset roles

| `asset_role` | Description | Feeds |
|---|---|---|
| `talent_likeness` | Face/voice reference for cloning | Synthesize |
| `product_screen` | UI screenshots, screen recordings | Assemble |
| `work_artifact` | Portfolio, before/after pairs, deliverables | Assemble |
| `physical_capture` | Raw footage/photos of space, craft, staff | Direct + Finish |
| `product_shot` | Physical product photography | Assemble |
| `social_proof` | Testimonials, reviews, results screenshots | Assemble |
| `knowledge` | Docs, help center, landing pages, PDFs | All (grounding) |
| `past_post` | Previously published content + metrics | Learning loop |
| `brand_kit` | Logo, colors, fonts, templates | All (styling) |

### 4.3 Retrieval contract

```
GET /v1/assets/retrieve
{
  "workspace_id": "ws_...",
  "intent": "before and after of a kitchen renovation",
  "required_roles": ["work_artifact"],
  "constraints": { "min_resolution": "1080x1920", "pairable": true },
  "k": 8
}
→ [{ asset_id, role, caption, embedding_score, usage_count, last_used_at, rights_status }]
```

- `usage_count` and `last_used_at` prevent the same three photos appearing every week. Apply a recency penalty in ranking.
- `rights_status` gates UGC and client-owned material. Agencies must not cross-pollinate client assets between workspaces. Enforce at the query layer, not the UI layer.

### 4.4 Asset gap detection

The Asset Graph must be able to report what it *lacks*. This is what drives the capture loop.

```
GET /v1/assets/gaps?workspace_id=…&horizon_days=30
→ [
    { "missing_role": "physical_capture", "playbook_blocked": "craft_capture",
      "impact": "8 of 12 planned posts", "suggested_brief_id": "brief_…" }
  ]
```

SPARK surfaces this conversationally: *"I can plan your month, but I only have four usable photos. Give me 90 seconds of filming and I can build 12 posts instead of 4."*

---

## 5. Playbook Library

A playbook is a composable content recipe. Playbooks are tagged with **preconditions expressed in genome dimensions**, never with niche names. This is what allows an unanticipated business type to resolve correctly.

### 5.1 Schema

```json
{
  "playbook_id": "pb_workflow_clip",
  "name": "Workflow Clip",
  "description": "One product workflow, 15–30s, screen recorded, time-saving hook.",
  "mode": "assemble",

  "preconditions": {
    "capture_capability_any": ["screen"],
    "proof_asset_any": ["product_ui"],
    "required_asset_roles": ["product_screen"],
    "min_assets": 1,
    "talent_required": false
  },

  "output": {
    "media_type": "video",
    "aspect_ratios": ["9:16", "1:1"],
    "duration_sec": [15, 30],
    "platforms": ["instagram", "tiktok", "linkedin", "x", "youtube_shorts"]
  },

  "structure": {
    "beats": [
      { "id": "hook", "duration_sec": 3, "prompt_ref": "hook.time_cost" },
      { "id": "demo", "duration_sec": 18, "source": "asset:product_screen" },
      { "id": "payoff", "duration_sec": 5, "prompt_ref": "payoff.outcome" },
      { "id": "cta", "duration_sec": 3, "source": "genome:offer.primary_cta" }
    ]
  },

  "objective_fit": { "trials": 0.9, "leads": 0.7, "audience": 0.4, "sales": 0.5 },
  "content_pillar": "product",
  "saturation_risk": "low",
  "compliance_flags": []
}
```

### 5.2 Resolver logic

```
resolve_playbooks(genome, asset_graph):
    candidates = all_playbooks
    candidates = filter(preconditions satisfied by genome.dimensions)
    candidates = filter(required_asset_roles present in asset_graph OR mode == "direct_finish")
    for each candidate:
        score = objective_fit[genome.objective]
              * asset_availability_factor
              * (1 - saturation_penalty)
              * learned_performance_multiplier   # 1.0 until confidence > 0.4
    return ranked candidates
```

Playbooks whose asset requirements are unmet but whose mode is `direct_finish` are **not** discarded — they are returned as *unlockable*, and feed the capture loop.

### 5.3 Launch playbook set (v1)

Ship ~30. Below is the required minimum, grouped by mode.

**SYNTHESIZE**
`avatar_pov` · `avatar_explainer` · `voice_over_broll` · `generated_quote_card` · `talking_head_hot_take` · `ai_ugc_testimonial` (rights-gated) · `carousel_teaching`

**ASSEMBLE**
`workflow_clip` · `before_after_transformation` · `result_card` · `portfolio_in_motion` · `changelog_ship_post` · `comparison_vs` · `testimonial_snippet` · `data_insight_post` · `problem_first_education` · `case_study_breakdown` · `teardown_of_other_brands` · `product_in_use_montage`

**DIRECT + FINISH**
`craft_capture` · `staff_personality` · `space_atmosphere` · `customer_reaction` · `day_in_the_life` · `behind_the_build` · `offer_announcement_local` · `seasonal_local_context`

Each playbook is a data record, not code. Adding one must not require a deploy.

---

## 6. The Capture Loop (Direct + Finish)

This is the highest-differentiation, highest-risk component. Build it in Phase 1, not Phase 3.

### 6.1 Flow

```
1. Resolver identifies unlockable playbook (asset gap)
2. SPARK generates a CAPTURE BRIEF (specific, filmable, ≤60s of work)
3. Brief delivered via WhatsApp / SMS / push / email
4. Owner films on phone, replies with media
5. Ingest → Asset Graph as physical_capture
6. FINISH pipeline: trim, stabilize, colour, caption, hook overlay, music, aspect variants
7. Draft returned for approval or autopublished per genome.constraints.approval_mode
```

### 6.2 Capture brief quality bar

A brief is useless if it is vague. It must specify subject, framing, duration, motion, audio, and lighting. Generated briefs must pass a validator before send.

**Bad:** "Post a video of your work today."
**Good:** "Film 20 seconds of the fade from behind the chair. Vertical. Don't talk — we'll add captions. Face a window. Keep the clippers in frame the whole time."

```json
{
  "brief_id": "brief_…",
  "playbook_id": "pb_craft_capture",
  "subject": "the final fade blend",
  "framing": "behind subject, chest height",
  "orientation": "vertical",
  "duration_sec": 20,
  "motion": "slow push in or static",
  "audio": "ambient only, no speech",
  "lighting": "face a window, avoid overhead only",
  "do_not": ["do not talk to camera", "no filters"],
  "estimated_effort_sec": 45,
  "expires_at": "…"
}
```

### 6.3 Engineering requirements

- **Batching.** Never send briefs one at a time. Send a weekly "capture session": 3–5 briefs, ~5 minutes total, one sitting. Local business owners will not respond to daily nags.
- **Inbound media pipeline.** WhatsApp/SMS media ingest, transcode, dedupe, auto-assign `asset_role`, quality-score (blur, exposure, shake, duration). Reject-and-reshoot with a specific reason if below threshold.
- **Finish pipeline is the product.** Raw phone footage → publishable post. Auto-trim dead space, stabilize, caption burn-in (with locale-correct language), hook overlay in brand kit typography, licensed audio bed, export 9:16 / 1:1 / 16:9.
- **Fallback.** If no capture arrives within the window, degrade gracefully to an Assemble or Synthesize playbook. The calendar must never go empty because a human did not film.

---

## 7. Mix Engine

Selecting *what* to make is a solved-ish problem once playbooks resolve. Selecting the **ratio** is where fit is won or lost.

The single most common failure of AI social tools is generating ~100% promotional content. Correct mixes differ sharply by genome.

### 7.1 Default pillar weights (cold start)

| Genome profile | Educational / Problem | Product / Offer | Proof / Results | Personality / POV | Community / Local |
|---|---|---|---|---|---|
| B2B SaaS | 50% | 25% | 15% | 10% | — |
| Agency | 20% | 10% | 40% | 30% | — |
| Local business | 10% | 20% | 10% | 20% | 40% (craft + community) |
| Freelancer | 35% | 10% | 25% | 30% | — |
| E-commerce | 20% | 35% | 30% | 15% | — |
| Creator / influencer | 20% | 10% | — | 70% | — |

These are **defaults, not rules**. They exist only to fill the first 30–60 days.

### 7.2 Learning loop

After sufficient volume, the mix must be derived from *that customer's* performance, not from our table.

```
inputs:  per-post metrics (reach, watch-through, saves, comments, clicks,
         conversions where attributable), joined to playbook_id + pillar
method:  Thompson sampling over playbook arms, with pillar-level floors
         so the engine cannot collapse into one format
output:  genome.learned.mix_weights_override, genome.learned.confidence
```

Enforce a **minimum exploration floor** (e.g. 20% of slots) permanently. Without it the engine over-fits to whatever won in week three and the account goes stale.

**This is the compounding moat.** A competitor can clone the playbook library in a month. They cannot clone 90 days of a specific customer's performance history.

### 7.3 Campaign as the unit — not the post

Do not let users request "a post." The unit of delegation is a **campaign tied to a business outcome**:

- "Fill Tuesday nights."
- "Drive 50 trials this month."
- "Get five discovery calls."

The mix is *derived from the outcome*. This is the difference between a scheduler with AI attached and an agent you delegate to — and it is the entire reason SparkSocial exists rather than being a Buffer feature.

```json
{
  "campaign_id": "cmp_…",
  "outcome": { "type": "bookings", "target": 40, "window": "2026-08-01/2026-08-31" },
  "derived_mix": { "craft": 0.4, "offer": 0.25, "people": 0.2, "community": 0.15 },
  "derived_volume": { "posts_per_week": 6, "platforms": ["instagram", "tiktok"] },
  "capture_sessions": ["brief_…", "brief_…"],
  "status": "active"
}
```

---

## 8. Segment reference (for playbook authoring and prompt design)

This section is reference material for whoever authors playbooks and prompt templates. It is **not** a runtime lookup table.

### B2B SaaS
- **Proof asset:** product UI, customer outcomes, founder POV
- **Highest value, most under-produced:** product-in-motion — one workflow, 15–30s, screen recorded, with a "this used to take four hours" hook
- Also: problem-first education (the pain *before* the product), customer outcome cards with real numbers, founder thesis/POV, ship & changelog momentum, comparison content ("X vs Y" captures high-intent search and social demand)
- **Hard AI requirement:** *product understanding*. SPARK must ingest the actual app — help center, docs, landing page, real screen recordings — or it will confidently generate content about features that do not exist. This is the #1 credibility risk for the segment. Ground every product claim in `knowledge` assets; refuse to generate specifics that cannot be grounded.

### Agency
- **Proof asset:** before/afters, client results
- Before/after transformations outperform everything else available to them
- Also: client result snippets with numbers, process/how-we-think content (builds authority *and* filters bad-fit leads), teardowns of other brands' work (high reach, free positioning), hiring and culture content — agencies sell teams
- **Structural requirement:** an agency has two content jobs — its own, and one per client. These are separate genomes under one account with strict asset isolation. This is what the Agency Portal must actually solve. See §9.

### Local business
- **Proof asset:** physical space, craft, staff
- Craft and process footage is the entire game — the food plated, the fade finished, the engine coming apart
- Also: staff personality (people buy from people locally), offer/urgency posts, atmosphere, customer reaction moments, neighbourhood and seasonal context
- **Almost entirely Direct + Finish.** An avatar will not save a barbershop. If we cannot run the capture loop, we should not sell to this segment.

### Freelancer (e.g. web designer)
- **Proof asset:** portfolio, process, judgment
- Quasi-influencer: avatar and voice apply fully, but tethered to **work artifacts**, not lifestyle
- Portfolio-in-motion with narration, process breakdowns, strong opinions (referrals follow personality), client wins, and — counterintuitively — teaching the thing they get paid to do
- Availability posts ("two slots open in September") convert far better than most expect. Schedule them deliberately.

### E-commerce
- **Proof asset:** product in use, results
- Product-in-use, UGC-style reviews, founder story, problem→solution demos, drops and restocks
- Mixed mode: Assemble existing product photography, Synthesize AI-UGC variations, Direct for genuine usage footage

### Creator / influencer
- **Proof asset:** face, voice, opinions
- Fully Synthesize-eligible. This is the straightforward case and should not drive the architecture.

---

## 9. Agency multi-tenancy

- One `workspace` per agency. One `genome` per managed client, plus one for the agency itself.
- Asset Graph queries are **hard-scoped by genome_id**. A client's assets must never surface in another client's generation, including via embedding retrieval. Enforce in the query layer with a mandatory scope predicate — not a UI filter.
- Playbook resolution, mix weights, and the learning loop all run per client genome.
- Agency-level rollup reporting reads across genomes; generation never does.
- Approval mode is set per client (some clients demand review, others autopublish).

---

## 10. Guardrail layer

Every generated draft passes these checks before it can be scheduled.

| Guardrail | Rule |
|---|---|
| **Claim grounding** | Any factual claim about a product, price, result, or feature must trace to a `knowledge` or `social_proof` asset. Ungrounded specifics are stripped or the draft is rejected. |
| **Compliance profile** | `health` / `finance` / `legal` / `regulated_other` genomes carry forbidden-phrase lists and required disclaimers. Block on violation. Do not ship these verticals without this in place — we would be generating liability for customers at scale. |
| **Brand voice** | Banned phrases from genome; tone vector distance check against approved samples. |
| **Avatar saturation** | Cap avatar-mode output as a percentage of total. If every SparkSocial account leans on avatar video, accounts converge on an identical look and platforms suppress the pattern. `avatar_enabled` defaults to **false** for any genome whose `proof_asset` is not `person`. |
| **Duplicate / repetition** | Semantic similarity check against the trailing 90 days of that genome's published posts. Also enforce asset reuse cooldown. |
| **Platform policy** | Per-platform length, hashtag, link, and disclosure rules. AI-generated media disclosure where the platform requires it. |
| **Rights** | Music licensing, UGC permissions, client-asset scope, likeness consent for cloning (store explicit consent record with timestamp and scope). |

---

## 11. Build order

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 — Foundation** | Genome schema + 5-question onboarding + inference pass. Asset Library extended with roles, captioning, embeddings, retrieval API. | A genome can be produced from a URL in under 3 minutes and assets are retrievable by intent. |
| **P1 — Two modes + capture loop** | Playbook library (~15 records), resolver, Assemble pipeline, **Direct + Finish end to end via WhatsApp**, Finish pipeline (trim/caption/hook/export), default mix weights, guardrails v1. | One real local business runs a full month on capture briefs alone, and stays. |
| **P2 — Synthesize + campaigns** | Avatar/voice clone integration, generative video/image, full 30-playbook library, campaign-as-outcome unit, gap detection surfaced conversationally. | Campaign objective in → 30-day calendar out, across all three modes. |
| **P3 — Learning + agency** | Performance ingestion, Thompson sampling reweighting, exploration floor, agency multi-genome + isolation, per-client rollups. | `genome.learned.confidence > 0.4` for cohort; measurable lift over cold-start defaults. |

**Do not reorder P1.** The capture loop is the differentiator and it is the piece most likely to be technically underestimated. If it slips to P3 we ship the same product as everyone else.

---

## 12. Open decisions

1. **Avatar/voice vendor** — build vs. HeyGen/Synthesia/ElevenLabs. Consent records and likeness rights must be first-class regardless of choice.
2. **Finish pipeline compute** — server-side FFmpeg workers vs. managed video API. Cost per finished post at scale is the deciding factor; model it before committing.
3. **Capture channel priority** — WhatsApp first (matches Iyobo infrastructure and the Nigerian SMB motion) vs. in-app camera. Recommend WhatsApp first.
4. **Attribution depth** — how far do we chase conversion data for the learning loop? Reach/engagement is easy; bookings and trials require customer-side instrumentation. Decide the v1 signal set before building the sampler.
5. **Compliance vertical policy** — do we sell into health/finance/legal at launch, or gate them until §10 guardrails are proven?
6. **Playbook authoring** — internal-only, or eventually customer/agency-authored? Affects whether playbook records need a versioning and review workflow now.

---

## 13. What "done" looks like

A Lagos barbershop, a Toronto B2B SaaS, and a solo web designer in Manila each connect an account, answer five questions, and receive a month of content that a competent human marketer would recognise as *correct for that business* — different formats, different ratios, different production modes — without anyone at Tronweb having authored a rule for barbershops, sales-enablement software, or freelance web design.

That is the engine. Everything else is surface.
