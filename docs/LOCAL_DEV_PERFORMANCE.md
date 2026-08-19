# Why local pages feel slow, and what actually helps

Measured on the development machine, 10 Aug 2026. Numbers are curl's own
`time_total` — a naive `time curl` is useless here, because spawning curl in
this environment costs ~500ms on its own, which is the same order as what is
being measured.

## Where the time goes

| Surface | Time |
|---|---|
| Hono API (`:8080/health`, plain Node, no bundler) | **0.8ms – 8ms** |
| Next dev, request that **skips** Clerk middleware | **0.32s – 0.46s** |
| Next dev, request **through** Clerk middleware | **2.2s – 9.2s** |
| One call to the Clerk dev instance | 0.34s warm, ~1.0s cold (DNS+TCP+TLS) |

The API being sub-millisecond rules out the machine, the network stack and
Node. Two things account for essentially all of it:

**1. Clerk middleware, ~2s+ per request.** `clerkMiddleware` runs on every page
and RSC navigation. Against a `.clerk.accounts.dev` development instance each
verification is a real round trip, and this machine is ~340ms from Clerk warm,
~1s cold. Production instances are materially faster, and JWKS caching means a
deployed app does not pay this per request.

**2. Webpack dev compilation.** Repeated identical requests varied 1.2s → 9.2s →
1.2s → 6.9s, which is recompilation churn rather than steady-state cost.

## What was changed

`next dev --turbopack`. It does not remove the Clerk round trip — nothing local
can — but it removes the compile variance, which is the part that makes
navigation feel unpredictable rather than merely slow.

## What still helps, in order

1. **Test against a production build.** `npm run build:web && npm run start -w
   @sparksocial/web` has no dev compilation at all. Use it when judging how the
   app actually feels; `next dev` is for iteration, not for assessment.
2. **Exclude the repo from realtime antivirus scanning.** `node_modules` is
   781MB across 269 packages, and Windows Defender scanning it on every file
   read is a well-known multiplier on exactly this workload.
3. **A Clerk production instance**, when deploying. Development instances are
   rate-limited and slower by design.

## What is NOT the cause

Ruled out by measurement, so as not to be re-investigated:

- The machine, the network stack, or Node — the API answers in under a
  millisecond on the same box.
- `localhost` vs `127.0.0.1` DNS resolution — identical timings.
- Our own middleware matcher — it already excludes `_next` and static assets,
  and a request that skips middleware entirely is 5-10x faster.
