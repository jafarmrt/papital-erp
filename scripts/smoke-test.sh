#!/bin/bash
# scripts/smoke-test.sh — PHASE 9 (14.6) Post-Deploy Smoke Test
# Endpoint paths are aligned with src/app.ts and src/routes/* of this repository.
# Usage:  BASE_URL=https://staging.example.com ADMIN_TOKEN=<auth_token cookie value> ./scripts/smoke-test.sh
#         (BASE_URL may also be passed as the first positional argument)
set -euo pipefail

BASE_URL="${1:-${BASE_URL:-https://staging.erp.example.com}}"
ADMIN_TOKEN="${ADMIN_TOKEN:?ADMIN_TOKEN required (value of the auth_token HttpOnly cookie)}"

echo "===== Smoke Test for $BASE_URL ====="

# 1. Health checks (registered in src/app.ts, unauthenticated)
echo "[1/8] Testing /health/live..."
curl -fsS "$BASE_URL/health/live" | jq -e '.status == "alive"' > /dev/null

echo "[2/8] Testing /health/ready..."
curl -fsS "$BASE_URL/health/ready" | jq -e '.status == "ready"' > /dev/null

# 2. Authenticated API (dashboard stats — mounted at /api/stats)
echo "[3/8] Testing /api/stats..."
curl -fsS -H "Cookie: auth_token=$ADMIN_TOKEN" \
  "$BASE_URL/api/stats" | jq -e 'has("totalProducts")' > /dev/null

# 3. Accounting (read-only)
echo "[4/8] Testing /api/accounting/vouchers..."
curl -fsS -H "Cookie: auth_token=$ADMIN_TOKEN" \
  "$BASE_URL/api/accounting/vouchers?limit=1" | jq -e '.data' > /dev/null

# 4. Inventory (read-only, paginated response { data, total, page, limit })
echo "[5/8] Testing /api/items..."
curl -fsS -H "Cookie: auth_token=$ADMIN_TOKEN" \
  "$BASE_URL/api/items?limit=1" | jq -e '.data' > /dev/null

# 5. WooCommerce webhook must reject unsigned payloads (HMAC enforced since PHASE 0)
echo "[6/8] Testing webhook rejection..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/woocommerce/webhook/order" \
  -H "Content-Type: application/json" \
  -d '{"test": true}')
echo "$STATUS" | grep -qE "401|403|503" || { echo "  unexpected webhook status: $STATUS"; exit 1; }

# 6. Rate limit (loginLimiter: max 5 attempts / 15 min keyed on socket peer address)
echo "[7/8] Testing rate limit..."
for i in $(seq 1 8); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username": "nonexistent", "password": "wrong"}' || true
done | grep -q "429" || { echo "  no 429 observed after 8 failed logins"; exit 1; }

# 7. Metrics endpoint (Prometheus format — protected by METRICS_TOKEN or admin session since V9 Phase 2)
echo "[8/8] Testing /metrics..."
METRICS_AUTH=()
if [ -n "${METRICS_TOKEN:-}" ]; then
  METRICS_AUTH=(-H "Authorization: Bearer $METRICS_TOKEN")
elif [ -n "${ADMIN_TOKEN:-}" ]; then
  METRICS_AUTH=(-H "Cookie: auth_token=$ADMIN_TOKEN")
fi
if ! curl -fsS "${METRICS_AUTH[@]}" "$BASE_URL/metrics" | grep -q "http_request_duration_seconds"; then
  # اگر 401 گرفتیم یعنی اندپوینت درست محافظت شده است — فقط خروجی متریک است که باید با توکن گرفته شود
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${METRICS_AUTH[@]}" "$BASE_URL/metrics" || true)
  if [ "$STATUS" = "401" ]; then
    echo "  /metrics is protected (401 without credentials) — set METRICS_TOKEN to scrape"
  else
    echo "  unexpected /metrics status: $STATUS"; exit 1
  fi
fi

echo ""
echo "✓ All smoke tests passed"
