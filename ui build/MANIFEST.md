# `ui build/` — prototype manifest

Tracks, per screen, what the prototype is built from and whether it is ready to hand to
Claude Code. Read `STATUS` before touching an artboard.

**Status values**

| Status | Meaning |
| --- | --- |
| `figma-verified` | Artboard reconciled against a Figma capture. Ready for handoff. |
| `stale` | Artboard exists but predates the Figma design. A capture exists — needs reconciling. |
| `awaiting-capture` | Artboard exists, no Figma reference. **Do not redesign.** |
| `handed-off` | Given to Claude Code. Any later change needs a re-handoff note. |

**Reference folder:** `ui_screenshot/` — 36 Figma preview captures, read 2026-09-01.
**Frame width:** 1440. Captures are preview panes at varying zoom; scale per capture is
`frame width / 1440`, detected from the chrome colour (see §4).

---

## 1. Screen inventory

### Auth — 8 captures

| Capture | Figma frame | Artboard | Status |
| --- | --- | --- | --- |
| `login.png` | Login | `SparkSocial Auth` | `stale` |
| `signup.png` | Sign Up | `SparkSocial Auth` | `stale` |
| `…192520` | Forgot password — enter email | `SparkSocial Auth` | `stale` |
| `…192539` | Forgot password — new password | — (none) | `stale` |
| `…192600` | Confirmation Successful (light) | — (none) | `stale` |
| `…192630` | Confirm account — verification code (dark) | — (none) | `stale` |
| `…192654` | Confirmation Successful (dark) | — (none) | `stale` |
| `…192715` | Splash — Meet Spark | — (none) | `stale` |

### Onboarding — 9 captures

| Capture | Figma frame | Content | Status |
| --- | --- | --- | --- |
| `…192918` | Onboarding screen Step 5 | Step 1 of 4 — brand name | `stale` ⚠ name/content conflict |
| `…192946` | — | Step 1 of 4 — about, niche, logo | `stale` |
| `…193027` | — | Step 2 of 4 — company URL | ✗ superseded by `…193114` |
| `…193114` | — | Step 2 of 4 — company URL | `stale` |
| `…193059` | — | Step 2 of 4 — upload docs (PDF) | `stale` |
| `…193155` | — | Step 3 of 4 — brand kit, voice, timezone, compliance | `stale` |
| `…193231` | — | Step 4 of 4 — agent name, avatar, voice (+ dark strip) | `stale` |
| `…193247` | — | Congratulations — first agent created | `stale` |
| `…193306` | Steps completed Spalsh screen | Gradient wash only | `stale` |

All map to `SparkSocial Onboarding`. **Onboarding is 4 steps.**

### Dashboard / Agents — 4 captures

| Capture | Figma frame | Artboard | Status |
| --- | --- | --- | --- |
| `…193356` | Dashboard | `SparkSocial Dashboard` | `stale` |
| `…193457` | Dashboard | `SparkSocial Dashboard` | `stale` — narrower breakpoint, not a scale error |
| `…193557` | Dashboard Empty State | — (none) | `stale` |
| `…193617` | Create Campaign Popup | — (none) | `stale` |

### Create Campaign — 6 captures

Frames `Create Campaign Step 1`–`Step 6` → `SparkSocial Create Campaign`, all `stale`.
**Create Campaign is 6 steps:** goal · type · offer details · social accounts ·
autonomy & responsibility · review & activate.

### Workspace — 2 captures

| Capture | Figma frame | Artboard | Status |
| --- | --- | --- | --- |
| `…194151` | Workspace Settings | — | ✗ unusable, 285px wide — recapture |
| `…194218` | Workspace Settings | `Settings WS Overview`? | `stale` — workspaces list only |

### Account / Personal Settings — 7 captures

| Capture | Tab | Artboard | Status |
| --- | --- | --- | --- |
| `…194951` | Profile | `Settings PS Profile` | `stale` |
| `…195010` | Password & Security | `Settings PS Password` | `stale` |
| `…195031` | Notifications | `Settings PS Notifications` | `stale` |
| `…195046` | Connected Accounts | `Settings PS Connected` | `stale` |
| `…195110` | Accessibility & Editor | `Settings PS Accessibility` | `stale` |
| `…195131` | Keyboard shortcuts (modal) | — (none) | `stale` |
| `…195204` | Privacy | `Settings PS Privacy` | `stale` |

All six PS tabs have references.

---

