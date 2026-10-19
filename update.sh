#!/usr/bin/env bash
# ============================================================
#  Papital ERP — Updater
#  Backs up the database, pulls the latest source, installs and
#  builds it in a side folder (.build-next) while the service keeps
#  running, swaps the build in, restarts the service and verifies
#  health. The previous build stays as dist.prev/ and
#  node_modules.prev/ (and, for a manual update, the previous source
#  as .previous-source/) for a rollback.
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
# v9.0.183 (TD-605): the settings the backup and the rehearsal take from the environment come from .env literally
for key in BACKUP_DIR PRE_DEPLOY_RETENTION_DAYS RESTORE_ADMIN_URL; do
  if [ -z "${!key:-}" ]; then
    value="$(env_file_value "$key")"
    [ -z "$value" ] || export "$key=$value"
  fi
done
UPDATE_STARTED="$(date '+%Y-%m-%d %H:%M:%S')"
# v10.2.19 (OBS-R1-22 / OBS-R1-17): the side-folder build and the manual source sync
[ -f scripts/update-steps.sh ] || die "scripts/update-steps.sh not found in $APP_DIR"
# shellcheck source=scripts/update-steps.sh
source scripts/update-steps.sh
BUILD_DIR=""
BUILD_SWAPPED=0

# v9.0.123 (TD-586): from the moment the source changes, any failure prints the rollback steps
SOURCE_CHANGED=0
HINT_SHOWN=0
# v10.2.19 (OBS-R1-22): the build in place is the running one until the swap, so only the source goes back before it
previous_source_step() {
  if [ "$UPDATE_MODE" = "git" ] && [ -n "$PREVIOUS_COMMIT" ]; then
    # v9.0.181 (TD-603): reset the branch itself; a checkout of the commit detaches HEAD and the next git pull fails
    echo "git reset --hard ${PREVIOUS_COMMIT}"
  elif [ "$UPDATE_MODE" = "manual" ]; then
    echo "bash scripts/update-steps.sh restore-source ${APP_DIR}"
  else
    echo "put the previous source back"
  fi
}
rollback_hint() {
  HINT_SHOWN=1
  log "Rollback:"
  log "  1) ${SUDO:+sudo }systemctl stop ${SERVICE_NAME}"
  if [ "$BUILD_SWAPPED" -eq 1 ]; then
    log "  2) cd ${APP_DIR} && $(update_restore_build_command) && $(previous_source_step)"
  else
    log "  2) cd ${APP_DIR} && $(previous_source_step)   (the previous build is still in dist/ and node_modules/)"
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
  # the side folder holds a second node_modules; it is removed whatever happened (the next run builds it again)
  if [ -n "$BUILD_DIR" ]; then rm -rf "$BUILD_DIR"; fi
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

# v10.1.28: the app is built and tested on Node.js 24; an older Node still runs it, but say so once
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 24 ]; then
  warn "Node.js $(node -v 2>/dev/null || echo 'not found') is older than 24; install Node.js 24 (see install.sh) before the next update."
fi

# v10.1.68 (TD-1286): without ERP_SECRETS_KEY every new WooCommerce key, bot token or webhook key is refused (503), and
# only install.sh used to add it; add that one key when .env lacks it (in any form the service reads), nothing else
if ! KEY_STEP="$(bash "$APP_DIR/scripts/ensure-env-secrets.sh" "$APP_DIR/.env" ERP_SECRETS_KEY 2>&1)"; then
  warn "ERP_SECRETS_KEY could not be checked or added ($KEY_STEP); new secrets are refused until it is set."
elif [[ "$KEY_STEP" == *"Added ERP_SECRETS_KEY"* ]]; then
  warn "ERP_SECRETS_KEY was missing and has been added to .env; keep a copy of it somewhere safe off this server. If secrets were encrypted with an earlier key, put that key back instead."
elif [[ "$KEY_STEP" == *"WARN:"* ]]; then
  warn "ERP_SECRETS_KEY is empty in .env and was left as it is; new secrets are refused until it is set."
fi

# v10.2.19 (OBS-R1-22): the side build needs room next to the running one; stop before the backup, the source or the
# build is touched when the disk of the application directory cannot hold it
command -v rsync >/dev/null 2>&1 || die "rsync is required to build the update in a side folder (apt-get install -y rsync)."
if ! update_space_check "$APP_DIR" "$UPDATE_MODE"; then
  die "Not enough free disk space for the update: it needs about $(( UPDATE_SPACE_NEED_KB / 1024 )) MB on the disk of ${APP_DIR}, $(( ${UPDATE_SPACE_FREE_KB:-0} / 1024 )) MB is free. Nothing was changed; free $(( (UPDATE_SPACE_NEED_KB - ${UPDATE_SPACE_FREE_KB:-0}) / 1024 )) MB more (old backups, logs) and run the update again."
