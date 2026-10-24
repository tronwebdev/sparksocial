# Moving SparkSocial from Azure to Render

A runbook, in the order the steps actually have to happen. It is written against
what this repo really contains — `infra/azure/bootstrap.sh`,
`.github/workflows/deploy-azure.yml`, `infra/azure/secrets.manifest`, both
Dockerfiles and `packages/storage/src/azure.ts` — not against a generic
"lift and shift" checklist.

Read §0 first. One of the two blockers there decides how much code changes, and
it is not a decision you want to discover halfway through.

---

## 0. The two things Render does not have

Everything else in this migration is a rename. These two are real work.

### 0.1 There is no object storage on Render

Azure Blob Storage has no Render equivalent. Render's own guidance is to use an
external object store; its persistent disks are not a substitute — a disk
attaches to a single instance, which removes horizontal scaling *and*
zero-downtime deploys for the service it is attached to.

So `assets` has to live somewhere. Three options, in the order I would rank them:

| Option | What it costs you |
| --- | --- |
| **A. Move to Cloudflare R2** (recommended) | Write one new `BlobStore` implementation. Gets you back the zero-egress property the master plan §2.2 originally chose R2 for, which CLAUDE.md notes Blob Storage loses. |
| **B. Keep Azure Blob** | Smaller code change, but you keep an Azure bill, and every media fetch is now Azure→internet egress with no Front Door in front of it. The cost note in CLAUDE.md gets worse, not better. |
| **C. Backblaze B2 / AWS S3** | Same shape of work as A. B2 is cheaper than S3; R2 is cheaper than both at egress. |

**Either way, `packages/storage/src/azure.ts` cannot run on Render as written.**
It signs uploads with a *user-delegation SAS*, minted through
`DefaultAzureCredential` — i.e. the Container App's managed identity. Render has
no managed identity. There is no environment variable that fixes this; the
credential chain has nothing to resolve to.

- Taking **option B**, you must rewrite that file to use
  `StorageSharedKeyCredential` with the storage account key, which reintroduces
  exactly the permanent all-powerful credential the file's own header comment
  says nothing here should ever hold.
- Taking **option A or C**, you add `packages/storage/src/s3.ts` implementing the
  same `BlobStore` interface (`packages/storage/src/types.ts`) with presigned
  PUT via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. R2 and B2 are
  both S3-compatible, so one implementation covers all three.

The selection point is `apps/api/src/tools.ts` (`blobStore`), gated in
`apps/api/src/index.ts:584` on `envSet('AZURE_STORAGE_ACCOUNT')`. That gate
becomes the new provider's variable. Note `index.ts:605` — with no object store
configured the API falls back to local disk and *says so*; on Render that
fallback is silently destructive, because the container filesystem is ephemeral.
Do not ship with it.

Copying the existing blobs across, once the new bucket exists:

```bash
rclone copy azureblob:assets r2:sparksocial-assets --progress
```

### 0.2 There is no Key Vault, and no managed identity

On Azure, secrets are resolved *at revision start* by the app's own identity, and
CI never touches a value — it only names them (see the `keyvaultref:` wiring in
`deploy-azure.yml`). On Render, secrets are environment variables in an **env
group**, set by a human in the dashboard, visible to anyone on the team with
access to it.

That is a genuine reduction in security posture. It is normal for Render and it
is survivable, but state it out loud rather than discovering it at an audit.

The thing to preserve from Azure is `infra/azure/secrets.manifest`'s
`required`/`optional` distinction — and specifically its point that *absent* is
not *empty*. `defineTool` registration is gated on `envSet(...)`, so a key you
set to `""` in Render registers the tool and then fails at call time, which reads
to a user as "the product is broken" rather than "this is not configured".

> **When you create the env group, leave unconfigured keys out entirely. Never
> add them as blank placeholders.**

---

## 1. Service-by-service mapping

| Azure (today) | Render | Notes |
| --- | --- | --- |
| Container App — API | **Web Service**, Docker, `apps/api/Dockerfile` | Public: OAuth callbacks and the WhatsApp webhook need ingress. |
| Container App — web | **Web Service**, Docker, `apps/web/Dockerfile` | |
| Container Registry (ACR) | *nothing* | Render builds the Dockerfile from the repo. `az acr build` disappears. |
| PostgreSQL Flexible Server + `pgvector` | **Render Postgres** | pgvector is available on PG 13+. |
| Blob Storage | *nothing* — see §0.1 | |
| Key Vault + Managed Identity | **Env group** — see §0.2 | |
| Azure Cache for Redis | **Render Key Value** | Same `REDIS_URL` variable. |
| Front Door | Render's CDN fronts the web service only | Not a general media CDN. Mux still fronts video. |
| Storage Queues / Service Bus | *nothing* | Not provisioned today anyway; Trigger.dev is unchanged. |
| GitHub OIDC federation | *nothing* | Render auto-deploys on push, or you call a deploy hook. |

