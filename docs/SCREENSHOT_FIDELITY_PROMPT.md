# Task: rebuild `apps/web` screens to match the supplied UI screenshots

## 0. What is authoritative

The screenshots in `ui_screenshot` are the **design source of truth** for every
screen they depict. They supersede:

- the `.dc.html` files in `ui build/` (previously authoritative per `CLAUDE.md`)
- `ui build/BUILD_PLAN.md` prose
- `ui build/figma-system/fig-tokens.css` (already declared dead)
- whatever is currently rendered in `apps/web`

Where a screenshot and existing code disagree, **the screenshot wins and the code
changes.** Where a screenshot is silent — a state it does not show, such as hover,
focus, empty, error, or loading — keep the existing implementation and the existing
token vocabulary. Do not invent a new visual language to fill the gap.

Update the "design source of truth" line in `CLAUDE.md` to point at the screenshot
folder as part of this work, so the next session does not rebuild against `ui build/`.

## 1. The token rule — read before writing any CSS

`apps/web/src/styles/tokens.css` already defines the design system: a raw ramp
(`--ss-ink-900`, `--ss-surface-150`, and so on), a semantic layer over it (`--ss-fg`,
`--ss-canvas`, `--ss-primary`), gradients, shadows, shell geometry, and a `.dark` block
that re-points the semantic layer only. `apps/web/tailwind.config.ts` maps every
Tailwind colour onto those variables through a `color-mix()` `alpha()` helper, and
**contains no hex values by design.**

Non-negotiable rules:

1. **Components consume the semantic layer only** — `bg-canvas`, `text-ink-muted`,
   `border-border`. A raw `--ss-ink-500` or a literal `#0c0c0c` in a `.tsx` file is a
   defect: it breaks the light/dark swap, which must stay a single class toggle.
2. **New colour from a screenshot means a new raw token plus a new semantic token**,
   then use the semantic one. Never inline the hex at the call site, even once.
3. **Every colour added to `tailwind.config.ts` goes through `alpha()`.** A bare
   `var(--x)` silently resolves to *transparent* under an opacity modifier such as
   `bg-warn/10`. This bug was live in this repo for a long time precisely because it
   fails open. The comment block at the top of that file explains it — read it.
4. **Extend, do not replace.** Do not create a second tokens file, a `theme.ts`, a
   styled-components theme, or CSS Modules. One file, additive edits, and keep the
   existing comments explaining why each value exists.
5. Radii, shadows, fonts, spacing and animations are already tokenised: `rounded-lg` is
   15px, plus `shadow-hairline`, `font-display`, `spacing.rail`, `--ss-nav-pitch`.
   Reuse the scale. If a screenshot needs a value the scale lacks, add it to the scale
   rather than reaching for an arbitrary `rounded-[13px]`.

There are currently **44 hardcoded hex values across `apps/web/src` `.tsx` files**.
Every one you touch while working on a screen must be converted to a token. Report the
remaining count when you finish.

## 2. Establish scale before measuring anything

Screenshots are not 1:1 with CSS pixels — they may be captured at 1x, 2x, or under
browser zoom. Before reading a single dimension:

1. Find one element whose intended CSS size is already known from code: the 322px rail
   (`--ss-rail`), the 65px nav pitch, a 40px avatar.
2. Measure it in the screenshot's pixels.
3. Derive the scale factor, state it explicitly in your notes, and divide every
   subsequent measurement by it.
4. If a screenshot's scale cannot be resolved this way, say so and ask rather than
   guessing. A wrong scale factor makes every number in that screen wrong by the same
   ratio, which is the hardest class of error to notice later.

Round to the token scale, not to the raw measurement. If you measure 14.6px of padding
and the scale uses 16, use 16 and note the delta. If you measure 27px where nothing on
the scale is close, that is a real value — add it.

## 3. Workflow — per screen, not in bulk

Do not batch-edit many screens and then verify at the end. Take one screen all the way
through, then start the next.

**Step A — inventory.** List every screenshot and map it to the route or component it
depicts (`apps/web/src/app/(app)/.../page.tsx`, `src/components/...`). Where a
screenshot has no corresponding screen, or a screen has no screenshot, list it
explicitly under "unmatched" and stop to ask before creating new routes.

