# Shipping SparkSocial to GitHub and Azure

Neither `gh` nor `az` may be installed on this machine — the steps below are yours to
run from a real terminal with network access to Azure (the Claude Code sandbox that
built this repo cannot reach Azure at all; see CLAUDE.md).

## 1. Install the CLIs

```bash
winget install --id GitHub.cli -e
winget install --id Microsoft.AzureCLI -e
```

Reopen the terminal afterwards so both land on `PATH`.

## 2. Create the GitHub repo and push

```bash
gh auth login
gh repo create sparksocial --private --source=. --remote=origin --push
```

**Private is deliberate.** The repo carries the PRD, the content-engine spec, and the
approvals register — competitive material, and the spec calls the engine the whole
product. Swap `--private` for `--public` only if that is a decision you have made.

CI runs immediately on push (`.github/workflows/ci.yml`): typecheck, the full test
suite, the 100% policy-coverage threshold, and the genome-isolation guard.

## 3. Provision Azure

`az login` first, then run the bootstrap once. It is idempotent — re-running it after
a partial failure or to pick up a script change is safe.

```bash
az login
GITHUB_REPO=<your-org>/sparksocial ./infra/azure/bootstrap.sh
```

It creates: a resource group, Container Registry, a Container Apps environment with
**two** apps (API and web), PostgreSQL Flexible Server **with `pgvector` allow-listed**,
a storage account for Blob (assets), Key Vault, a managed identity wired to pull images
and read secrets, and an app registration federated to your repo for OIDC.

The generated database password goes straight into Key Vault. It is never printed and
never written to the repo.

Not provisioned by this script, both real gaps worth knowing about before you rely on
either: **Azure Cache for Redis** (rate limiting runs in-process without it — fine for
a single environment, but the effective budget multiplies by replica count once
`max-replicas` matters) and **Front Door** (media currently serves straight off the
Container App; Blob Storage bills egress, unlike the R2 the original plan assumed).

## 4. Wire the deploy

The script ends by printing GitHub CLI commands for seven **variables** (not secrets —
OIDC means there is no credential to store) plus the **secrets** both the web build and
the API's own runtime config need.

```bash
gh variable set AZURE_CLIENT_ID             --body "<printed>"
gh variable set AZURE_TENANT_ID             --body "<printed>"
gh variable set AZURE_SUBSCRIPTION_ID       --body "<printed>"
gh variable set AZURE_RESOURCE_GROUP        --body "<printed>"
gh variable set AZURE_ACR_NAME              --body "<printed>"
gh variable set AZURE_CONTAINERAPP_NAME     --body "<printed>"
gh variable set AZURE_CONTAINERAPP_WEB_NAME --body "<printed>"
gh variable set AZURE_STORAGE_ACCOUNT       --body "<printed — the storage account name, not a key>"
```

Then, for the web app specifically — these get baked into the client bundle at build
time (`NEXT_PUBLIC_*` values are never read at runtime), so they have to be real
**before** the first deploy, not fixable by an env var afterward:

```bash
gh secret set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY --body "<from the Clerk dashboard>"
# Optional, same reasoning:
gh secret set NEXT_PUBLIC_SENTRY_DSN   --body "<from sentry.io, if you're using it>"
gh secret set NEXT_PUBLIC_POSTHOG_KEY  --body "<from PostHog, if you're using it>"
```

The API also needs its own runtime secrets set as GitHub environment secrets (these
*are* read at runtime, but the workflow only has the GitHub-side value to give
`az containerapp update --set-env-vars`, so they still have to be set here once).
**Without these the API container throws and crash-loops on every deploy** — production
mode refuses to boot with a header-trusting auth fallback, by design
(`apps/api/src/index.ts`'s own "refusing to start" check):

```bash
gh secret set DATABASE_URL       --body "<the Key Vault connection string the bootstrap printed>"
gh secret set CLERK_SECRET_KEY   --body "<from the Clerk dashboard>"
# Optional — without it, POST /v1/agent/runs answers 501 and genome inference
# can't run, but the container still boots and everything else still works:
gh secret set ANTHROPIC_API_KEY  --body "<from console.anthropic.com>"
```

`CLERK_AUTHORIZED_PARTIES` (the audience check deciding which origin's tokens the API
accepts) is deliberately **not** a GitHub secret to set by hand — the workflow resolves
the web Container App's real FQDN at deploy time and sets it automatically, so it can
never drift to a stale hostname the way a manually-copied value could.

Then push to `main`, or run the **Deploy to Azure** workflow manually
(`workflow_dispatch`, choose `staging` or `production`).

The workflow: runs typecheck + tests once, then builds and deploys the API and web
images in parallel. The API job applies pending database migrations *before* the image
ships (new code against an old schema fails loudly on the missing column; old code
against a new schema is silently fine, which is why migrations go first) and polls
`/health` until it reports the exact commit SHA just pushed — a deploy that never
converges fails the run rather than reporting success. The web job resolves the API's
own Container App FQDN at deploy time (so `SPARK_API_URL` can never point at a stale
hostname) and polls `/sign-in` for a 200 as its reachability check — weaker than the
API's SHA-matching check, since there's no `/health`-style endpoint on the web app yet
to compare against.

## 5. Before the app is actually useful

The bootstrap prints these too:

- Add your IP to the Postgres firewall, then `CREATE EXTENSION vector;` — the extension
  is allow-listed by the script but not created:
  ```bash
  az postgres flexible-server firewall-rule create -g <rg> -n <pg-name> \
    --rule-name dev --start-ip-address <your-ip> --end-ip-address <your-ip>
  ```
- Create the six custom organization roles in the Clerk dashboard
  (`org:owner` … `org:client`, matching `Role` in `packages/shared/src/types.ts`) and
  enable whichever social sign-in providers `NEXT_PUBLIC_SOCIAL_PROVIDERS` lists.
- Put Front Door in front of both Container Apps before serving real media traffic.
- Every other vendor integration (native publish platforms, WhatsApp, trend sources,
  Canva, etc.) is independently optional and gated on its own env var — see
  `apps/api/.env.example` for the full list and setup steps for each, or the project's
  own Gap Ledger for current status and priority order.

## Local development

```bash
npm ci
npm test
npm run dev:api    # apps/api, watches for changes
npm run dev:web    # apps/web, separate terminal
```

```bash
curl -s localhost:8080/v1/tools
```

That last one returns exactly what SPARK sees. If a capability is missing from it, the
UI must not be able to reach it either.

## Local production build (without Azure)

To sanity-check a production build on your own machine before pushing:

```bash
npm run build:web
NODE_ENV=production npm start -w @sparksocial/api    # terminal 1
npm start -w @sparksocial/web                          # terminal 2
```

`apps/api` refuses to boot with `NODE_ENV=production` unless `CLERK_SECRET_KEY` and
`CLERK_PUBLISHABLE_KEY` are both set (or `ALLOW_DEV_AUTH=true`, which should never be
set anywhere real) — it throws rather than silently falling back to the
header-trusting dev resolver, which would make tenant isolation forgeable.

To test the actual container images locally (closer to what ships to Azure than the
plain `npm start` above):

```bash
docker build -f apps/api/Dockerfile -t sparksocial-api:local .
docker build -f apps/web/Dockerfile -t sparksocial-web:local \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<your key> .
```
