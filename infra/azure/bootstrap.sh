#!/usr/bin/env bash
# SparkSocial — Azure bootstrap. Run ONCE, from your machine, after `az login`.
#
# The Claude Code sandbox cannot reach Azure (network allowlist), so everything
# Azure-side runs here. This script is idempotent: re-running it is safe.
#
# It creates:
#   - a resource group
#   - Azure Container Registry
#   - a Container Apps environment + the API app
#   - PostgreSQL Flexible Server with pgvector allow-listed
#   - a storage account for Blob (assets) and Queues (jobs)
#   - Key Vault, with the DB connection string stored as a secret
#   - a managed identity for the app, granted pull + secret-get
#   - an app registration federated to this GitHub repo for OIDC deploys
#
# It never prints or stores a credential in the repo. The DB password is
# generated here, written straight to Key Vault, and never echoed.
#
#   chmod +x infra/azure/bootstrap.sh
#   ./infra/azure/bootstrap.sh
#
set -euo pipefail

# ── Settings — edit these ─────────────────────────────────────────────
LOCATION="${LOCATION:-westeurope}"
PREFIX="${PREFIX:-sparksocial}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
GITHUB_REPO="${GITHUB_REPO:-}"           # e.g. "yourorg/sparksocial" — REQUIRED
PG_ADMIN_USER="${PG_ADMIN_USER:-sparkadmin}"

RG="${PREFIX}-${ENVIRONMENT}-rg"
ACR="${PREFIX}${ENVIRONMENT}acr"          # ACR names: alphanumeric only, globally unique
CAE="${PREFIX}-${ENVIRONMENT}-env"
APP="${PREFIX}-${ENVIRONMENT}-api"
WEB_APP="${PREFIX}-${ENVIRONMENT}-web"
PG="${PREFIX}-${ENVIRONMENT}-pg"
STORAGE="${PREFIX}${ENVIRONMENT}st"
KV="${PREFIX}-${ENVIRONMENT}-kv"
IDENTITY="${PREFIX}-${ENVIRONMENT}-id"
APP_REG="${PREFIX}-${ENVIRONMENT}-github-oidc"

if [[ -z "$GITHUB_REPO" ]]; then
  echo "Set GITHUB_REPO first, e.g.  GITHUB_REPO=yourorg/sparksocial ./infra/azure/bootstrap.sh" >&2
  exit 1
fi

SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"
echo "▸ Subscription: $SUBSCRIPTION_ID"
echo "▸ Resource group: $RG  ($LOCATION)"

step() { echo; echo "── $1 ─────────────────────────────────────"; }

# ── 1. Resource group ────────────────────────────────────────────────
step "Resource group"
az group create --name "$RG" --location "$LOCATION" --output none

# ── 2. Container Registry ────────────────────────────────────────────
step "Container Registry"
az acr create --resource-group "$RG" --name "$ACR" --sku Basic --output none
# Admin user stays OFF — the app pulls with its managed identity, not a password.
az acr update --name "$ACR" --admin-enabled false --output none

# ── 3. Managed identity for the running app ──────────────────────────
step "Managed identity"
az identity create --resource-group "$RG" --name "$IDENTITY" --output none
IDENTITY_ID="$(az identity show -g "$RG" -n "$IDENTITY" --query id -o tsv)"
IDENTITY_PRINCIPAL="$(az identity show -g "$RG" -n "$IDENTITY" --query principalId -o tsv)"
ACR_ID="$(az acr show -n "$ACR" --query id -o tsv)"

az role assignment create \
  --assignee-object-id "$IDENTITY_PRINCIPAL" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPull --scope "$ACR_ID" --output none 2>/dev/null || echo "  (AcrPull already assigned)"

# ── 4. PostgreSQL Flexible Server + pgvector ─────────────────────────
step "PostgreSQL Flexible Server"
PG_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"

az postgres flexible-server create \
  --resource-group "$RG" --name "$PG" --location "$LOCATION" \
  --admin-user "$PG_ADMIN_USER" --admin-password "$PG_PASSWORD" \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
  --version 16 --yes --output none 2>/dev/null || echo "  (server exists — keeping it)"

