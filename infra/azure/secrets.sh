#!/usr/bin/env bash
#
# Put application secrets into Key Vault, and report what is still missing.
#
# Key Vault is the only place these live. Not the repo, not GitHub Actions
# secrets, not the Container App's plaintext environment — the deploy workflow
# wires each one as a `keyvaultref`, so the value is read at revision start by
# the app's managed identity and never passes through CI at all.
#
# That is the point of moving them here rather than to Container App secrets:
# rotating a key becomes `az keyvault secret set` with no deploy, and reads are
# audited per secret rather than inferred from who could see the resource.
#
#   ./secrets.sh                  — show what the vault holds and what it lacks
#   ./secrets.sh set NAME         — set one, prompted, not echoed
#   ./secrets.sh import path/.env — take values from a local env file
#
# Never pass a secret as a command-line argument: it lands in your shell
# history and in the process table.
#
# Prerequisites: `az login`, and RBAC that lets you write secrets. The bootstrap
# script grants the operator "Key Vault Secrets Officer" for exactly this.
set -euo pipefail

PREFIX="${PREFIX:-sparksocial}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
KV="${KV:-${PREFIX}-${ENVIRONMENT}-kv}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$HERE/secrets.manifest"

[ -f "$MANIFEST" ] || { echo "No manifest at $MANIFEST" >&2; exit 1; }

# ── The manifest is the schema; this is the only place it is parsed ────────
# Emits "ENV_VAR kv-name tier" per line, comments and blanks dropped.
manifest() {
  grep -vE '^\s*(#|$)' "$MANIFEST" | awk '{print $1, $2, $3}'
}

kv_name_for() {
  manifest | awk -v e="$1" '$1 == e { print $2; found=1 } END { if (!found) exit 1 }'
}

vault_has() {
  az keyvault secret show --vault-name "$KV" --name "$1" --query id -o tsv >/dev/null 2>&1
}

# ── status ────────────────────────────────────────────────────────────────
cmd_status() {
  echo "Key Vault: $KV"
  echo

  local present=0 missing_required=0 missing_optional=0

  # One list call, not one show per secret: a 40-line manifest against a remote
  # vault is otherwise 40 round trips for a read-only summary.
  local held
  held="$(az keyvault secret list --vault-name "$KV" --query '[].name' -o tsv 2>/dev/null || true)"
  if [ -z "$held" ]; then
    echo "  (cannot read the vault — check 'az login' and your role assignment)"
    echo
  fi

  while read -r env kv tier; do
    if printf '%s\n' "$held" | grep -qx "$kv"; then
      printf '  set      %-30s %s\n' "$env" "$kv"
      present=$((present + 1))
    elif [ "$tier" = required ]; then
      printf '  MISSING  %-30s %s   (deploy will fail)\n' "$env" "$kv"
      missing_required=$((missing_required + 1))
    else
      printf '  absent   %-30s %s   (its feature stays unavailable)\n' "$env" "$kv"
      missing_optional=$((missing_optional + 1))
    fi
  done < <(manifest)

  echo
  echo "  $present set · $missing_required required missing · $missing_optional optional absent"

  if [ "$missing_required" -gt 0 ]; then
    echo
    echo "  Set the required ones before deploying:  ./secrets.sh set DATABASE_URL"
    return 1
  fi
}

# ── set one, without it reaching the shell history ────────────────────────
cmd_set() {
  local env="${1:-}"
  [ -n "$env" ] || { echo "Usage: ./secrets.sh set ENV_VAR_NAME" >&2; exit 1; }

  local kv
  kv="$(kv_name_for "$env")" || {
    echo "\"$env\" is not in the manifest. Add it to secrets.manifest first, so the" >&2
    echo "deploy step knows to wire it." >&2
    exit 1
  }

  local value
  # -s so it is not echoed; read from the terminal rather than an argument.
  read -rsp "Value for $env (not echoed): " value
  echo
  [ -n "$value" ] || { echo "Empty. Nothing written — an empty secret is worse than an absent one." >&2; exit 1; }

  az keyvault secret set --vault-name "$KV" --name "$kv" --value "$value" --output none
  echo "  $env -> $KV/$kv"
  echo "  Deploy to pick it up: the app reads it at revision start."
}

# ── bulk import from a local env file ─────────────────────────────────────
cmd_import() {
  local file="${1:-}"
  [ -f "$file" ] || { echo "Usage: ./secrets.sh import path/to/.env" >&2; exit 1; }

  local set_count=0 skipped=0
  while read -r env kv tier; do
    # Only the manifest's own names, so an unrelated line in the env file is
    # never uploaded by accident.
    local line value
    line="$(grep -E "^${env}=" "$file" | tail -1 || true)"
    [ -n "$line" ] || { skipped=$((skipped + 1)); continue; }

    value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    if [ -z "$value" ]; then
      # A blank in the source file means "not configured", which must stay
      # absent from the vault rather than becoming an empty secret.
      skipped=$((skipped + 1))
      continue
    fi

    az keyvault secret set --vault-name "$KV" --name "$kv" --value "$value" --output none
    printf '  imported %-30s -> %s\n' "$env" "$kv"
    set_count=$((set_count + 1))
  done < <(manifest)

  echo
  echo "  $set_count imported, $skipped absent or blank in $file"
  echo "  Values in that file are now in the vault. It is still gitignored; keep it that way."
}

case "${1:-status}" in
  status) cmd_status ;;
  set)    shift; cmd_set "$@" ;;
  import) shift; cmd_import "$@" ;;
  *)      echo "Usage: ./secrets.sh [status|set ENV_VAR|import FILE]" >&2; exit 1 ;;
esac