Unchanged, because they were always provider-agnostic: Trigger.dev, Mux, Clerk,
Langfuse, PostHog, Sentry, HeyGen, ElevenLabs, fal, Canva, AssemblyAI, WhatsApp
Cloud API, Dub.

---

## 2. Sizing, before you pick plans

The API image is not a typical Node service. `apps/api/Dockerfile` installs
Debian, ffmpeg, Chromium and Liberation fonts, because Playwright (the
onboarding site crawl) and Remotion (video renders) both need a real browser.

- **Do not use a free or starter instance for the API.** A Remotion render on
  512MB will OOM. Standard (2GB) is the floor; go higher if renders are
  concurrent.
- Free instances also spin down when idle, which breaks the WhatsApp webhook and
  every OAuth callback.
- Expect slow first builds. The image is large and Render builds it on their
  builders rather than pulling a prebuilt one from ACR.

The web image is a Next.js `output: 'standalone'` build and is cheap by
comparison.

---

## 3. Provision

### 3.1 Postgres

Create a Render Postgres instance, then enable the extension the schema needs:

```bash
psql "$RENDER_EXTERNAL_DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

On Azure this needed `pgvector` allow-listed as a server parameter *before*
migrations (CLAUDE.md). On Render there is no allow-list step — the extension is
simply available, so this is one `CREATE EXTENSION` and nothing more.

Use the **internal** connection string for `DATABASE_URL` on the services (no
egress, lower latency) and the external one for migrations run from CI.

`packages/db/src/client.ts` needs no change, but re-read its `max` comment: the
ceiling is `max × replicas`, default 10 per replica. Check it against the
connection limit of whichever Render Postgres plan you pick — it is lower on the
small plans than on the Flexible Server this was sized for.

### 3.2 Migrate the data

```bash
pg_dump "$AZURE_DATABASE_URL" --no-owner --no-acl -Fc -f spark.dump
pg_restore -d "$RENDER_EXTERNAL_DATABASE_URL" --no-owner --no-acl spark.dump
```

Restore into a database where `CREATE EXTENSION vector` has already run, or
every `vector` column fails to restore.

### 3.3 Key Value (Redis)

Only if you want shared rate limiting. `REDIS_URL` is `optional` in the manifest
and the app runs in-process without it — with the same caveat the Azure README
records: the effective budget multiplies by replica count.

---

## 4. `render.yaml`

Render reads this as a Blueprint. Put it at the repo root.

```yaml
services:
  - type: web
    name: sparksocial-api
    runtime: docker
    dockerfilePath: ./apps/api/Dockerfile
    dockerContext: .
    plan: standard            # see §2 — not starter
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: sparksocial-db
          property: connectionString
      - fromGroup: sparksocial-secrets
      # Non-secret config. See the note below on cross-service URLs.
      - key: WEB_APP_URL
        value: https://sparksocial-web.onrender.com
      - key: CLERK_AUTHORIZED_PARTIES
        value: https://sparksocial-web.onrender.com
      - key: SOCIAL_REDIRECT_URI
        value: https://sparksocial-api.onrender.com/oauth/social/callback
      - key: CANVA_REDIRECT_URI
        value: https://sparksocial-api.onrender.com/oauth/canva/callback

  - type: web
    name: sparksocial-web
    runtime: docker
    dockerfilePath: ./apps/web/Dockerfile
    dockerContext: .
    plan: starter
    envVars:
      - key: NODE_ENV
        value: production
      - key: SPARK_API_URL
        value: https://sparksocial-api.onrender.com
      - key: CLERK_SECRET_KEY
        sync: false           # set in the dashboard, never in the repo
      # Baked into the client bundle at build time — see §5.
      - key: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
        sync: false
      - key: NEXT_PUBLIC_SOCIAL_PROVIDERS
        value: google
      - key: NEXT_PUBLIC_SENTRY_DSN
        sync: false
      - key: NEXT_PUBLIC_POSTHOG_KEY
        sync: false
      - key: NEXT_PUBLIC_POSTHOG_HOST
        value: https://eu.i.posthog.com

databases:
  - name: sparksocial-db
    plan: standard
    postgresMajorVersion: "16"

envVarGroups:
  - name: sparksocial-secrets
    envVars: []               # populated in the dashboard — see §0.2
```

**On the cross-service URLs.** The Azure workflow resolved these at deploy time
off the live ingress FQDN, precisely so they could not drift after a rename.
Render's `fromService: { property: host }` returns a bare hostname with no
scheme, so it cannot produce `https://…` on its own. Render hostnames are stable
(`<service-name>.onrender.com`), so hardcoding is safe — but it *is* a hardcode,
and renaming a service now silently breaks sign-in. If you attach custom
domains, set these to those instead.

`CLERK_AUTHORIZED_PARTIES` in particular fails quietly: `apps/api/src/index.ts`
defaults it to `http://localhost:3000`, which does not throw, it just rejects
every sign-in from the deployed origin.

---

## 5. What the Dockerfiles need — less than you would expect

**Neither Dockerfile needs editing.**