# pgvector must be allow-listed as a server parameter BEFORE migrations run, or
# `CREATE EXTENSION vector` fails. This is the step that is easy to miss.
az postgres flexible-server parameter set \
  --resource-group "$RG" --server-name "$PG" \
  --name azure.extensions --value vector --output none

az postgres flexible-server db create \
  --resource-group "$RG" --server-name "$PG" --database-name sparksocial \
  --output none 2>/dev/null || true

PG_HOST="$(az postgres flexible-server show -g "$RG" -n "$PG" --query fullyQualifiedDomainName -o tsv)"
PG_CONN="postgresql://${PG_ADMIN_USER}:${PG_PASSWORD}@${PG_HOST}:5432/sparksocial?sslmode=require"

# ── 5. Storage: Blob for assets, Queues for jobs ─────────────────────
step "Storage account"
az storage account create \
  --resource-group "$RG" --name "$STORAGE" --location "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 \
  --allow-blob-public-access false --output none 2>/dev/null || echo "  (exists)"

az role assignment create \
  --assignee-object-id "$IDENTITY_PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope "$(az storage account show -g "$RG" -n "$STORAGE" --query id -o tsv)" \
  --output none 2>/dev/null || echo "  (blob role already assigned)"

# The container `asset.upload_url` writes into. Private: every read goes through a
# short-lived user-delegation SAS, so there is no anonymous URL to leak. Created
# with --auth-mode login so this uses your `az login`, not an account key —
# account keys are the credential CLAUDE.md forbids handling at all.
az storage container create \
  --account-name "$STORAGE" --name assets --auth-mode login \
  --public-access off --output none 2>/dev/null || echo "  (assets container exists)"

# ── 6. Key Vault — the only place the connection string lives ────────
step "Key Vault"
az keyvault create \
  --resource-group "$RG" --name "$KV" --location "$LOCATION" \
  --enable-rbac-authorization true --output none 2>/dev/null || echo "  (exists)"

KV_ID="$(az keyvault show -n "$KV" --query id -o tsv)"
ME="$(az ad signed-in-user show --query id -o tsv)"

az role assignment create --assignee-object-id "$ME" --assignee-principal-type User \
  --role "Key Vault Secrets Officer" --scope "$KV_ID" --output none 2>/dev/null || true
az role assignment create --assignee-object-id "$IDENTITY_PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope "$KV_ID" --output none 2>/dev/null || true

echo "  Waiting for RBAC to propagate…"; sleep 30
az keyvault secret set --vault-name "$KV" --name database-url --value "$PG_CONN" --output none
echo "  DATABASE_URL stored in Key Vault. It is not printed here and not in the repo."

# ── 7. Container Apps ────────────────────────────────────────────────
step "Container Apps"
az extension add --name containerapp --upgrade --only-show-errors --output none
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait

az containerapp env create \
  --resource-group "$RG" --name "$CAE" --location "$LOCATION" --output none 2>/dev/null || echo "  (env exists)"

# Seeded with the public hello image; the deploy workflow replaces it on first run.
az containerapp create \
  --resource-group "$RG" --name "$APP" --environment "$CAE" \
  --image mcr.microsoft.com/k8se/quickstart:latest \
  --target-port 8080 --ingress external \
  --user-assigned "$IDENTITY_ID" \
  --registry-server "${ACR}.azurecr.io" --registry-identity "$IDENTITY_ID" \
  --min-replicas 1 --max-replicas 3 \
  --output none 2>/dev/null || echo "  (app exists — the deploy workflow will update it)"

# Same environment, same identity, same registry — a second app, not a
# second everything. Seeded with the same placeholder image; the deploy
# workflow's web job replaces it. `--min-replicas 1` (not 0): scale-to-zero
# would mean the first request after any idle period eats a cold start on
# top of Azure's own container start time, which is a worse tradeoff for a
# user-facing app than for the API this environment already runs at min 1.
az containerapp create \
  --resource-group "$RG" --name "$WEB_APP" --environment "$CAE" \
  --image mcr.microsoft.com/k8se/quickstart:latest \
  --target-port 3000 --ingress external \
  --user-assigned "$IDENTITY_ID" \
  --registry-server "${ACR}.azurecr.io" --registry-identity "$IDENTITY_ID" \
  --min-replicas 1 --max-replicas 3 \
  --output none 2>/dev/null || echo "  (web app exists — the deploy workflow will update it)"

