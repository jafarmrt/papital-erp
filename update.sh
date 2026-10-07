#!/usr/bin/env bash
# ============================================================
#  Papital ERP — Updater
#  Backs up the database, pulls the latest source, rebuilds,
#  restarts the service and verifies health.
#  Migrations run automatically at startup (NEVER db:push).
#
#  Usage:
#    ./update.sh                     # git-based update (default)
#    ./update.sh --no-backup         # git-based update, skip backup (discouraged)
#    ./update.sh --source <DIR>      # manual update from an extracted source directory
#    ./update.sh --zip <FILE.zip>    # manual update from a source zip archive
#    ./update.sh --rehearse          # also run the new migrations on a copy of the pre-deployment backup
#                                    # before restarting (scripts/upgrade-rehearsal.sh; needs RESTORE_ADMIN_URL
#                                    # or sudo -u postgres) — recommended
# ============================================================
set -euo pipefail

LOG_FILE="update-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

APP_DIR="${APP_DIR:-/opt/papital-erp}"
SERVICE_NAME="papital-erp"
APP_PORT="${APP_PORT:-}"
SKIP_BACKUP=0
REHEARSE=0
SOURCE_DIR=""
SOURCE_ZIP=""

# v8.0.83 (TD-365): defined before argument parsing (an unknown argument used to end in "die: command not found")
log()      { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
success()  { log "OK: $*"; }
warn()     { log "WARN: $*"; }
die()      { log "ERROR: $*"; exit 1; }

# Value of KEY in ./.env read literally, as the service reads it (first match, surrounding quotes removed)
env_file_value() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}

# ---------- Parse arguments ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --no-backup) SKIP_BACKUP=1 ;;
    --rehearse)  REHEARSE=1 ;;
    --source)    shift; SOURCE_DIR="${1:-}"; [ -n "$SOURCE_DIR" ] || die "--source requires a directory path"; ;;
    --zip)       shift; SOURCE_ZIP="${1:-}"; [ -n "$SOURCE_ZIP" ] || die "--zip requires an archive path"; ;;
    *)           die "Unknown argument: $1 (supported: --no-backup, --rehearse, --source <DIR>, --zip <FILE.zip>)" ;;
  esac
  shift
done
[ "$REHEARSE" -eq 0 ] || [ "$SKIP_BACKUP" -eq 0 ] || die "--rehearse runs on the pre-deployment backup; it cannot be combined with --no-backup"

log "=== Papital ERP Updater — log file: $LOG_FILE ==="
cd "$APP_DIR" || die "Application directory not found: $APP_DIR"
[ -f .env ] || die ".env not found in $APP_DIR"
# v9.0.124 (TD-587): the service listens on PORT from .env (install.sh writes it there); the startup check watches it
[ -n "$APP_PORT" ] || APP_PORT="$(env_file_value PORT)"
APP_PORT="${APP_PORT:-3000}"
# v9.0.172 (TD-605): the settings the backup and the rehearsal take from the environment come from .env literally
for key in BACKUP_DIR PRE_DEPLOY_RETENTION_DAYS RESTORE_ADMIN_URL; do
  if [ -z "${!key:-}" ]; then
    value="$(env_file_value "$key")"
    [ -z "$value" ] || export "$key=$value"
  fi
done
UPDATE_STARTED="$(date '+%Y-%m-%d %H:%M:%S')"

