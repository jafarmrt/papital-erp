#!/bin/bash
# v8.0.45: آماده‌سازی جلسه Claude Code روی وب (کانتینر تازه) تا lint، Vitest، npm test و build بی‌کار دستی اجرا شوند:
#   ۱) وابستگی‌های npm دقیقاً از package-lock.json (npm ci، فقط وقتی node_modules نیست یا از lock قدیمی‌تر است)
#   ۲) PostgreSQL 16 محلی روشن، رمز کاربر postgres همان مقدار job «test» در CI (test) و پایگاه‌داده‌های erp_test و erp_e2e
# متغیرهای محیط آزمون CI در scripts/ci-test-env.sh است: `source scripts/ci-test-env.sh && npm test`.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# ── ۱. وابستگی‌ها ─────────────────────────────────────────────
if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "[session-start] npm ci"
  npm ci --no-audit --no-fund
else
  echo "[session-start] node_modules matches package-lock.json"
fi

# ── ۲. PostgreSQL 16 ──────────────────────────────────────────
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "[session-start] local PostgreSQL is not installed; database tests will not run" >&2
  exit 0
fi

status="$(pg_lsclusters 16 main 2>/dev/null | awk 'NR>1 {print $4}')"
if [ "$status" != "online" ]; then
  echo "[session-start] starting PostgreSQL 16"
  pg_ctlcluster 16 main start
fi

for _ in $(seq 1 30); do
  pg_isready -q -h localhost -p 5432 && break
  sleep 1
done

as_postgres() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qtA "$@"; }
as_postgres -c "ALTER USER postgres PASSWORD 'test'"
for db in erp_test erp_e2e; do
  if [ "$(as_postgres -c "SELECT 1 FROM pg_database WHERE datname = '$db'")" != "1" ]; then
    echo "[session-start] creating database $db"
    as_postgres -c "CREATE DATABASE $db"
  fi
done

echo "[session-start] ready: node_modules and PostgreSQL 16 (erp_test, erp_e2e)"
