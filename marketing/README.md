# SparkSocial — marketing site

A static marketing site. Plain HTML, CSS and vanilla JS: no build step, no
framework, no backend. Open `index.html` in a browser and it works.

```
marketing/
  index.html            the landing page
  privacy.html          privacy policy
  terms.html            terms of service
  css/style.css
  js/script.js
  assets/
    logo.svg              the product's own mark, copied from apps/web/public/brand
    favicon.svg
    fonts/                Onest (body) + CS-Mollwish (wordmark), copied from apps/web/src/fonts
```

## Running it

```bash
python -m http.server 4321 --directory marketing
```

Then open <http://localhost:4321>. There is also a `marketing` entry in
`.claude/launch.json` for the preview pane.

`file://` works too, but serving over HTTP is closer to production and avoids
font-loading differences between browsers.

## Brand

Colours, type and geometry come from the product's own tokens
(`apps/web/src/styles/tokens.css`), so the site and the app read as one thing:

| Role | Value | Where it comes from |
| --- | --- | --- |
| Primary / ink | `#0C0C0C` | `--ss-ink-900` |
| Signal (trends, momentum) | `#6CE8FF` | `--ss-cyan` |
| Intelligence (relevance, AI) | `#A341FF` | `--ss-purple` |
| Accent | `#F56BFF` | `--ss-pink` |
| Canvas | `#F7F7F7` | `--ss-surface-150` |
| Active state (tabs, pills) | `#9CEFFF` | `--ss-cyan-200` |
| Text on a cyan ground | `#043133` | `--ss-teal-900` |

Light sections carry the app's own canvas wash — a pink gradient from the top
left over a cyan one, copied angle-for-angle from `--ss-grad-canvas`. That wash
plus `--ss-cyan-200` on active states is what makes the site read as the same
product rather than merely the same palette. The capture-loop section is a full
`#6CE8FF` band, the same ground the product's sign-in screen sits on.

Body type is **Onest**; **CS Mollwish** is the display face and is used for the
wordmark and one hero phrase only — the same rule the app follows. Do not set
Mollwish on a paragraph.

The logo is the real export, not a reconstruction. If the mark ever changes,
recopy it rather than editing this one.

## What needs replacing before launch

Everything below is deliberately a placeholder. Nothing on this page invents a
customer, a statistic or a capability.

| What | Where | Notes |
| --- | --- | --- |
| **Prices** | `index.html`, `.plan__amt` | Shown as `[PRICE]` in a dashed box, with a line above the table saying they are placeholders. |
| **Customer logos** | `.trust__row` | Five "Your logo" tiles plus a caption saying they are placeholders. |
| **Testimonials** | `.stories` | Three empty cards and a "coming soon" heading. No invented quotes. |
| **Footer links** | `[data-placeholder-link]` | About, Blog, Resources, Help centre and the four social profiles point at `#` and are click-blocked. Give them real URLs and remove the attribute. |
| **Legal blanks** | `LEGAL` in `js/script.js` | Company entity, dates, retention periods, jurisdiction, refund policy and more. Every unfilled value renders in a dashed placeholder box so it cannot be mistaken for a real term. |
| **`og:image`** | `<head>` | Points at `assets/og-image.png`, which does not exist yet. Add a 1200×630 image. |
| **Canonical / OG URLs** | `<head>` | Set to `https://sparkai.social/`. Change if the domain differs. |

Contact details are **real** and live in one place — `COMPANY` at the top of
`js/script.js`:

```js
const COMPANY = {
  address: 'Plot 1 Maxwell Street, Ozuoba, Port Harcourt',
  phone: '07037122762',
  email: 'help@sparkai.social',
  mapUrl: '…',
};
```

Editing that object updates the footer, the `tel:` link and the `mailto:` link.

## Product claims

The copy was written against what the codebase actually does, not against a
wish list.

- **Trend sources** — the eight named (X, Reddit, YouTube, TikTok, Google
  Trends, Hacker News, Product Hunt, Pinterest) are the ones implemented in
  `apps/api/src/trend-sources.ts`.
- **Platforms** — the FAQ names the platforms with adapters in
  `packages/publish/src/native/`, and says plainly that availability depends on
  each platform's own approval process. Keep that caveat; it is true and
  removing it would over-claim.
- **Autonomy** — the page says repeatedly that SparkSocial drafts and you
  publish. That matches the product's approval model. Do not soften it into
  "posts for you".
- No engagement figures, customer counts, revenue results or "10x faster"
  claims appear anywhere, because there is no data behind them.

## Accessibility and behaviour

- Semantic landmarks, one `h1`, no heading-level skips. Headings inside the
  decorative mockups are `<p>` on purpose — they are picture content, and as
  headings they put an `h3` ahead of the first `h2`.
- The workflow tabs are a real tablist: arrow keys, Home and End all move
  between them.
- The FAQ accordion drives `aria-expanded` and `hidden` together.
- Mobile drawer traps nothing, closes on Escape, on outside click, on link
  click, and on resize past the breakpoint.
- `prefers-reduced-motion` is honoured in both CSS and JS — reveals resolve
  immediately, counters jump to their value, and the demo skips its staged
  animation and shows the result.
- Verified with no horizontal overflow at 1440, 1280, 1024, 768, 430, 390 and
  375 px.

## The interactive demo

`initDemo()` in `js/script.js` is a scripted walk-through, not a model call.
The drafts are fixed strings in `DRAFTS`, keyed by platform. The section says
so on the page ("This is a demonstration of the flow, not a live model") — keep
that line if you change the copy.


## The legal pages

`privacy.html` and `terms.html` are structured drafts written to match what the
product actually does — connected accounts, AI drafting, approval-gated
publishing, per-brand isolation, retention settings. They are **not** legal
advice and have not been reviewed by a lawyer. Both carry a visible amber notice
saying so at the top; remove it only once a qualified adviser has been through
them.

Everything undecided is a `[BRACKETED]` value in the `LEGAL` object at the top
of `js/script.js`. Fill those in and the placeholders stop rendering as dashed
boxes. To find what is still outstanding, open either page and search for `[`.

Things worth getting advice on specifically:

- The liability cap in §13 of the terms, which is jurisdiction-dependent.
- Which AI providers you name as sub-processors, and whether each trains on
  customer data — §5 of the privacy policy asks for it and does not guess.
- NDPA (Nigeria) obligations alongside GDPR, given where the business is based.

## Page structure

Sections, in order: hero, trust, the problem, brand genome, the five-stage
workflow, trend intelligence, asset library, capture loop, the interactive
demo, campaigns, engagement, the learning loop, why SparkSocial, pricing,
customer stories, FAQ, final CTA.

The headline positions the whole product rather than one stage of it —
"everything your brand posts, from first idea to last reply" — because the page
previously read as a trend-discovery tool when trend discovery is one pillar of
several.

Three sections were removed after review: a features grid, an "AI does the
legwork, you stay in control" rail, and an automation-and-agency block. Each
restated something the sections around it already demonstrate — the control
message in particular is made in the workflow lede, the capture and engagement
sections and two FAQ answers, where it carries more weight than as a standalone
diagram.

Multi-brand and agency capability is still covered, in the pricing table's
Agency plan and in the FAQ ("Can I manage more than one brand?", "Is it
suitable for agencies?").
