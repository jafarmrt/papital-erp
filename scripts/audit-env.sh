#!/bin/bash
# scripts/audit-env.sh — PHASE 9 (14.2) Environment Variables Audit
# Validates that all required production environment variables are present and sane.
# Run in staging AND production before every deploy:
#   set -a; source .env.production; set +a; ./scripts/audit-env.sh
set -euo pipefail

REQUIRED_VARS=(
  NODE_ENV DATABASE_URL JWT_SECRET ALLOWED_ORIGINS
  ERP_SETUP_TOKEN ERP_WEBHOOK_SECRET_TOKEN
)

WARN_IF_EMPTY=(
  POSTGRES_SSL_CA_PATH WOOCOMMERCE_SSL_CA_PATH
)

ERRORS=0
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "❌ MISSING: $var"
    ERRORS=$((ERRORS + 1))
  fi
done

for var in "${WARN_IF_EMPTY[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "⚠️ WARNING: $var is empty"
  fi
done

# JWT_SECRET length check (>= 32 chars, generate with: openssl rand -hex 48)
if [ -n "${JWT_SECRET:-}" ] && [ ${#JWT_SECRET} -lt 32 ]; then
  echo "❌ JWT_SECRET must be at least 32 characters"
  ERRORS=$((ERRORS + 1))
fi

# NODE_ENV check
if [ "${NODE_ENV:-}" != "production" ]; then
  echo "❌ NODE_ENV must be 'production'"
  ERRORS=$((ERRORS + 1))
fi

# DATABASE_URL must require TLS in production (sslmode=require or verify-full)
if [ -n "${DATABASE_URL:-}" ] && ! echo "$DATABASE_URL" | grep -qE "sslmode=(require|verify-ca|verify-full)"; then
  echo "⚠️ WARNING: DATABASE_URL should include sslmode=require (or verify-full) in production"
fi

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "Total errors: $ERRORS"
  exit 1
fi

echo "✓ All required environment variables are set"