**Step B — read the screenshot properly.** For each one, write down, before touching
code: layout structure (grid or flex, columns, gaps), every distinct colour with its
role, type sizes and weights and line heights, border radii, borders versus shadows,
icon sizes, the component states visible, and the exact copy text. Text in the
screenshot is content — transcribe it, do not paraphrase it.

**Step C — token diff.** Compare the colours and dimensions you extracted against
`tokens.css`. Produce a short list under three headings: *reuse as-is*, *near-miss*
(within about 2 percent — reuse the existing token and say so), and *genuinely new*
(add it). Apply the token additions in one edit before writing component code, so
components are never written against literals "temporarily".

**Step D — build.** Edit the existing components. Prefer modifying what is there over
replacing files, so the surrounding conventions, imports, and data-fetching survive.

**Step E — verify in the browser, visually.** This is the step that makes it match.
Start the dev server through the preview tools, navigate to the screen, take a
screenshot, and compare it against the reference side by side. Then use
`javascript_tool` to read *computed* styles for the values you care about —
`getComputedStyle(el).padding`, `backgroundColor`, `fontSize`, `borderRadius` — and
confirm they equal the intended token values, resolved. A token that looks correct in
the CSS but computes to `rgba(0, 0, 0, 0)` is the exact failure mode rule 1.3 warns
about. Check both light and dark by toggling the `.dark` class, and check the mobile
width with `resize_window`.

Iterate B through E until the rendered screen and the screenshot agree. Do not declare
a screen done off a code diff alone.

## 4. Architectural constraints you must not break

These come from `CLAUDE.md` and are load-bearing. This is a visual task; none of them
should need to change.

- **`apps/web` imports `@sparksocial/shared` and nothing else from `packages/`.**
  Importing `@sparksocial/db` fails the build via
  `packages/db/test/isolation.test.ts`, which walks `.tsx` files.
- **Every capability is reached over HTTP through `POST /v1/tools/:name`.** No new
  domain logic in components.
- **Exactly two route handlers exist under `src/app/api/`, both transport proxies.**
  Do not add a third.
- **`apps/web/tsconfig.json` is deliberately separate** from the root config. Leave it
  alone — `next dev` rewrites whatever config it is pointed at.
- TypeScript strict, no `any`.

If matching a screenshot appears to require violating one of these, stop and report it
rather than working around it. That is a design/architecture conflict for a human to
resolve.

## 5. Definition of done, per screen

1. The rendered screen matches the reference screenshot in layout, colour, type,
   spacing, and radii — verified by browser screenshot comparison, not by reading code.
2. Zero hardcoded colour literals in the touched files; all colour flows through
   semantic tokens.
3. New tokens added to `tokens.css` with a one-line comment saying what they are for,
   and wired into `tailwind.config.ts` through `alpha()` if they are colours.
4. Light and dark both render correctly. Dark inherits through the semantic layer — you
   should not be adding `dark:` variants to components.
5. Responsive at the widths the screenshots imply, with mobile checked.
6. `npx tsc --noEmit` clean for `apps/web`, and the repo's lint and build pass.
7. No new files under `src/app/api/`, and no new `packages/` imports.

## 6. Anti-patterns — the ways this task usually goes wrong

- Eyeballing a colour as "close enough to black" and using `#000` where the design is
  `#0C0C0C`. Sample the pixel.
- Adding `dark:bg-...` variants to components instead of letting the semantic layer
  swap.
- Building a parallel token system because the existing one seemed inconvenient.
- Arbitrary values such as `p-[13px]` or `text-[15.5px]` scattered through components
  instead of extending the scale once.
- Declaring done after the diff looks right, without rendering it.
- Silently skipping a screenshot that was hard to interpret. Name it as unresolved.
- Rewriting a component wholesale and losing its data wiring, loading states, or
  accessibility attributes in the process.

## 7. What to report back

- The screenshot-to-screen mapping, including unmatched items in both directions.
- The scale factor you derived, and how.
- Tokens added, with values and rationale; tokens reused as near-misses, with the delta.
- Per screen: done, partial, or blocked — and for anything not fully matching, the
  specific discrepancy that remains.
- The remaining hardcoded-hex count in `apps/web/src`, down from 44.
- Any screenshot that appeared internally inconsistent or that conflicted with another.

Ask before creating new routes, deleting existing screens, changing anything in section
4, or resolving a conflict between two screenshots.
