#!/usr/bin/env bash
# v9.0.187 (TD-609): adds the generated secrets a production .env needs and does not have yet; existing values are
# never changed. install.sh runs it on a new and on an existing .env.
#   ERP_SECRETS_KEY           encrypts third-party passwords at rest (src/lib/secretBox.ts; without it they are refused)
#   ERP_WEBHOOK_SECRET_TOKEN  signs outgoing webhooks (X-ERP-Signature-256)
# Usage: bash scripts/ensure-env-secrets.sh <path/to/.env>
# Keep ERP_SECRETS_KEY with the backups: encrypted values cannot be read without it.
set -euo pipefail

ENV_FILE="${1:?usage: ensure-env-secrets.sh <path/to/.env>}"
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl is required to generate secrets" >&2; exit 1; }

added=0
for key in ERP_SECRETS_KEY ERP_WEBHOOK_SECRET_TOKEN; do
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