## 2. `awaiting-capture` — no Figma reference, do not redesign

`SparkSocial Command Center` · `SparkSocial Calendar` · `SparkSocial Assets Library` ·
`SparkSocial Discovery` · `SparkSocial Automation` · `SparkSocial Agency Portal` ·
`SparkSocial Draft Panel` + the 21 `DP *` artboards · `Spark Chat` ·
`SparkSocial Account Home` · `SparkSocial Settings` · the 17 `Settings WS *` artboards
(only the workspaces list is referenced).

**39 of 61 artboards have no Figma reference.**

---

## 3. IA divergence — prototype vs Figma

Decision recorded 2026-09-01: **Figma wins.**

1. **Nav is `Agents`, not `Command Center`.** Order: Agents · Discovery · Calendar ·
   Automation Recipes · Engagement Intelligence · Assets Library · Settings.
2. **There is no Dashboard nav item, and no separate Dashboard screen.** The frame
   named `Dashboard` has `Agents` as its active nav item — Dashboard *is* the Agents
   screen. The onboarding CTA "Continue to Dashboard" lands there. Resolved, not a
   conflict.
3. **Command Center survives as a button**, in the agent hero card on the Agents
   screen — not as navigation.
4. **Two shells, not one.**
   - *Brand shell*: left sidebar, logo top, plan + credits footer ("Pro Plan · 1,200
     credits").
   - *Account shell*: no sidebar. Top bar with Account Settings · Agency Portal ·
     notifications · user menu. Used by Workspaces and Settings.
5. **Rail is ~246–250px, not the 322px in `--ss-rail`.** Measured on `…193356`.
   Needs confirming at final scale before the token changes.
6. **Settings has a `Workspace Settings` / `Personal Settings` segmented toggle** plus
   its own left sub-nav — a third navigation level the prototype does not model.

---

## 4. Scale method

The 322px rail and 65px nav pitch **do not calibrate these captures** — the Figma
sidebar is a different component at a different width. Captures are preview panes at
several zooms (906–1250px for the same layout), so there is no global factor.

Detect the design frame inside the window chrome, keyed on the chrome's sampled colour
rather than a luminance threshold (a threshold reads a dark capture's card as the frame).
Then `scale = frame width / 1440`, per capture.

Validated: the same onboarding element in two captures 12.6% apart in zoom measured
**123.4 and 123.6 CSS px** — 0.2%. Well inside the round-to-token-scale rule.

---

## 5. Capture defects — fix at source, do not copy into code

**Typos in the design.** Build the artboards with correct spelling and note the
divergence here; do not propagate.

| In Figma | Correct |
| --- | --- |
| `Noifitcations` (all 6 PS tabs) | Notifications |
| `Email Adderess` | Email Address |
| `Sava Changes` | Save Changes |
| `Spalsh screen` (frame name) | Splash screen |
| `Intagram` (campaign step 4) | Instagram |
| `Sales Assits` | Sales Assists |
| `Agent Voice (for meida)` | for media |

**Capture problems**

- `…194151` — 285px wide. Unusable. Recapture at full zoom.
- `…193027` — Teams notification overlapping bottom-right, no frame chrome. Superseded
  by `…193114`; keep for nothing.
- `…192918` — frame named "Step 5", content reads "Step 1 of 4". Content is likelier
  correct given the other captures, but confirm.

---

## 6. Token changelog

Nothing changed yet. Every entry must record old value, new value, and which
`awaiting-capture` screens consume the token.

| Date | Token | Old | New | Affects | Why |
| --- | --- | --- | --- | --- | --- |
| 2026-09-01 | `--ss-auth-card` | *(new)* | `448px` | auth only | Card measures 447.9 in `login.png`; was a 540px literal in `AuthCard.tsx`. |
| 2026-09-01 | `--ss-auth-glass` | *(new)* | `472px` | auth only | Frosted panel; was a 568px literal in `GlassCard.tsx`. |
| 2026-09-01 | `--ss-auth-glass-pad` | *(new)* | `12px` | auth only | (472 − 448) / 2, measured 11.5 / 13.5 either side. |
| 2026-09-01 | `--ss-auth-gutter` | *(new)* | `36px` | auth only | Card padding-x; identical on both sides of the field stack. |
| 2026-09-01 | `--ss-auth-control` | *(new)* | `56px` | auth only | Field and button height; both measure 56 at centre. |

**Redefined (not added) — the reviewable set:**

| Date | What | Old | New | Blast radius | Verified |
| --- | --- | --- | --- | --- | --- |
| 2026-09-01 | `button` `size="cta"` | `h-[69px] rounded-xl text-[22px]` | `h-56px rounded-lg text-[17px]` | 5 files, **all auth** (`sign-in`, `sign-up`, `sign-up/verify`, `forgot-password`, `OrgGuard`) | `grep` — no non-auth caller exists |
| 2026-09-01 | `AuthField` label | `18px` `ink-muted` | `13px` `ink` | auth only | component is auth-scoped |

`Input` was **not** redefined. It is imported by 29 files, most of them
`awaiting-capture`, so the 56px auth field is an additive `fieldSize="auth"`
prop with the 69px prototype height still the default.

**No colour token was added or changed.** The sky samples `#6CE8FF` (`--ss-cyan`),
the field fill `#F3F4F8` (`--ss-field-bg`) and the button `#0C0C0C`
(`--ss-ink-900`) — all three already in the ramp, all three exact. The prototype
and the Figma file disagree on *geometry*, not palette.

**Pending, not yet applied:** `--ss-rail` 322px → ~250px. High impact: consumed by every
brand-shell screen including all `awaiting-capture` ones. Do not apply until the final
measurement is confirmed and the affected artboards are ready to move together.

---

## 6.1 Asset provenance

Login now uses the **Figma exports** from `ui build/assets/login assets/`, copied
into `apps/web/public/auth/`. The earlier approximations from `ui build/assets/`
(`clientfinder-woman.png`, `post-genstars.png`, `ws-avatar-*.jpg`,
`agent-memoji.png`) are deleted — they were placeholders, not the design.

| Export | In repo | Role |
| --- | --- | --- |
| `image 30.svg` | `login-sky.svg` | Sky **photograph**, 1727×1117 |
| `Login Form.svg` | `login-float-campaign.svg` | "Active Agent Campaign", 205×216 |
| `Login Form (1).svg` | `login-float-ideation.svg` | "Autonomous Content ideation", 182×249 |
| `Group 96.svg` | `login-float-avatars.svg` | Avatar stack "+5", 198×67 |
| `Frame (1).svg` | `login-card-halftone.svg` | Card halftone dots, 540×123 |

**The sky is a photograph, not a gradient.** It composites over flat `--ss-cyan`
with a vertical fade. Solving `capture = cyan·(1−a) + photo·a` against the capture
gives a ≈ 0.00 at y=20, ≈0.3 at y=300, ≈0.7 at y=500, ≈0.95 at y=900 — so cyan
owns the top of the frame and the clouds only emerge near the base. That is why
sampling the capture's top corners returns `#6CE8FF` exactly.

**Two exports need their frosted panel restored in CSS.** Chrome renders
SVG-in-`<img>` in a restricted static mode that skips `foreignObject`, and both
`Login Form` exports keep their frosted fill in a `foreignObject` carrying
`backdrop-filter`. Without compensation those cards render as bare photo +
caption. The panel insets are taken from each export's own
`bgblur_0_*_clip_path`, not estimated. `Group 96.svg` needs nothing — it states
its panel as a plain `fill-opacity="0.25"` rect.

**Still not from an export:** the "Overall Performance 565" gauge (lower-left
floater) has no asset in the folder and remains hand-built. Export it if exact
fidelity there matters.

**Not swapped, deliberately:** the Spark mark. `Group 1000016141.svg` (91×91)
uses `#F56BFF` / `#A341FF` / `#6CE8FF` — exactly `SparkMark`'s own constants — so
the existing CSS component is a faithful reimplementation, and the capture's mark
measures a ~40×42px core with glow to ~63px, which agrees with `size={48}`.
Swapping one screen to a static SVG would fork the brand mark into two
implementations free to drift.

## 7. Handoff log

Handoff is **per flow**, not per screen. A flow goes when every screen in it is
`figma-verified`. Each entry names the flow, the artboards, and the token delta since
the previous handoff.

| Date | Flow | Artboards | Token delta |
| --- | --- | --- | --- |
| — | — | — | — |

**Suggested order** — auth is the most completely referenced flow and has the fewest
shared dependencies:

1. Auth (8 captures, complete)
2. Onboarding (9 captures, complete)
3. Personal Settings (7 captures, all 6 tabs)
4. Agents/Dashboard + Create Campaign (10 captures — share the brand shell, so they
   move together)
5. Workspaces — blocked on recapturing `…194151`
