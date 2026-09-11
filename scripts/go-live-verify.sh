#!/bin/bash
# ============================================================
#  Papital ERP — Go-Live Readiness Verification
#  One-shot server-side sweep executed AFTER install + setup.
#  Validates: environment safety, systemd state, health probes,
#  version consistency, database + migrations, Outbox/DLQ,
#  backup infrastructure, HTTPS, and metrics exposure.
#
#  Usage:
#    sudo bash scripts/go-live-verify.sh [BASE_URL]
#    BASE_URL defaults to http://localhost:3000
#  Exit code: 0 = all checks passed, 1 = one or more FAILURES.
#  (WARN lines do not fail the run.)
# ============================================================
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/papital-erp}"
SERVICE_NAME="${SERVICE_NAME:-papital-erp}"
BASE_URL="${1:-http://localhost:3000}"
cd "$APP_DIR" 2>/dev/null || true

PASS=0; FAIL=0; WARN=0
ok()    { echo "  [PASS] $*"; PASS=$((PASS+1)); }
bad()   { echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
warnc() { echo "  [WARN] $*"; WARN=$((WARN+1)); }

echo "=============================================================="
echo " Papital ERP — Go-Live Readiness Verification"
echo " Base URL : $BASE_URL"
echo " Time     : $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "=============================================================="

# ---------- 0) Load environment ----------
echo "[0] Environment (.env)"
if [ -f "$APP_DIR/.env" ]; then
  ok ".env found at $APP_DIR/.env"
else
  bad ".env not found — cannot continue."; echo "RESULT: ${FAIL} failure(s)"; exit 1
fi
set -a; . "$APP_DIR/.env"; set +a

env_has() { grep -qE "^$1=" "$APP_DIR/.env"; }
env_val() { grep -E "^$1=" "$APP_DIR/.env" | head -1 | cut -d= -f2-; }

if [ "$(env_val NODE_ENV)" = "production" ]; then ok "NODE_ENV=production"; else bad "NODE_ENV must be 'production'"; fi
env_has JWT_SECRET || bad "JWT_SECRET missing"
if [ "$(env_val JWT_SECRET | wc -c)" -ge 33 ]; then ok "JWT_SECRET present (>= 32 chars)"; else bad "JWT_SECRET too short (< 32 chars)"; fi
env_has DATABASE_URL || bad "DATABASE_URL missing"
env_has ERP_SETUP_TOKEN || warnc "ERP_SETUP_TOKEN missing (only acceptable if /setup is fully consumed AND token disabled)"

# Danger flags must be OFF
SEED_FLAG="$(env_val ALLOW_SEED_IN_PRODUCTION)"
if [ "$SEED_FLAG" = "false" ] || [ -z "$SEED_FLAG" ]; then
  ok "ALLOW_SEED_IN_PRODUCTION is off"
else
  bad "ALLOW_SEED_IN_PRODUCTION must be false/absent in production"
fi
grep -qE '^ERP_ALLOW_TEST_CLEANUP=1' "$APP_DIR/.env" \
  && bad "ERP_ALLOW_TEST_CLEANUP=1 detected — MUST NOT be enabled in production" \
  || ok "ERP_ALLOW_TEST_CLEANUP off"
grep -qE '^ENABLE_TEST_ENDPOINTS=true' "$APP_DIR/.env" \
  && bad "ENABLE_TEST_ENDPOINTS=true detected — MUST NOT be enabled in production" \
  || ok "ENABLE_TEST_ENDPOINTS off"
env_has ALLOWED_ORIGINS || warnc "ALLOWED_ORIGINS not set — CORS may block the frontend domain"
env_has LOG_DIR || ok "LOG_DIR defaulting to logs/"

# ---------- 1) Service state ----------
echo "[1] Service state (systemd)"
if ! command -v systemctl >/dev/null 2>&1; then
  warnc "systemctl not available — service checks skipped"
else
  if ! systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    # Auto-detect the systemd unit managing the running app (unit may have a custom name)
    RUNNING_PID="$(pgrep -f 'dist/server.cjs' | head -1 || true)"
    if [ -n "$RUNNING_PID" ]; then
      DETECTED="$(systemctl status "$RUNNING_PID" 2>/dev/null | grep -oE '[a-zA-Z0-9_.@-]+\.service' | head -1 | sed 's/\.service$//' || true)"
      if [ -n "$DETECTED" ] && [ "$DETECTED" != "systemd" ]; then
        warnc "No unit named '${SERVICE_NAME}' found — detected managing unit: '${DETECTED}' (align update.sh/verifier via SERVICE_NAME=<name> or rename the unit)"
        SERVICE_NAME="$DETECTED"
      fi
    fi
  fi
  if systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    [ "$(systemctl is-active "$SERVICE_NAME")" = "active" ] && ok "systemd unit active ($SERVICE_NAME)" || bad "systemd unit is not active"
    [ "$(systemctl is-enabled "$SERVICE_NAME")" = "enabled" ] && ok "systemd unit enabled on boot" || warnc "systemd unit not enabled — service won't start on reboot"
  else
    warnc "systemd unit '$SERVICE_NAME' not found (pm2/manual run?)"
  fi
fi

# ---------- 2) Health probes ----------
echo "[2] Health probes ($BASE_URL)"
probe() { curl -fsS --max-time 5 "$BASE_URL$1" 2>/dev/null; }
LIVE="$(probe /health/live || true)"
echo "$LIVE" | grep -q '"alive"' && ok "/health/live alive" || bad "/health/live failed: $LIVE"
READY="$(probe /health/ready || true)"
echo "$READY" | grep -q '"ready"' && ok "/health/ready ready" || bad "/health/ready failed: $READY"
STARTUP="$(probe /health/startup || true)"
[ -n "$STARTUP" ] && ok "/health/startup responds" || warnc "/health/startup did not respond"

# ---------- 3) Version consistency ----------
echo "[3] Version consistency"
PKG_VER="$(node -p "require('$APP_DIR/package.json').version" 2>/dev/null || true)"
HEALTH_VER="$(probe /health | grep -oE '"version":"[^"]+"' | head -1 | cut -d'"' -f4 || true)"
if [ -n "$PKG_VER" ] && [ "$PKG_VER" = "$HEALTH_VER" ]; then
  ok "Runtime version matches package.json (v$PKG_VER)"
else
  bad "Version mismatch: package.json=v$PKG_VER /health=v$HEALTH_VER"
fi

# ---------- 4) Database & migrations ----------
echo "[4] Database & migrations"
if command -v pg_isready >/dev/null 2>&1 && pg_isready -q -d "$DATABASE_URL" 2>/dev/null; then
  ok "PostgreSQL accepts connections (DATABASE_URL)"
else
  bad "PostgreSQL unreachable via DATABASE_URL (pg_isready)"
fi
if command -v psql >/dev/null 2>&1; then
  LAST_MIG="$(psql "$DATABASE_URL" -tAc "SELECT coalesce((SELECT name FROM migrations_log ORDER BY applied_at DESC LIMIT 1),'NONE');" 2>/dev/null || echo "?")"
  echo "       Latest migration: $LAST_MIG"
  [ "$LAST_MIG" != "?" ] && ok "migrations_log readable" || warnc "migrations_log not readable via psql"
  PENDING="$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM outbox_events WHERE status='pending';" 2>/dev/null || echo "?")"
  DLQ="$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM dead_letter_events WHERE status='pending';" 2>/dev/null || echo "?")"
  echo "       Outbox pending: $PENDING | DLQ pending: $DLQ"
  if [ "$PENDING" != "?" ] && [ "$PENDING" -le 50 ]; then ok "Outbox backlog under control ($PENDING pending)"; else warnc "Outbox backlog high or unreadable ($PENDING)"; fi
  if [ "$DLQ" != "?" ] && [ "$DLQ" -eq 0 ]; then ok "Dead letter queue empty"; else warnc "DLQ has $DLQ pending item(s) — review /events/dlq"; fi
