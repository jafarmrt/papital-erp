#!/usr/bin/env bash
# ============================================================
#  Papital ERP — Updater
#  Backs up the database, pulls the latest source, rebuilds,
#  restarts the service and verifies health.
#  Migrations run automatically at startup (NEVER db:push).
# ============================================================
set -euo pipefail

LOG_FILE="update-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

APP_DIR="${APP_DIR:-/opt/papital-erp}"
SERVICE_NAME="papital-erp"
APP_PORT="${APP_PORT:-3000}"
SKIP_BACKUP=0
[ "${1:-}" = "--no-backup" ] && SKIP_BACKUP=1

log()      { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
success()  { log "OK: $*"; }
warn()     { log "WARN: $*"; }
die()      { log "ERROR: $*"; exit 1; }

log "=== Papital ERP Updater — log file: $LOG_FILE ==="
cd "$APP_DIR" || die "Application directory not found: $APP_DIR"
[ -f .env ] || die ".env not found in $APP_DIR"

if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

# ---------- 1) Pre-update database backup ----------
if [ "$SKIP_BACKUP" -eq 0 ]; then
  log "[1/6] Creating pre-deployment database backup..."
  # scripts/backup.sh reads DATABASE_URL from .env and tags the dump as pre-deployment
  if [ -f scripts/backup.sh ]; then
    set -a; . ./.env; set +a
    BACKUP_KIND=pre-deployment bash scripts/backup.sh || die "Database backup failed — aborting update."
  else
    warn "scripts/backup.sh not found — skipping explicit backup step."
  fi
else
  warn "Backup skipped by --no-backup flag."
fi

# ---------- 2) Pull latest source ----------
log "[2/6] Pulling latest source (git pull --ff-only)..."
git pull --ff-only || die "git pull failed (local changes or divergence). Resolve manually, then re-run."

# ---------- 3) Install & build ----------
log "[3/6] Installing dependencies (npm ci)..."
npm ci
log "[4/6] Building application..."
npm run build
success "Build completed."

# ---------- 4) Restart service ----------
log "[5/6] Restarting service..."
if systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
  $SUDO systemctl restart "$SERVICE_NAME"
elif command -v pm2 >/dev/null 2>&1 && pm2 id "$SERVICE_NAME" >/dev/null 2>&1; then
  pm2 restart "$SERVICE_NAME"
else
  warn "No systemd unit or pm2 process named '${SERVICE_NAME}' found — start the app manually."
fi

# ---------- 5) Health verification ----------
log "[6/6] Verifying health..."
HEALTH_OK=0
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:${APP_PORT}/health/live" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done
[ "$HEALTH_OK" -eq 1 ] || die "Health probe failed after restart. Check: journalctl -u ${SERVICE_NAME} -n 100"

VERSION="$(curl -fsS "http://localhost:${APP_PORT}/health" | grep -oE '"version":"[^"]+"' || true)"
success "Update finished successfully. ${VERSION}"

log "NOTE: Schema migrations run automatically at startup. NEVER run 'npm run db:push'."
exit 0
