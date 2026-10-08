#!/usr/bin/env bash
# v9.0.187 (TD-609): adds the generated secrets a production .env needs and does not have yet; existing values are
# never changed. install.sh runs it on a new and on an existing .env.
#   ERP_SECRETS_KEY           encrypts third-party passwords, WooCommerce keys and webhook secrets at rest
#                             (src/lib/secretBox.ts; v9.0.361, TD-898; without it new ones are refused)
#   ERP_WEBHOOK_SECRET_TOKEN  signs outgoing webhooks (X-ERP-Signature-256)
#   METRICS_TOKEN             lets scripts/monitor.sh read /metrics (v10.0.4, TD-1021); the service reads it at start
# Usage: bash scripts/ensure-env-secrets.sh <path/to/.env>
# ERP_SECRETS_KEY travels inside the encrypted off-server copy of .env (scripts/backup-offsite.sh, v10.0.2, TD-957).
set -euo pipefail

ENV_FILE="${1:?usage: ensure-env-secrets.sh <path/to/.env>}"
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl is required to generate secrets" >&2; exit 1; }

added=0
for key in ERP_SECRETS_KEY ERP_WEBHOOK_SECRET_TOKEN METRICS_TOKEN; do
  if grep -qE "^${key}=.+" "$ENV_FILE"; then
    continue
  fi
  if grep -qE "^${key}=" "$ENV_FILE"; then
    echo "WARN: ${key} is empty in $ENV_FILE; set it by hand (an empty value is kept)" >&2
    continue
  fi
  # a file without a final newline must not glue the new line to its last value
  [ -z "$(tail -c1 "$ENV_FILE")" ] || echo >> "$ENV_FILE"
  echo "${key}=$(openssl rand -hex 32)" >> "$ENV_FILE"
  echo "Added ${key} to $ENV_FILE"
  added=$((added + 1))
done
chmod 600 "$ENV_FILE"
[ "$added" -gt 0 ] || echo "All generated secrets already present in $ENV_FILE"
