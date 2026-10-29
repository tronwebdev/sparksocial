# Custom domain, landing page, and every vendor URL after the Azure → Render move

Companion to `MIGRATION.md` (which moves the services) and `render.yaml` (which
defines them). This file covers what happens *around* the services: your own
domain, the marketing site, and every third-party dashboard that has a SparkSocial
URL typed into it.

Domain used throughout: **`sparkai.social`** — the one in `marketing/index.html`'s
canonical tag. If yours differs, find-and-replace it before you start.

---

## 0. The hostnames

| Hostname | Points at | Why this one |
| --- | --- | --- |
| `sparkai.social` | Render static site `sparksocial-marketing` | Landing page, privacy, terms. |
| `www.sparkai.social` | same (Render redirects it to the apex) | Render adds it automatically. |
| `app.sparkai.social` | Render web service `sparksocial-web` | The product. |
| `api.sparkai.social` | Render web service `sparksocial-api` | OAuth callbacks, webhooks, `/v1/tools`. |
| `clerk.sparkai.social` | Clerk (Frontend API) | Required by a Clerk **production** instance. |
| `accounts.sparkai.social` | Clerk (Account Portal) | Same. |
| `mautic.sparkai.social` | Your Namecheap VPS — **leave alone** | Already set up per `marketing/mautic-setup/GUIDE.md`. |

Why a separate `api.` host rather than proxying everything through `app.`: every
OAuth redirect URI and webhook below is registered against the API, and a
dedicated host means the web tier can be redeployed or moved without touching
a single vendor dashboard again.

---

## 1. Find where your DNS actually lives

You bought the domain at Namecheap or SiteGround, but what matters is which
company's **nameservers** it uses — that is the only place record edits take
effect. `marketing/mautic-setup/GUIDE.md` set records in SiteGround's DNS Zone
Editor, which suggests SiteGround. Confirm:

```bash
nslookup -type=NS sparkai.social
```

- `ns1.siteground.net` / `ns2.siteground.net` → edit records in **SiteGround → Site Tools → Domain → DNS Zone Editor**.
- `dns1.registrar-servers.com` → edit in **Namecheap → Domain List → Manage → Advanced DNS**.

Edit records in that one place only. Records added at the other company are
silently ignored.

**Before changing anything, screenshot the current zone.** In particular, do not
touch `MX`, the SendGrid `CNAME`s, `_dmarc`, `mautic`, or any `TXT` you didn't
create today — those are your email.

---

## 2. Connect the domain to Render

### 2.1 Add the domains in Render

For each service: **Render dashboard → service → Settings → Custom Domains → Add**.

| Service | Add |
| --- | --- |
| `sparksocial-marketing` | `sparkai.social` (Render offers to add `www` too — accept) |
| `sparksocial-web` | `app.sparkai.social` |
| `sparksocial-api` | `api.sparkai.social` |

Render then shows the exact record it wants for each. Use what it shows; the
table below is what it shows today.

### 2.2 Add the DNS records

| Type | Host / Name | Value | TTL |
| --- | --- | --- | --- |
| `A` | `@` (apex) | `216.24.57.1` | 300 |
| `CNAME` | `www` | `sparksocial-marketing.onrender.com` | 300 |
| `CNAME` | `app` | `sparksocial-web.onrender.com` | 300 |
| `CNAME` | `api` | `sparksocial-api.onrender.com` | 300 |

Things that go wrong here, in order of frequency:

1. **An existing `A` record on `@` or `www`** — SiteGround creates one pointing at
   its own hosting. Edit it to Render's value; don't add a second one beside it.
   (This moves whatever SiteGround was serving at the apex. Email is unaffected —
   email follows `MX`, not `A`.)
2. **`AAAA` records** on `@` or `www`. Render serves IPv4 only; delete them, or
   some visitors resolve to the old host.
3. **A `CAA` record** that doesn't list `letsencrypt.org` and `pki.goog`. If the
   zone has any `CAA` record, add those two or Render cannot issue certificates.
4. **SiteGround's host field** wants the bare label (`app`), not `app.sparkai.social`.
   Some editors append the domain for you, giving `app.sparkai.social.sparkai.social`.

### 2.3 Verify

Back in Render, click **Verify** on each domain. Certificates are issued
automatically once DNS resolves — usually minutes, occasionally an hour.

```bash
nslookup app.sparkai.social
curl -sI https://api.sparkai.social/health
curl -sI https://sparkai.social
```

