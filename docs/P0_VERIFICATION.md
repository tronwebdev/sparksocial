# P0 verification — 8 Aug 2026

Master plan §12's P0 exit criterion is *"token-accurate shell matching prototype
side-by-side; all approval tracks filed."* This records the first half. The second
half — Meta/LinkedIn/Google/TikTok approval filings — is business work, tracked in
`STATUS.md`, not verifiable here.

## Method

The prototype scales a fixed 1728px stage by `Math.min(1, vw/1728)`. At a viewport
of exactly **1728px wide** that factor is 1.0, so it renders at true Figma
coordinates and every measurement below is a 1:1 comparison rather than a
comparison against a scaled bitmap. Values were read with
`getBoundingClientRect()` / `getComputedStyle()` in the browser, not estimated
from screenshots.

Sources: `ui build/SparkSocial Dashboard.dc.html` (shell) and
`ui build/SparkSocial Auth.dc.html` (auth).

## Shell

| # | Check | Expected | Measured | |
|---|---|---|---|---|
| 1 | Sidebar rail width | 322px | 322px | pass |
| 2 | Nav row count | 7 | 7 | pass |
| 3 | Nav row tops | 132 / 197.9 / 262.9 / 327.9 / 392.9 / 457.9 / 522.9 | 132 / 197 / 262 / 327 / 392 / 457 / 522 | pass (≤0.9px; the prototype's first gap is 65.9 and the rest 65 — a design-tool rounding artefact, reproduced as a uniform 65px pitch) |
| 4 | "Engagement Intelligence" label size | 17px (others 18px) | 17px, others 18px | pass |
| 5 | Active glow geometry | ~278–296 × 50, radius 10 | 282 × 50, radius 10px | pass |
| 6 | Active glow gradient stops | 0% / 32.85% / 100% | `linear-gradient(90deg, rgba(108,232,255,.4) 0%, rgba(148,238,255,.4) 32.85%, rgba(255,255,255,0) 100%)` | pass |
| 7 | Glow slides on nav change | translateY = index × 65 | `/calendar` (index 2) → `matrix(1,0,0,1,0,130)`, 0.25s on `transform` | pass |
| 8 | Canvas card position | left 322, top 18 | left 322, top 18 | pass |
| 9 | Canvas card radius + wash | radius 30, two gradients over `#F7F7F7` | radius 30px; both gradients present; base `rgb(247,247,247)` | pass |
| 10 | Wordmark | CS Mollwish, 27.49px, line-height 1.13, `#0C0C0C` | `mollwish`, 27.49px, 31.06px (= 27.49 × 1.13), `rgb(12,12,12)` | pass |
| 11 | Real fonts loaded | Onest + CS Mollwish, not fallbacks | `document.fonts` reports `onest: loaded`, `mollwish: loaded` | pass |
| 12 | Active nav state | `#0C0C0C`, medium weight | `rgb(12,12,12)`, weight 500 | pass |

## Auth

| # | Check | Expected | Measured | |
|---|---|---|---|---|
| 13 | Sign Up brand panel width | 938px at 1728 viewport | 938px | pass |
| 14 | Sign Up card | 540 wide, radius 38 | 540, 38px | pass |
| 15 | Hero titles | 48.5 / 39.2px in CS Mollwish | 48.5px / 39.2px, `mollwish` | pass |
| 16 | Card heading | 26px / 600 / `#043133` | 26px, 600, `rgb(4,49,51)` | pass |
| 17 | Sign In sky | `#6CE8FF` | `rgb(108,232,255)` | pass |
| 18 | Glass card | 568 wide, radius 40 outer / 38 inner, `blur(30px)` | 568, 40px / 38px, `blur(30px)` | pass |
| 19 | Login wordmark | 37.5px | 37.5px | pass |
| 20 | Fields | 69px tall, radius 15, `#F3F4F8`, 18px text | 69px, 15px, `rgb(243,244,248)`, 18px | pass |
| 21 | Social providers | Google, Facebook, X | all three present | pass |
| 22 | Protected route redirect | lands on our `/sign-in`, not Clerk's hosted page | `/sign-in?redirect_url=…`, heading "Welcome back" | pass |

### Not confirmed visually

**Field focus ring (`1.5px solid var(--ss-ring)` at `:focus-within`).** The CSS is
present and provably the only rule matching the element, and `var(--ss-ring)`
resolves to `#a341ff` in a direct probe. But this browser's `getComputedStyle`
does not reflect `:focus-within`-dependent values — it reported the same for
`box-shadow`, `ring-*` and `outline-*` alike, while an `!important` probe on the
same selector *did* apply. It also rounds sub-pixel outline widths (1.5px → 1px).
**Needs a look in a real browser before P0 is called done.** It is the only item
here not confirmed by measurement.

That investigation did surface two genuine bugs, both fixed: Tailwind's
`shadow-[…]` and `ring-*` utilities compose through `--tw-shadow` /
`--tw-ring-shadow` into a three-part `box-shadow`, and neither survived
composition on this element — the focus ring is now a plain CSS rule
(`.ss-field:focus-within` in `tokens.css`) with explicit longhands and no var
indirection.

## Security

Genome isolation moved from a forgeable header to a verified session. Covered by
19 tests in `apps/api/test/clerk-auth.test.ts`, all passing:

| Attack / case | Expected | |
|---|---|---|
| No session | `FORBIDDEN` → 401 | pass |
| Session with no active org | `FORBIDDEN` | pass |
| `x-org-id` / `x-user-id` headers set | ignored; org and user come from claims | pass |
| `x-genome-id` naming another org's genome | `ISOLATION_VIOLATION` → 403 | pass |
| `x-genome-id` naming a non-existent genome | same error as out-of-scope — no existence oracle | pass |
| `x-brand-id: brand_EVIL` alongside a valid genome | ignored; `brandId` derived from the verified row | pass |
| `x-role: owner` from the browser | ignored; role from `org_role` claim | pass |
| Unknown / missing `org_role` | degrades to `viewer`, never `owner` | pass |
| `x-caller: agent` from the browser | `caller` stays `'user'` | pass |
| Construction without `authorizedParties` | throws at startup | pass |
| `authorizedParties` reaches Clerk | asserted on the call | pass |

**Mutation-tested**, not just asserted:

- Removing the `orgId` filter from `genomeRepository.listForOrg` → the pglite
  isolation test fails.
- Replacing the genome-ownership check in `clerk-auth.ts` with `if (false)` →
  exactly the two cross-org tests fail.

Storage keys are a second isolation surface, covered in
`packages/storage/test/key.test.ts`: a crafted `orgId` cannot escape its prefix, a
filename cannot inject path structure, and a key without both org and genome is
refused. Writing those tests caught a real flaw — the first sanitizer preserved
dots, turning `../../org_2` into `....org_2`.

## Suite

408 tests across 25 files, clean strict typecheck across packages + both apps,
`next build` green (17 routes + middleware).

## Known gaps leaving P0

- **Budget policy is a no-op.** Both resolvers still hand out a hardcoded
  `budget: { remainingCents: 100_000 }` and `approvalMode: 'autopublish'`. There
  are no `brands` / `autonomy_policies` tables and credits land in P3.
- **Azure Blob is unverified end-to-end.** The sandbox cannot reach Azure. The
  in-memory store covers dev and tests; the SAS signing path needs a smoke test
  from a developer machine after `infra/azure/bootstrap.sh`.
- **`apps/web` has no deployment.** A second Container App, Dockerfile and
  `deploy-azure.yml` job are out of P0 scope — the exit criterion is local
  fidelity, not a live URL.
- **Clerk dashboard configuration is required** before sign-up works end to end:
  the six custom organization roles (`org:owner` … `org:client`) matching `Role`
  in `packages/shared/src/types.ts`, and the Google / Facebook / X OAuth
  providers.