fi
success "Free disk space: $(( UPDATE_SPACE_FREE_KB / 1024 )) MB (the update needs about $(( UPDATE_SPACE_NEED_KB / 1024 )) MB)."

# ---------- 1) Pre-update database backup ----------
PREVIOUS_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || true)"
PRE_DEPLOY_DUMP=""
if [ "$SKIP_BACKUP" -eq 0 ]; then
  log "[1/6] Creating pre-deployment database backup..."
  # scripts/backup.sh reads DATABASE_URL from .env and tags the dump as pre-deployment (README: kept 90 days)
  if [ -f scripts/backup.sh ]; then
    # v9.0.183 (TD-605): .env is read literally, as the service reads it (node --env-file); it is never run as shell code
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
  # v10.2.19 (OBS-R1-17): the current source is kept for a rollback, then the new one replaces it with --delete, so
  # files the new version no longer has are removed; live state (.env, git history, logs, uploads, media library,
  # backups, db data, node_modules, dist, installer logs) is excluded, neither copied nor deleted
  update_save_previous_source "$APP_DIR" || die "Could not keep the current source in ${UPDATE_PREVIOUS_SOURCE_NAME}/. Live installation is untouched."
  success "Current source kept in ${APP_DIR}/${UPDATE_PREVIOUS_SOURCE_NAME}"
  SOURCE_CHANGED=1
  update_sync_source "$SOURCE_DIR" "$APP_DIR" || die "Source sync failed. The running build is untouched; put the previous source back and retry."
  if [ -n "$SOURCE_ZIP" ]; then
    rm -rf "${STAGE_DIR:-}" && success "Temporary extraction directory removed."
  fi
  success "Source synced."
fi

# ---------- 3) Install & build in a side folder ----------
# v10.2.19 (OBS-R1-22): npm ci and the build used to run in place: npm ci replaced node_modules under the running
# process, and the old server served the new dist/index.html with its old API until the restart. Now both run in
# .build-next; the running dist/ and node_modules/ change only at the swap right before the restart.
# NOTE: NODE_ENV=production (from the environment of an operator shell or CI) makes
# npm omit devDependencies — but the build (vite/esbuild) REQUIRES them (v4.0.30 split).
# Force full install for the build step only; runtime keeps NODE_ENV=production.
BUILD_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
BUILD_DIR="$(update_prepare_build_dir "$APP_DIR")" || die "Could not prepare the side folder ${UPDATE_BUILD_DIR_NAME}/."
cd "$BUILD_DIR"
log "[3/6] Installing dependencies in ${BUILD_DIR} (npm ci --include=dev)..."
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
log "[4/6] Building application in ${BUILD_DIR}..."
# the side folder has no .git: the build info takes the commit of the application directory
rm -rf dist
if ! GIT_COMMIT_SHA="$BUILD_COMMIT" npm run build; then
  die "Build failed - the service was NOT restarted and still runs the previous build, untouched in dist/."
fi
success "Build completed."

# ---------- 3b) Upgrade rehearsal (v8.0.88, TD-367; --rehearse) ----------
# The new migrations run on a restored copy of the pre-deployment backup; the live database and the running
# service are untouched until it passes.
if [ "$REHEARSE" -eq 1 ]; then
  [ -n "$PRE_DEPLOY_DUMP" ] || die "--rehearse: no pre-deployment backup found in ${BACKUP_DIR:-/var/backups/erp}"
  log "[4b/6] Rehearsing this update's migrations on a copy of $PRE_DEPLOY_DUMP ..."
  # the new code's own rehearsal and dependencies, from the side folder (its .env links to the live one)
  if ! APP_DIR="$BUILD_DIR" bash scripts/upgrade-rehearsal.sh "$PRE_DEPLOY_DUMP"; then
    HINT_SHOWN=1
    log "The service was NOT restarted and still runs the previous build, untouched; the database is unchanged."
    log "Put the previous source back: cd ${APP_DIR} && $(previous_source_step)"
    die "Upgrade rehearsal failed — update NOT applied."
  fi
fi

# ---------- 3c) Swap the new build in ----------
cd "$APP_DIR"
log "[4c/6] Swapping the new build in (the previous one stays as dist.prev/ and node_modules.prev/)..."
update_swap_build "$APP_DIR" || die "Could not swap the new build in."
BUILD_SWAPPED=1
success "New build in place."

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