At this point both the `onrender.com` URLs and the new ones work. **Nothing has
cut over yet** — the app still tells vendors and Clerk its old URLs. Section 4
does that.

---

## 3. Host the landing page on Render

Already done in code: `render.yaml` now defines `sparksocial-marketing` as a
**static site** (free, CDN-served, never sleeps). Its build copies an allow-list
of files into `dist/` rather than publishing `marketing/` wholesale, because that
folder also contains `mautic-setup/` (server scripts) and `.claude/`, which must
not be publicly downloadable.

Steps:

1. Commit and push `render.yaml`.
2. **Render → Blueprints → your blueprint → Sync** (or **Manual sync**). It creates
   `sparksocial-marketing`. The other services are unaffected.
3. Attach `sparkai.social` to it (§2.1).
4. Fix before launch (all in `marketing/`):
   - ~~"Get started" buttons point at `#signup`~~ — done: every sign-up CTA now goes
     to `https://app.sparkai.social/sign-up` and "Log in" to `/sign-in`. They work
     once `app.sparkai.social` resolves (§2).
   - `assets/og-image.png` doesn't exist — add a 1200×630 image or the social
     preview is blank.
   - When you add a new public file or folder, add it to `buildCommand` in
     `render.yaml` too, or it won't be published.

The privacy and terms pages will live at `https://sparkai.social/privacy.html`
and `https://sparkai.social/terms.html`. **Several vendors below require those
URLs** — the platform app reviews especially — so get the landing page live first.

---

## 4. Switch the app to the new URLs

### 4.1 Render environment variables

These are set with `value:` in `render.yaml`, so **change them in the file, not
the dashboard** — a Blueprint sync overwrites dashboard edits to synced values.

| Service | Variable | Old | New |
| --- | --- | --- | --- |
| api | `WEB_APP_URL` | `https://sparksocial-web.onrender.com` | `https://app.sparkai.social` |
| api | `CLERK_AUTHORIZED_PARTIES` | `https://sparksocial-web.onrender.com` | `https://app.sparkai.social,https://sparksocial-web.onrender.com` |
| api | `SOCIAL_REDIRECT_URI` | `https://sparksocial-api.onrender.com/oauth/social/callback` | `https://api.sparkai.social/oauth/social/callback` |
| api | `CANVA_REDIRECT_URI` | `https://sparksocial-api.onrender.com/oauth/canva/callback` | `https://api.sparkai.social/oauth/canva/callback` |
| web | `SPARK_API_URL` | `https://sparksocial-api.onrender.com` | `https://api.sparkai.social` |

`CLERK_AUTHORIZED_PARTIES` is a comma-separated list (`envList` in
`apps/api/src/index.ts`), so keep both origins during the switch and drop the
`onrender.com` one later. Getting it wrong doesn't error — it silently rejects
every sign-in.

`WEB_APP_URL` also builds Stripe's `success_url` / `cancel_url`
(`apps/api/src/stripe-client.ts`) and every link in capture messages and
notifications.

### 4.2 In the env group (`sparksocial-secrets`)

| Variable | Change |
| --- | --- |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY` | New `sk_live_` / `pk_live_` / JWT key **if** you move to a Clerk production instance (§5.1). |
| `STRIPE_WEBHOOK_SECRET` | New value — a new Stripe endpoint gets a new signing secret (§5.4). |
| `R2_PUBLIC_BASE_URL` | Only if you give R2 a custom domain (§5.6). |
| `DUB_DOMAIN` | Only if you add a branded short domain (§5.7). |
| `AZURE_STORAGE_ACCOUNT` and any other `AZURE_*` | **Must be absent.** Delete, don't blank. |

On the **web** service, `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
are set in that service's own environment (`sync: false`), not the group —
change them there too.

### 4.3 Redeploy — the web service needs a *rebuild*

`NEXT_PUBLIC_*` values are baked into the JavaScript at build time. After changing
any of them: **sparksocial-web → Manual Deploy → Clear build cache & deploy.** A
restart does nothing.