# ── 8. GitHub OIDC federation — no secrets, ever ─────────────────────
step "GitHub OIDC federation"
APP_ID="$(az ad app list --display-name "$APP_REG" --query '[0].appId' -o tsv)"
if [[ -z "$APP_ID" ]]; then
  APP_ID="$(az ad app create --display-name "$APP_REG" --query appId -o tsv)"
  az ad sp create --id "$APP_ID" --output none
fi
SP_ID="$(az ad sp show --id "$APP_ID" --query id -o tsv)"

az role assignment create --assignee-object-id "$SP_ID" --assignee-principal-type ServicePrincipal \
  --role Contributor --scope "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RG}" \
  --output none 2>/dev/null || echo "  (Contributor already assigned)"

# Contributor on the resource group does *not* include reading vault secrets:
# the vault is RBAC-authorized, and data-plane access is a separate role from
# management-plane rights. Without this the deploy fails at the migration step
# with a 403 on `database-url`, which reads like a missing secret rather than a
# missing permission.
az role assignment create --assignee-object-id "$SP_ID" --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope "$KV_ID" \
  --output none 2>/dev/null || echo "  (Key Vault Secrets User already assigned to CI)"

# One credential per trust context. `ref:refs/heads/main` covers pushes to main;
# `environment:` covers the manual workflow_dispatch runs.
for SUBJECT in "repo:${GITHUB_REPO}:ref:refs/heads/main" "repo:${GITHUB_REPO}:environment:${ENVIRONMENT}"; do
  NAME="gh-$(echo "$SUBJECT" | tr ':/' '--' | tail -c 60)"
  az ad app federated-credential create --id "$APP_ID" --parameters "{
    \"name\": \"${NAME}\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"${SUBJECT}\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" --output none 2>/dev/null || echo "  (credential for ${SUBJECT} exists)"
done

# ── Done ─────────────────────────────────────────────────────────────
cat <<EOF

════════════════════════════════════════════════════════════════════
Azure is ready. Now set these as GitHub Actions **variables** (not
secrets — none of them are sensitive, and OIDC means there is no
password to store):

  gh variable set AZURE_CLIENT_ID              --body "$APP_ID"
  gh variable set AZURE_TENANT_ID              --body "$TENANT_ID"
  gh variable set AZURE_SUBSCRIPTION_ID        --body "$SUBSCRIPTION_ID"
  gh variable set AZURE_RESOURCE_GROUP         --body "$RG"
  gh variable set AZURE_ACR_NAME               --body "$ACR"
  gh variable set AZURE_CONTAINERAPP_NAME      --body "$APP"
  gh variable set AZURE_CONTAINERAPP_WEB_NAME  --body "$WEB_APP"
  gh variable set AZURE_STORAGE_ACCOUNT        --body "$STORAGE"
  gh variable set AZURE_KEY_VAULT_NAME         --body "$KV"

Then push to main, or run the "Deploy to Azure" workflow manually.

Still to do before the app is useful:
  • Put the application secrets in Key Vault. Nothing else reads them — the
    deploy wires each as a keyvaultref, so a key absent from the vault leaves
    its feature cleanly unavailable rather than half-configured:
      ./infra/azure/secrets.sh                      # set vs missing
      ./infra/azure/secrets.sh set OPENAI_API_KEY
      ./infra/azure/secrets.sh import apps/api/.env
    OAUTH_STATE_SECRET is not a vendor key and gates *all* social connect.
    Generate one:  openssl rand -base64 32
  • Add your IP to the Postgres firewall to run migrations:
      az postgres flexible-server firewall-rule create -g $RG -n $PG \\
        --rule-name dev --start-ip-address <your-ip> --end-ip-address <your-ip>
  • CREATE EXTENSION vector;   (pgvector is allow-listed, not yet created)
  • Set the web app's own secrets as GitHub Actions secrets (build-time
    NEXT_PUBLIC_* values, baked into the image, not read at runtime):
      gh secret set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY --body "<from Clerk>"
    Optional: NEXT_PUBLIC_SENTRY_DSN, NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST.
  • Put Front Door in front of both Container Apps before serving media —
    Blob egress is billed, unlike the R2 the plan originally assumed.
════════════════════════════════════════════════════════════════════
EOF
