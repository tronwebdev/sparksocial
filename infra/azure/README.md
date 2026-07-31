# Shipping SparkSocial to GitHub and Azure

Neither `gh` nor `az` is installed on this machine, so the steps below are yours to run.
Everything they need is already committed.

## 1. Install the CLIs

```bash
winget install --id GitHub.cli -e
winget install --id Microsoft.AzureCLI -e
```

Reopen the terminal afterwards so both land on `PATH`.

## 2. Create the GitHub repo and push

The repo is initialised with one commit on `main`.

```bash
gh auth login
gh repo create sparksocial --private --source=. --remote=origin --push
```

**Private is deliberate.** The repo carries the PRD, the content-engine spec, and the
approvals register — competitive material, and the spec calls the engine the whole
product. Swap `--private` for `--public` only if that is a decision you have made.

CI runs immediately on push: typecheck, 83 tests, the 100% policy-coverage threshold,
the genome-isolation guard, and a gitleaks scan of the history.

## 3. Provision Azure

`az login` first, then run the bootstrap once. It is idempotent.

```bash
az login
GITHUB_REPO=<your-org>/sparksocial ./infra/azure/bootstrap.sh
```

It creates the resource group, Container Registry, Container Apps environment and app,
PostgreSQL Flexible Server **with `pgvector` allow-listed**, a storage account for Blob
and Queues, Key Vault, a managed identity wired to pull images and read secrets, and an
app registration federated to your repo for OIDC.

The generated database password goes straight into Key Vault. It is never printed and
never written to the repo.

## 4. Wire the deploy

The script ends by printing six `gh variable set` commands. Run them, then push to
`main` — or trigger **Deploy to Azure** manually.

They are variables, not secrets, because OIDC means there is no credential to store.
The workflow requests a short-lived token per run and Azure trusts it because of the
federation created in step 3. There is no `AZURE_CREDENTIALS` secret and there should
never be one.

The deploy re-runs typecheck and tests before touching Azure, then polls `/health`
until it reports the commit SHA it just pushed. A deploy that does not converge fails
the run rather than reporting success — `az containerapp update` returning 0 only means
the API accepted the request, not that traffic shifted.

## 5. Before the app is actually useful

The bootstrap prints these too:

- Add your IP to the Postgres firewall, then `CREATE EXTENSION vector;` — the extension
  is allow-listed by the script but not created.
- Point the app at `DATABASE_URL` in Key Vault via its managed identity. Audit rows are
  currently in-memory.
- Replace `apps/api/src/dev-auth.ts` with Clerk. It reads tenancy from request headers,
  which makes `genomeId` forgeable — the exact isolation bypass `scoped.ts` exists to
  prevent. `index.ts` refuses to boot in production with it unless `ALLOW_DEV_AUTH=true`.
- Put Front Door in front of the Container App before serving any media. Blob Storage
  bills egress; the R2 the plan originally assumed did not.

## Local development

```bash
npm ci
npm test
PORT=8123 npx tsx apps/api/src/index.ts
```

```bash
curl -s localhost:8123/v1/tools
```

That last one returns exactly what SPARK sees. If a capability is missing from it, the
UI must not be able to reach it either.