The API has auto-deploy off (by design, so it can't race a migration): deploy it
manually, or push to `main` and let `.github/workflows/deploy-render.yml` run it.

### 4.4 R2 CORS

`infra/render/r2-cors.json` now includes `https://app.sparkai.social`. Apply it in
**Cloudflare → R2 → your bucket → Settings → CORS Policy** (paste the `rules`
array). Without it, browser uploads from the new origin fail at the preflight
with a CORS error while uploads from `onrender.com` keep working — a confusing
split.

---

## 5. Every vendor, and what to change in each

Callback paths, from the code:

| Path | Purpose | Source |
| --- | --- | --- |
| `/oauth/social/callback` | All social platform connects (one URL for all) | `apps/api/src/social-oauth.ts` |
| `/oauth/canva/callback` | Canva connect | `apps/api/src/canva-oauth.ts` |
| `/v1/webhooks/whatsapp` | WhatsApp capture loop (GET verify + POST) | `apps/api/src/whatsapp-webhook.ts` |
| `/v1/webhooks/engage/meta` | Instagram/Facebook comments & DMs | `apps/api/src/engage-webhook.ts` |
| `/v1/webhooks/engage/aggregator` | Ayrshare engagement relay | same |
| `/webhooks/stripe` | Billing (note: no `/v1/`) | `apps/api/src/stripe-webhook.ts` |

Rule for every OAuth dashboard below: **add the new URL alongside the old one,
don't replace it**. Remove the Azure (`*.azurecontainerapps.io`) and
`onrender.com` entries only after a day of clean traffic. Most of these fail
silently — the user sees a vague "redirect_uri mismatch" page from the platform,
and you see nothing in your logs.

### 5.1 Clerk (auth) — do this first

- **Development instance (`pk_test_…`)**: works on any domain. Add
  `https://app.sparkai.social` under **Configure → Domains / Allowed origins** and
  you're done.
- **Production instance (`pk_live_…`)**: needs a domain you own — this is the main
  reason to have the custom domain at all; Clerk will not run production on
  `onrender.com`. **Configure → Domains** → set `sparkai.social` (app at
  `app.sparkai.social`). Clerk then lists DNS records — typically:

  | Type | Host | Value |
  | --- | --- | --- |
  | `CNAME` | `clerk` | `frontend-api.clerk.services` |
  | `CNAME` | `accounts` | `accounts.clerk.services` |
  | `CNAME` | `clkmail` | `mail.<id>.clerk.services` |
  | `CNAME` | `clk._domainkey` | `dkim1.<id>.clerk.services` |
  | `CNAME` | `clk2._domainkey` | `dkim2.<id>.clerk.services` |

  Copy the exact values from Clerk; the `<id>` parts are yours. Then put the new
  `pk_live_` / `sk_live_` / JWT key into Render (§4.2) and rebuild web (§4.3).
- **Google sign-in** (`NEXT_PUBLIC_SOCIAL_PROVIDERS=google`): a Clerk production
  instance requires *your own* Google OAuth client. In Google Cloud Console create
  one with redirect URI `https://clerk.sparkai.social/v1/oauth_callback` (Clerk
  shows the exact URL under **SSO connections → Google**) and paste its client
  ID/secret into Clerk.
- Production users don't carry over from a dev instance. If you have real users
  in dev, export/import them before switching.

### 5.2 Meta — Facebook, Instagram, WhatsApp (developers.facebook.com)

One app, several screens:

- **App settings → Basic**: App Domains add `sparkai.social`; Privacy Policy URL
  `https://sparkai.social/privacy.html`; Terms `https://sparkai.social/terms.html`;
  User data deletion → instructions URL (privacy page) or a callback.
- **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**:
  `https://api.sparkai.social/oauth/social/callback`.
- **Instagram (API with Instagram Login) → Business login settings → OAuth redirect URIs**: same URL.
- **Webhooks → Instagram / Page**: callback `https://api.sparkai.social/v1/webhooks/engage/meta`,
  verify token = your `META_VERIFY_TOKEN`. Click **Verify and save** — Meta
  calls the URL immediately, so the API must already answer on the new host.
- **WhatsApp → Configuration → Webhook**: callback
  `https://api.sparkai.social/v1/webhooks/whatsapp`, verify token =
  `WHATSAPP_VERIFY_TOKEN`; re-subscribe the `messages` field. Meta allows only one
  callback URL here, so this one is a straight swap — do it at cut-over.

### 5.3 Threads (same Meta app, Threads use case)

**Use cases → Threads → Settings**: Redirect callback URL
`https://api.sparkai.social/oauth/social/callback`; Uninstall and Delete callback
URLs on the same host.

### 5.4 Stripe

**Developers → Webhooks → Add endpoint**: `https://api.sparkai.social/webhooks/stripe`,
same events as the old endpoint. Copy its **new signing secret** into
`STRIPE_WEBHOOK_SECRET`, redeploy, send a test event, then disable the old
endpoint. Checkout return URLs need no dashboard change — they come from
`WEB_APP_URL`. Also update **Settings → Business → Public details** (website,
privacy, terms URLs) — Stripe shows them on checkout.

### 5.5 Other platform apps

| Vendor | Where | Set |
| --- | --- | --- |
| **LinkedIn** | developer.linkedin.com → app → Auth → Authorized redirect URLs | `https://api.sparkai.social/oauth/social/callback`; also Settings → Privacy policy URL |
| **TikTok** | developers.tiktok.com → app → Login Kit → Redirect URI; also *URL properties* verification | callback URL; verify `api.sparkai.social` (and `sparkai.social`) by DNS `TXT`; terms + privacy URLs |
| **X** | developer.x.com → app → User authentication settings | Callback URI = callback URL; Website URL = `https://sparkai.social` |
| **Google Cloud** (YouTube, Google Business, Drive) | APIs & Services → Credentials → OAuth client | Authorized redirect URIs: callback URL; Authorized JavaScript origins: `https://app.sparkai.social` |
| **Google Cloud** consent screen | OAuth consent screen → Branding | Authorized domain `sparkai.social` (needs verification in Google Search Console — a `TXT` record); homepage, privacy, terms URLs. Changing these on a verified app can trigger re-review. |
| **Pinterest** | developers.pinterest.com → app → Redirect URIs | callback URL |
| **Reddit** | reddit.com/prefs/apps | Redirect URI = callback URL (only matters if the app is a "web app"; a "script" app used only for trends needs nothing) |
| **Canva** | canva.com/developers → integration → Authentication → Redirect URLs | `https://api.sparkai.social/oauth/canva/callback`; return navigation URL if set |
| **Bluesky** | — | Nothing. Brands connect with their own app password. |

### 5.6 Cloudflare R2

- **CORS**: §4.4.
- **Public media URL** (optional): R2 *custom domains* only work for domains whose
  DNS is on Cloudflare. Yours is on SiteGround/Namecheap, so either keep the
  `r2.dev` public URL / signed URLs (what `R2_PUBLIC_BASE_URL` unset does), or move
  DNS to Cloudflare later. Don't try a `CNAME` to R2 from SiteGround — it won't
  serve.

### 5.7 Ayrshare, Dub, observability

| Vendor | Change |
| --- | --- |
| **Ayrshare** | Dashboard → Webhooks: `https://api.sparkai.social/v1/webhooks/engage/aggregator`. Not configured yet (`AYRSHARE_API_KEY` unset) — set it this way when you do. |
| **Dub** | Optional: add a branded short domain (e.g. `go.sparkai.social`, `CNAME` → `cname.dub.co`) and set `DUB_DOMAIN`. |
| **Sentry** | Project → Settings → Security & Privacy → Allowed Domains: add `app.sparkai.social` if the list isn't `*`. |
| **PostHog** | Project settings → Authorized URLs: add `https://app.sparkai.social` and `https://sparkai.social` (toolbar + web analytics). |
| **Langfuse, Anthropic, OpenAI, fal, Higgsfield, HeyGen, ElevenLabs, AssemblyAI** | No URLs registered — nothing to change. If you ever added a webhook in one of their dashboards pointing at an Azure host, repoint it to `api.sparkai.social`. |
| **SendGrid / Mautic** | Unaffected — they use `mautic.` and email DNS records you aren't touching. |

### 5.8 GitHub

**Settings → Secrets and variables → Actions**:

- Needed by `deploy-render.yml`: `RENDER_DATABASE_URL` (the **external** URL),
  `RENDER_DEPLOY_HOOK_API`, `RENDER_DEPLOY_HOOK_WEB`.
- Delete once Azure is gone: `AZURE_*` secrets/variables and the OIDC federated
  credential; delete `.github/workflows/deploy-azure.yml` in the same commit.

---

## 6. Everything else that changed with Azure → Render

| Area | Azure | Render now | Action for you |
| --- | --- | --- | --- |
| Web + API hosting | Container Apps | Web Services (Docker) | API must stay on **standard** or above — smaller OOMs on renders. |
| Image registry | ACR | none — Render builds from the repo | Nothing. |
| Database | Postgres Flexible Server | Render Postgres 16 | `CREATE EXTENSION vector` before restore. **Your DB is on the `free` plan, which Render deletes 30 days after creation (+14-day grace).** Upgrade to `basic-1gb` or higher before launch — put a calendar reminder in now. |
| Object storage | Blob Storage + Front Door | Cloudflare R2 | `R2_*` in the env group; blobs copied with `rclone`. If any DB rows store absolute `blob.core.windows.net` URLs, they break when Azure is deleted — check before deleting. |
| Secrets | Key Vault + managed identity | Env group `sparksocial-secrets` | Anyone with Render access can read them — limit dashboard members. **Never add blank keys.** |
| Redis | Azure Cache | Key Value (`free`, in-memory) | Fine for rate-limit counters only. |
| Migrations | Azure workflow | `deploy-render.yml` runs them, then deploy hooks | API auto-deploy stays **off**. |
| Commit reporting | `REVISION` | `RENDER_GIT_COMMIT` (read automatically) | Nothing. |
| Monthly cost | Azure bill | Render bill + R2 | Cancel Azure only after §7 step 8. |

---

## 7. Cut-over order

1. Landing page live on `sparkai.social` (§3) — vendors' reviews need its privacy/terms URLs.
2. DNS records for `app` and `api` (§2); certificates issued; `curl /health` works on the new host.
3. Clerk domain + DNS (§5.1). Wait for Clerk to show all records verified.
4. Add the new callback URLs to **every** OAuth dashboard (§5.2–5.5), keeping the old ones.
5. Change `render.yaml` URLs (§4.1), update env group (§4.2), push, sync, deploy API, **rebuild** web (§4.3). Apply R2 CORS (§4.4).
6. Swap the single-URL webhooks: WhatsApp, Meta webhooks, Stripe (new secret), Ayrshare.
7. Test end to end: sign in, sign up with Google, connect one social account, upload an asset, send a WhatsApp clip, run a Stripe test checkout.
8. After a day of clean traffic: remove old URLs from vendor dashboards, drop `onrender.com` from `CLERK_AUTHORIZED_PARTIES` and `r2-cors.json`, then follow `MIGRATION.md` §7–8 to delete Azure.

---

## Agency websites — `<agency>.sparkai.social` and custom domains

Each agency's generated website (`agency.site.generate`) is served by the
**`sparksocial-web`** service: `apps/web/src/middleware.ts` reads the request's
host (`lib/siteHost.ts`) and rewrites `northside.sparkai.social` or a bound
custom domain to `/s/...`. Nothing about this needs a deploy per agency — only
the one-time setup below. Until it is done, sites still render at
`https://app.sparkai.social/s/<slug>`.

**Order matters:** migration `0061` (four nullable `org_settings` columns) must
run before the API that reads them, as with every migration here.

### 1. The wildcard subdomain (once)

1. Render → `sparksocial-web` → Settings → Custom Domains → add `*.sparkai.social`.
2. At the DNS host for `sparkai.social`, add the three records Render shows for a
   wildcard. They are of this form (copy Render's exact values):

   | Type | Name | Value |
   | --- | --- | --- |
   | CNAME | `*` | `sparksocial-web.onrender.com` |
   | CNAME | `_acme-challenge` | `sparksocial-web.verify.renderdns.com` |
   | CNAME | `_cf-custom-hostname` | `sparksocial-web.hostname.renderdns.com` |

3. Render requires the **root domain to point at Render** for a wildcard to
   work. `sparkai.social` already does (it is `sparksocial-marketing`); if that
   ever moves off Render, the wildcard stops issuing certificates.
4. On Cloudflare, keep these records **DNS only** (grey cloud).

Explicit records win over the wildcard, so `app.`, `api.`, `clerk.`,
`accounts.` and `mautic.` are unaffected. `lib/siteHost.ts` also refuses to
treat any of the product's own labels as an agency.

### 2. Custom domains (optional)

`agency.domain.connect` adds the agency's domain to `sparksocial-web` through
Render's API, and the wizard shows the DNS records the agency must set (a CNAME
for a subdomain; an `A` record to `216.24.57.1`, or an ALIAS, for a root domain,
plus `www`). Render issues the certificate once DNS resolves.

Set these three on **`sparksocial-api`** (the env group) to switch it on. Leave
all three out to keep it off — the domain tools then stay unregistered and the
wizard says custom domains are not switched on:

| Key | Value |
| --- | --- |
| `RENDER_API_KEY` | Account Settings → API Keys. It can manage every service in the workspace — treat it like a root password. |
| `RENDER_WEB_SERVICE_ID` | `srv-…` from `sparksocial-web`'s URL in the dashboard. |
| `SITE_CNAME_TARGET` | `sparksocial-web.onrender.com` |

**The bill:** Render counts custom domains per workspace — 15 on Pro, then
$0.25 a month each — and every agency that connects one adds to it.

`SITE_ROOT_DOMAIN` (default `sparkai.social`) is read by both services if the
sites ever move to another root.