# v9.0.123 (TD-586): from the moment the source changes, any failure prints the rollback steps
SOURCE_CHANGED=0
HINT_SHOWN=0
rollback_hint() {
  HINT_SHOWN=1
  log "Rollback:"
  log "  1) ${SUDO:+sudo }systemctl stop ${SERVICE_NAME}"
  if [ "$UPDATE_MODE" = "git" ] && [ -n "$PREVIOUS_COMMIT" ]; then
    # v9.0.170 (TD-603): reset the branch itself; a checkout of the commit detaches HEAD and the next git pull fails
    log "  2) git reset --hard ${PREVIOUS_COMMIT} && NODE_ENV=development npm ci --include=dev && npm run build"
  else
    log "  2) put the previous source back and rebuild (npm ci --include=dev && npm run build)"
  fi
  log "  3) ONLY if the new version has accepted no writes: restoring the backup erases every change made after it"
  log "     was taken (before ${UPDATE_STARTED}). If users have already worked on the new version, keep the database."
  if [ -n "$PRE_DEPLOY_DUMP" ]; then
    log "     RESTORE_MODE=apply RESTORE_CONFIRM=yes ./scripts/restore.sh ${PRE_DEPLOY_DUMP}"
  else
    log "     restore the last backup taken before this update with scripts/restore.sh (RESTORE_MODE=apply)"
  fi
  log "  4) ${SUDO:+sudo }systemctl start ${SERVICE_NAME}"
}
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$SOURCE_CHANGED" -eq 1 ] && [ "$HINT_SHOWN" -eq 0 ]; then rollback_hint; fi
}
trap on_exit EXIT

# ---------- Manual mode: extract zip / locate source directory ----------
if [ -n "$SOURCE_ZIP" ]; then
  [ -f "$SOURCE_ZIP" ] || die "Zip archive not found: $SOURCE_ZIP"
  STAGE_DIR="$(mktemp -d /tmp/papital-src.XXXXXX)"
  log "Extracting source archive $SOURCE_ZIP -> $STAGE_DIR ..."
  unzip -q -o "$SOURCE_ZIP" -d "$STAGE_DIR" || die "Failed to extract archive."
  # Support archives that wrap everything in a single top-level folder
  ENTRIES="$(find "$STAGE_DIR" -mindepth 1 -maxdepth 1 | wc -l)"
  if [ "$ENTRIES" -eq 1 ] && [ -d "$(find "$STAGE_DIR" -mindepth 1 -maxdepth 1 -type d)" ]; then
    STAGE_DIR="$(find "$STAGE_DIR" -mindepth 1 -maxdepth 1 -type d)"
  fi
  [ -f "$STAGE_DIR/package.json" ] && [ -f "$STAGE_DIR/server.ts" ] \
    || die "Extracted archive does not look like a Papital ERP source tree (missing package.json/server.ts)."
  SOURCE_DIR="$STAGE_DIR"
fi

if [ -n "$SOURCE_DIR" ]; then
  [ -d "$SOURCE_DIR" ] || die "Source directory not found: $SOURCE_DIR"
  [ -f "$SOURCE_DIR/package.json" ] && [ -f "$SOURCE_DIR/server.ts" ] \
    || die "Source directory does not look like an application source tree (missing package.json/server.ts)."
  UPDATE_MODE="manual"
  log "Update mode: MANUAL (source directory: $SOURCE_DIR)"
else
  UPDATE_MODE="git"
  log "Update mode: GIT (git pull --ff-only)"
fi

if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

# ---------- 1) Pre-update database backup ----------
PREVIOUS_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || true)"
PRE_DEPLOY_DUMP=""
if [ "$SKIP_BACKUP" -eq 0 ]; then
  log "[1/6] Creating pre-deployment database backup..."
  # scripts/backup.sh reads DATABASE_URL from .env and tags the dump as pre-deployment (README: kept 90 days)
  if [ -f scripts/backup.sh ]; then
    # v9.0.172 (TD-605): .env is read literally, as the service reads it (node --env-file); it is never run as shell code
    BACKUP_KIND=pre-deployment RETENTION_DAYS="${PRE_DEPLOY_RETENTION_DAYS:-90}" bash scripts/backup.sh || die "Database backup failed — aborting update."
    PRE_DEPLOY_DUMP="$(ls -t "${BACKUP_DIR:-/var/backups/erp}"/erp_pre-deployment_*.dump.gz 2>/dev/null | head -1 || true)"
  else
    warn "scripts/backup.sh not found — skipping explicit backup step."
  fi