- **`NEXT_PUBLIC_*` just works.** Render injects a service's environment
  variables into its Docker build as build args with the same keys, and
  `apps/web/Dockerfile` already declares each one as an `ARG`. This is the piece
  most people expect to be painful; on Render it is free. (The values are still
  baked into the client bundle at build time and cannot be changed by a runtime
  env var afterwards — that part is Next.js, not the platform.)
- **`PORT` just works.** Render injects `PORT` at runtime, which overrides the
  `ENV PORT=` line in each image.
- **The health checks stay.** Render uses `healthCheckPath`, not the Docker
  `HEALTHCHECK`, but leaving both costs nothing.

The only thing you lose is `REVISION`. On Azure it was stamped with the commit
SHA so `/health` could confirm which commit was serving. Render exposes
`RENDER_GIT_COMMIT` — either set `REVISION` from it in `render.yaml`, or read it
directly wherever `/health` reports the revision.

---

## 6. Migrations — the one that will bite you

**Do not put `npm run migrate -w @sparksocial/db` in `preDeployCommand`.**

Render's pre-deploy command runs inside the *deployed image*. The API image
installs with `npm ci --omit=dev`, and `drizzle-kit` is a **devDependency** of
`packages/db`. The command will not be there. You would only find out on the
first deploy against a schema change.

Two ways out:

**A. Keep migrations in GitHub Actions (recommended).** This is what
`deploy-azure.yml` already does, on a runner with a full `npm ci`, and the
ordering rationale in its own comments — schema before code, because new code
against an old schema fails every request while old code against a new schema is
fine — is unchanged by the platform. The Render version is strictly simpler,
because there is no Key Vault to authenticate to:

```yaml
- name: Apply database migrations
  env:
    DATABASE_URL: ${{ secrets.RENDER_DATABASE_URL }}   # external URL
  run: npm run migrate -w @sparksocial/db

- name: Trigger Render deploy
  run: curl -fsS "${{ secrets.RENDER_DEPLOY_HOOK_API }}"
```

Turn **off** auto-deploy on the API service if you do this, or the deploy races
the migration.

**B. Move `drizzle-kit` into `dependencies`** and use `preDeployCommand`. Simpler
pipeline, but it ships a build tool into the production image for the sake of one
command per deploy.

---

## 7. Cut-over

1. Provision Postgres, run `CREATE EXTENSION vector`, restore the dump (§3).
2. Create the object store and copy the blobs (§0.1). Ship the `BlobStore`
   change first — it is the only code change on the critical path.
3. Create the env group from `infra/azure/secrets.manifest`. Read the values out
   of Key Vault one last time:
   ```bash
   az keyvault secret show --vault-name "$KV" --name <name> --query value -o tsv
   ```
   Omit anything you do not have. **No blank placeholders** (§0.2).
4. Deploy both services from the Blueprint. Check the API's boot log — it
   announces which optional features are live, which is the fastest way to catch
   a secret you skipped by accident.
5. **Update every redirect URI at the vendor, before you cut traffic over.** All
   of these are registered with the hostname in them and none of them fail
   loudly: Clerk (allowed origins + redirect URLs), the WhatsApp webhook
   callback, Canva's OAuth redirect, every social platform app's redirect URI,
   the Ayrshare/engagement webhook URL.
6. Point DNS at Render. Keep the Azure resource group running, not deleted,
   until you have a full day of clean traffic.
7. Delete the Azure resource group — *after* confirming the blobs are copied and
   the dump restored. `az group delete --name "$RG" --yes` is not reversible.

---

## 8. Repo cleanup, once it is live

- `.github/workflows/deploy-azure.yml` → replace with a Render workflow (§6),
  or delete it if you use auto-deploy plus a separate migration job.
- `infra/azure/` → keep until the cut-over is proven, then delete. Its
  `secrets.manifest` is the one file worth *moving* rather than deleting: it is
  the only place the required/optional semantics are written down, and the Render
  env group has no equivalent concept.
- **`CLAUDE.md` § "Infrastructure — Azure"** — this is the important one. It is
  the file every future contributor and agent reads first, and it currently
  states as a rule that the project runs on Azure, with a substitution table and
  operational rules that will all be wrong. Rewrite it in the same shape for
  Render. Its Front Door / egress cost note also needs revisiting: if you take
  option A in §0.1, R2's zero egress is back and the note becomes obsolete rather
  than merely inaccurate.
- `packages/db/src/client.ts` and `packages/storage/src/azure.ts` header comments
  both describe Azure specifics as the reason for their design. Whether or not
  the code changes, the comments are now misleading.

---

## Sources

- [Using Docker on Render](https://render.com/docs/docker) · [Docker secrets](https://render.com/docs/docker-secrets) · [Environment variables](https://render.com/docs/configure-environment-variables)
- [Supported extensions for Render Postgres](https://render.com/docs/postgresql-extensions)
- [Persistent disks](https://render.com/docs/disks)
- [Pre-deploy command](https://render.com/changelog/predeploy-command)
