# Publishing, end to end: all fourteen platforms, tokens that renew themselves, and the guide to set them up

34 commits. `main` has not moved since 6 September, so everything below is
currently unshipped — including two bugs that made connecting a social account
impossible.

## The bugs that prompted most of this

**The Connect button could not connect.** `integration.connect`'s input is
`{ genomeId, provider }`; Settings and the campaign wizard both sent
`{ platform }` — neither field — so Zod rejected it before the handler ran.
Connecting any account from Settings had been impossible since `a96044e`.

Auditing all 320 `invoke` call sites against the generated types found two more:
`calendar.recommend_slot` was sent `day` instead of `date` and failed *silently*
(the modal renders "none" on any non-success, so a failed read and a day with
nothing to suggest looked identical), and three calls passed a `genomeId` to
tools that take none.

`scripts/check-tool-inputs.mjs` is the guard, in CI beside `check:tool-types` —
that one proves the generated types match the registry, this proves the app's
calls match the types.

**Tokens never refreshed.** Refresh tokens were stored and never spent. Google
issues a 1-hour access token and X a 2-hour one, so a brand that connected
YouTube at nine could not publish at eleven, and the only repair offered was a
human pressing Reconnect — hourly, forever. Now handled twice: lazily inside
`publish.now` (which is what guarantees a post goes out) and on a clock (which is
what keeps the account healthy between posts).

## All fourteen platforms publish natively

Was five. The other nine split three ways:

- **Four were never separate accounts.** Instagram Stories, Facebook, Facebook
  Groups and YouTube long-form post through a connection another platform
  already made — `PARENT_PLATFORM` records that, and each had been rendering a
  Connect button that could only ever fail.
- **Five are new integrations**: Threads, Pinterest, Reddit, Google Business and
  Bluesky — OAuth, token exchange, refresh where the provider has one, and a
  publishing adapter each.
- **Bluesky has no OAuth at all.** It authenticates with a handle and an app
  password, so it needed `integration.connect_credentials` and a form rather
  than a redirect.

`PUBLISH_PREFER_AGGREGATOR=true` moves everything onto Ayrshare and off again
without touching a connection, a token or a deploy.

## Schema tightening

Nine vocabularies that were `z.string()` in tool outputs now say what they are —
`Platform`, `CampaignStatus`, `Objective`, `ContentStatus`, `ContentPillar`,
`GenerationMode`, `EngagementPlatform`, `EngagementKind`, asset roles. Each was
verified against its writers first, because `invoke` runs `tool.output.parse` and
promising a union the database does not hold turns a read into a failure.

`scripts/generate-tool-types.mts` prints the frontend's types from the registry,
which is what made the input audit possible at all.

## Docs

`docs/VENDOR_SETUP.md` (+ PDF): every platform and trend source, what each needs
from its console, and where each one actually stands. It leads with the redirect
URI, because that is the failure that cost the most time — one value shared by
every console, `127.0.0.1` and `localhost` are different strings, and only Google
names the mismatch: TikTok blames `client_key` and X says nothing at all.

## Migration

`0054` adds `oauth_connections.account_avatar_url`. Additive, nullable, no
backfill — **needs running on staging before this deploys.**

## Verification

`npx tsc` clean on both configs, **2930 tests passing on exit code 0**,
`check:tool-types`, `check:tool-inputs`, `test:isolation` and `build:web` green.

Connecting was exercised end to end in a real browser against the real API: X,
YouTube, LinkedIn and Google Business all connect and publish; TikTok reaches its
consent screen and fails on a redirect URI that is registered in its console, not
in code.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