else
  warn "Backup skipped by --no-backup flag."
fi

# ---------- 2) Update source ----------
if [ "$UPDATE_MODE" = "git" ]; then
  # AI Studio pulls delete package-lock.json; a stale local copy would block --ff-only.
  # Remove it pre-pull — step [3/6] regenerates it (and node_modules) deterministically.
  if [ -f package-lock.json ] && ! git ls-files --error-unmatch package-lock.json >/dev/null 2>&1; then
    warn "Stale untracked package-lock.json found (regenerated by a previous run) — removing before pull."
    rm -f package-lock.json
  fi
  # TD-472 (B01-03): releases from v9.0.25 on tracked a node_modules symlink that blocks the pull; untrack it.
  bash "$APP_DIR/scripts/untrack-node-modules-link.sh" "$APP_DIR" || die "Could not untrack the node_modules symlink."
  log "[2/6] Pulling latest source (git pull --ff-only)..."
  git pull --ff-only || die "git pull failed (local changes or divergence). Resolve manually, then re-run."
  SOURCE_CHANGED=1
else
  log "[2/6] Syncing source from $SOURCE_DIR (state-preserving rsync)..."
  command -v rsync >/dev/null 2>&1 || die "rsync is required for manual updates (apt-get install -y rsync)."
  SOURCE_CHANGED=1
  # Preserve live state: .env, git history, logs, uploads, backups, db data, node_modules, dist, installer logs
  rsync -a \
    --exclude='.env' \
    --exclude='.git/' \
    --exclude='logs/' \
    --exclude='install-*.log' \
    --exclude='update-*.log' \
    --exclude='domain-setup-*.log' \
    --exclude='.pgdata/' \
    --exclude='backups/' \
    --exclude='public/uploads/' \
    --exclude='node_modules/' \
    --exclude='dist/' \
    --exclude='*.zip' \
    "$SOURCE_DIR"/ "$APP_DIR"/ || die "Source sync failed. Live installation is untouched — investigate and retry."
  if [ -n "$SOURCE_ZIP" ]; then
    rm -rf "${STAGE_DIR:-}" && success "Temporary extraction directory removed."
  fi
  success "Source synced."
fi

# ---------- 3) Install & build ----------
# NOTE: NODE_ENV=production (from the environment of an operator shell or CI) makes
# npm omit devDependencies — but the build (vite/esbuild) REQUIRES them (v4.0.30 split).
# Force full install for the build step only; runtime keeps NODE_ENV=production.
log "[3/6] Installing dependencies (npm ci --include=dev)..."
# AI Studio pulls delete package-lock.json; npm ci cannot run without it.
if [ ! -f package-lock.json ]; then
  warn "package-lock.json missing — regenerating from package.json (npm install --package-lock-only)..."
  NODE_ENV=development npm install --include=dev --package-lock-only --no-audit --no-fund \
    || die "Lockfile regeneration failed."
fi
NODE_ENV=development npm ci --include=dev || {
  warn "npm ci failed — lockfile is likely out of sync with package.json. Regenerating and retrying..."
  NODE_ENV=development npm install --include=dev --package-lock-only --no-audit --no-fund \
    || die "Lockfile regeneration failed."
  NODE_ENV=development npm ci --include=dev || die "npm ci failed even after lockfile regeneration."
}
log "[4/6] Building application..."
# v9.0.123 (TD-586): vite empties dist/ before esbuild writes dist/server.cjs; a failed build puts the previous
# build back so the next restart of the service still finds it
rm -rf dist.prev
[ ! -d dist ] || cp -a dist dist.prev
if ! npm run build; then
  if [ -d dist.prev ]; then
    rm -rf dist && mv dist.prev dist && warn "Build failed - the previous build was put back in dist/."
  fi
  die "Build failed - the service was NOT restarted and still runs the previous build."
fi
rm -rf dist.prev
success "Build completed."

