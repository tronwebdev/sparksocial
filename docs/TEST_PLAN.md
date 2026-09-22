# SparkSocial — Test Plan

One page of cases. Each one names the goal it proves, one thing to do, and one
result to look for. Work top to bottom and mark each row.

**Goals under test** are PRD §5's six: **G1** autonomous publishing · **G2**
configurable oversight · **G3** trend-driven growth · **G4** automation at scale ·
**G5** engagement intelligence · **G6** governance everywhere.

**Personas** are PRD §3: **A** solo SMB owner · **B** agency operator ·
**C** creator/coach · **D** sales-driven brand.

---

## Before you start

| | |
|---|---|
| API | `http://localhost:8080/health` returns `status: ok` |
| Web | `http://localhost:3000` loads the sign-in page |
| Migrations | `npm run migrate -w @sparksocial/db` has been run |
| Brand | At least one brand exists, or TC-01 creates it |
| Test data | `docs/TEST_BUSINESSES.md` — three businesses with answers ready to paste |

**Accounts you can connect today:** X, TikTok, LinkedIn, YouTube, Google Business
(OAuth), and Bluesky (handle + app password, no setup needed). Instagram,
Facebook, Threads, Pinterest and Reddit are not configured — see
`docs/VENDOR_SETUP.pdf`. Don't log those as failures.

---

## A. Setup and publishing — G1

| ID | User story | Do this | Expect |
|---|---|---|---|
| **TC-01** | *(A)* As an owner I can set my brand up fast | Sign in → onboarding → answer the five questions using a business from `TEST_BUSINESSES.md` | Brand is created and you land in the app, not back at onboarding |
| **TC-02** | *(A)* I can connect somewhere to publish | Settings → Account Connection → connect **Bluesky** (handle + app password) | Tile shows connected, with **your** account name and picture — not "Bluesky" |
| **TC-03** | *(A)* I can connect an OAuth account | Connect **X**, **TikTok** or **YouTube** | Consent screen appears, asks which account, returns connected |
| **TC-04** | *(A)* I get a month of content without planning it | Create a campaign → pick an objective → confirm | Campaign is created and the calendar has posts on it |
| **TC-05** | *(A)* Posts go out on their own | Open a scheduled post → Publish now | Post appears on the platform; the item shows a receipt and a link |
| **TC-06** | *(A)* A failed post tells me why | Disconnect the account, then publish another post | Item shows a readable reason, not a silent failure |

## B. Oversight — G2

| ID | User story | Do this | Expect |
|---|---|---|---|
| **TC-07** | *(B)* Nothing publishes without me when I say so | Settings → set approval mode to **review** → publish a post | Post is **held**, not published, and says it is waiting for review |
| **TC-08** | *(B)* I can approve and it goes | Approve the held post | It publishes, and the receipt appears |
| **TC-09** | *(B)* Autonomy is per campaign, not global | Create a post with no campaign → try to publish | Held for review regardless of mode |

## C. Discovery and repurposing — G3

| ID | User story | Do this | Expect |
|---|---|---|---|
| **TC-10** | *(C)* I can see what's worth posting about | Open Discovery | Trends listed, each with a score and a **why** |
| **TC-11** | *(C)* Off-brand trends don't clutter it | Read the list against your brand | Nothing wildly unrelated to the business appears |
| **TC-12** | *(C)* I can turn a trend into a post | Pick a trend → Repurpose | A draft is created, in your brand's voice, about that trend |
| **TC-13** | *(C)* Sources are honest about themselves | Discovery → source rail | Unconnected sources say *why* and name the variable to set |

## D. Automation — G4

| ID | User story | Do this | Expect |
|---|---|---|---|
| **TC-14** | *(B)* I can set content to keep producing itself | Automation → new recipe → **auto trend** → add 2–3 keywords → save | Recipe saves and appears as active |
| **TC-15** | *(B)* I can see what it produced | Run the recipe | Output appears in the queue, or a message saying why nothing matched |
| **TC-16** | *(B)* I can stop it | Pause the recipe | Status changes to paused, no new output |

## E. Engagement — G5

| ID | User story | Do this | Expect |
|---|---|---|---|
| **TC-17** | *(D)* Replies are drafted for me | Engagement → open a comment or DM → draft a reply | A reply in the brand's voice, not a generic one |
| **TC-18** | *(D)* I see who's ready to buy | Engagement → sales opportunities | Intent-scored items with a recommended next action |
| **TC-19** | *(D)* Nothing is sent behind my back | Check a drafted reply before approving | It is not sent until you approve it |

## F. Governance — G6

| ID | User story | Do this | Expect |
|---|---|---|---|
| **TC-20** | *(B)* My banned words never appear | Brand Kits → Enable Strict Compliance → add a banned word → generate a draft | The word does not appear; if it does, the post is blocked or flagged |
| **TC-21** | *(B)* My colours and type are used | Brand Kits → set colours and fonts → generate an image post | Rendered image uses them: first colour ground, second the text |
| **TC-22** | *(A)* Posts carry hashtags | Generate a draft for X or LinkedIn | Draft ends with hashtags, specific to the post — not `#smallbusiness` filler |
| **TC-23** | *(A)* Hashtags never break a platform | Generate a draft for an **X** playbook | At most **2** hashtags, and publishing is not blocked for having too many |
| **TC-24** | *(A)* I'm told what's missing *before* I commit | Create a campaign on a brand with no assets | A checklist appears **before** creation, splitting blockers from warnings |
| **TC-25** | *(A)* A watermark is my choice | Brand Kits → Watermark → turn it off → render an image | No logo stamped on the image |

---

## Results

| ID | Pass / Fail / Blocked | Note |
|---|---|---|
| TC-01 | | |
| TC-02 | | |
| TC-03 | | |
| TC-04 | | |
| TC-05 | | |
| TC-06 | | |
| TC-07 | | |
| TC-08 | | |
| TC-09 | | |
| TC-10 | | |
| TC-11 | | |
| TC-12 | | |
| TC-13 | | |
| TC-14 | | |
| TC-15 | | |
| TC-16 | | |
| TC-17 | | |
| TC-18 | | |
| TC-19 | | |
| TC-20 | | |
| TC-21 | | |
| TC-22 | | |
| TC-23 | | |
| TC-24 | | |
| TC-25 | | |

---

## Known limits — do not log these as failures

| Thing | Why |
|---|---|
| Instagram, Facebook, Threads, Pinterest, Reddit won't connect | No app credentials set. `docs/VENDOR_SETUP.pdf` |
| LinkedIn publishing may be refused | Platform approval is still pending; the connection itself works |
| Only 4 of 8 trend sources are live | YouTube, Hacker News, Product Hunt, Google Trends. Reddit/X/TikTok/Pinterest need keys |
| Brand kit **Versioning** tab says "Not built" | Correct — nothing in the product records a brand-kit version yet |
| Copy is written by the OpenAI fallback | The Anthropic org is disabled. Quality differs slightly; it is not a failure |
| Aggregator publishing is off | `AYRSHARE_API_KEY` is unset; native adapters are in use |

---

## If a case fails

Record the **ID**, what you saw, and the browser console output. For a publish
failure the item itself carries the reason — copy that rather than "it didn't
work". Server-side detail is in the API terminal.