else
  warnc "psql not installed — DB-level checks skipped"
fi

# ---------- 5) Backup infrastructure ----------
echo "[5] Backup infrastructure"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp}"
if [ -d "$BACKUP_DIR" ]; then
  ok "Backup directory exists: $BACKUP_DIR"
  N_DUMP="$(find "$BACKUP_DIR" -name 'erp_*.dump.gz' 2>/dev/null | wc -l)"
  [ "$N_DUMP" -ge 1 ] && ok "Backups present ($N_DUMP dump archive(s))" || warnc "No backup archives yet — run scripts/backup.sh now"
else
  bad "Backup directory missing: $BACKUP_DIR"
fi
if grep -rq "backup.sh" /etc/cron.d/ /etc/crontab /var/spool/cron 2>/dev/null; then
  ok "Backup cron entry found"
else
  bad "No backup cron entry found (Phase 6 of GO_LIVE_CHECKLIST.md)"
fi
if [ -d "$APP_DIR/public/uploads" ]; then
  ok "Uploads directory present (included in backup.sh archives)"
else
  warnc "No public/uploads directory yet (created on first upload)"
fi

# ---------- 6) HTTPS / public endpoint ----------
echo "[6] Public endpoint & HTTPS"
PUBLIC_HOST="$(env_val APP_URL | sed -E 's#^https?://([^/]+).*#\1#')"
if [ -n "${PUBLIC_HOST:-}" ] && [ "$PUBLIC_HOST" != "$(env_val APP_URL)" ]; then
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$PUBLIC_HOST/health/live" || true)"
  [ "$HTTP_CODE" = "301" ] && ok "HTTP redirects to HTTPS (301)" || warnc "HTTP on $PUBLIC_HOST returned $HTTP_CODE (expected 301)"
  HTTPS_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$PUBLIC_HOST/health/live" || true)"
  [ "$HTTPS_CODE" = "200" ] && ok "HTTPS health check passes via $PUBLIC_HOST" || bad "HTTPS health check failed via $PUBLIC_HOST (code $HTTPS_CODE)"
else
  warnc "APP_URL not set in .env — HTTPS checks skipped"
fi

# ---------- 7) Metrics ----------
echo "[7] Metrics endpoint"
METRICS="$(curl -s --max-time 5 "$BASE_URL/metrics" | head -1 || true)"
echo "$METRICS" | grep -qE 'HELP|TYPE|#' && ok "/metrics serving Prometheus format" || warnc "/metrics not readable without token/session (expected if METRICS_TOKEN enforced)"

# ---------- Summary ----------
echo "=============================================================="
echo " RESULT: $PASS passed, $FAIL failed, $WARN warning(s)"
if [ "$FAIL" -gt 0 ]; then
  echo " STATUS : NOT READY — resolve all [FAIL] items before go-live."
  exit 1
else
  echo " STATUS : READY (address [WARN] items as soon as practical)."
  exit 0
fi
echo "=============================================================="