# ---------- 3b) Upgrade rehearsal (v8.0.88, TD-367; --rehearse) ----------
# The new migrations run on a restored copy of the pre-deployment backup; the live database and the running
# service are untouched until it passes.
if [ "$REHEARSE" -eq 1 ]; then
  [ -n "$PRE_DEPLOY_DUMP" ] || die "--rehearse: no pre-deployment backup found in ${BACKUP_DIR:-/var/backups/erp}"
  log "[4b/6] Rehearsing this update's migrations on a copy of $PRE_DEPLOY_DUMP ..."
  if ! bash scripts/upgrade-rehearsal.sh "$PRE_DEPLOY_DUMP"; then
    HINT_SHOWN=1
    log "The service was NOT restarted and still runs the previous build; the database is unchanged."
    log "Put the previous source back before anything restarts the service:"
    if [ "$UPDATE_MODE" = "git" ] && [ -n "$PREVIOUS_COMMIT" ]; then
      log "  git reset --hard ${PREVIOUS_COMMIT} && NODE_ENV=development npm ci --include=dev && npm run build"
    else
      log "  restore the previous source tree and run: NODE_ENV=development npm ci --include=dev && npm run build"
    fi
    die "Upgrade rehearsal failed — update NOT applied."
  fi
fi

# ---------- 4) Restart service ----------
PKG_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo '')"
RESTART_OK=0
# NOTE: string matching instead of `systemctl | grep -q` — under `set -o pipefail`,
# grep -q exits early and SIGPIPEs systemctl, making the pipeline falsely fail.
UNIT_LIST="$(systemctl list-unit-files 2>/dev/null || true)"
log "[5/6] Restarting service..."
if [[ "$UNIT_LIST" != *"$SERVICE_NAME.service"* ]]; then
  # Auto-detect the systemd unit managing the running app (unit may have a custom name)
  RUNNING_PID="$(pgrep -f 'dist/server.cjs' | head -1 || true)"
  if [ -n "$RUNNING_PID" ]; then
    DETECTED="$(systemctl status "$RUNNING_PID" 2>/dev/null | grep -oE '[a-zA-Z0-9_.@-]+\.service' | head -1 | sed 's/\.service$//' || true)"
    if [ -n "$DETECTED" ] && [ "$DETECTED" != "systemd" ]; then
      warn "No unit named '${SERVICE_NAME}' found — auto-detected managing unit: '${DETECTED}'"
      SERVICE_NAME="$DETECTED"
    fi
  fi
fi
if [[ "$UNIT_LIST" == *"$SERVICE_NAME.service"* ]]; then
  $SUDO systemctl restart "$SERVICE_NAME" && RESTART_OK=1
elif command -v pm2 >/dev/null 2>&1 && pm2 id "$SERVICE_NAME" >/dev/null 2>&1; then
  pm2 restart "$SERVICE_NAME" && RESTART_OK=1
else
  warn "No systemd unit or pm2 process named '${SERVICE_NAME}' found — start the app manually."
fi

# ---------- 5) Startup verification (v8.0.83, TD-365) ----------
# The liveness probe answers 200 while migrations are still running (or just before they fail); only
# /health/startup proves that migrations, seed and engines finished on the NEW build.
log "[6/6] Waiting for startup (migrations + seed) to complete..."
if ! STARTUP_OUTPUT="$(bash scripts/verify-startup.sh "$APP_PORT" "${STARTUP_TIMEOUT:-600}" "$PKG_VERSION")"; then
  log "$STARTUP_OUTPUT"
  log "Check: journalctl -u ${SERVICE_NAME} -n 200"
  rollback_hint
  die "Update NOT completed."
fi
log "$STARTUP_OUTPUT"
if [ "$RESTART_OK" -ne 1 ]; then
  die "Startup verified BUT no managed service was restarted — the running process may still be an old build. Register a systemd/pm2 service and re-run."
fi
success "Update finished successfully. Running v$PKG_VERSION; migrations and startup complete"

log "NOTE: Schema migrations run automatically at startup. NEVER run 'npm run db:push'."
exit 0
