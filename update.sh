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
#    ./update.sh --rebuild           # build again even when dist/ was built from this very source
# ============================================================
set -euo pipefail

ORIG_ARGS=("$@")
# v10.2.23 (OBS-R1-22): set when this script runs again as the version the pull or sync just brought in
UPDATE_RESUME="${UPDATE_RESUME:-}"
if [ -n "$UPDATE_RESUME" ]; then
  # stdout already goes to the log of the first run
  LOG_FILE="${UPDATE_RESUME_LOG:?}"
else
  LOG_FILE="$PWD/update-$(date +%Y%m%d-%H%M%S).log"
  # tee ignores HUP: a dropped SSH session must not kill the log writer, or the next log line would end the update
  exec > >(trap '' HUP; exec tee -a "$LOG_FILE") 2>&1
fi

APP_DIR="${APP_DIR:-/opt/papital-erp}"
SERVICE_NAME="papital-erp"
APP_PORT="${APP_PORT:-}"
SKIP_BACKUP=0
REHEARSE=0
REBUILD=0
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
    --rebuild)   REBUILD=1 ;;
    --source)    shift; SOURCE_DIR="${1:-}"; [ -n "$SOURCE_DIR" ] || die "--source requires a directory path"; ;;
    --zip)       shift; SOURCE_ZIP="${1:-}"; [ -n "$SOURCE_ZIP" ] || die "--zip requires an archive path"; ;;
    *)           die "Unknown argument: $1 (supported: --no-backup, --rehearse, --rebuild, --source <DIR>, --zip <FILE.zip>)" ;;
  esac
  shift
done
[ "$REHEARSE" -eq 0 ] || [ "$SKIP_BACKUP" -eq 0 ] || die "--rehearse runs on the pre-deployment backup; it cannot be combined with --no-backup"

if [ -n "$UPDATE_RESUME" ]; then
  log "=== Continuing with the update.sh of the new version ==="
else
  log "=== Papital ERP Updater — log file: $LOG_FILE ==="
fi
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
UPDATE_STARTED="${UPDATE_RESUME_STARTED:-$(date '+%Y-%m-%d %H:%M:%S')}"
# v10.2.23 (OBS-R1-22 / OBS-R1-17): the side-folder build and the manual source sync
[ -f scripts/update-steps.sh ] || die "scripts/update-steps.sh not found in $APP_DIR"
# shellcheck source=scripts/update-steps.sh
source scripts/update-steps.sh
BUILD_DIR=""
BUILD_SWAPPED=0

# v10.2.23 (OBS-R1-22): one update at a time; two runs would each wipe the other's side folder. The lock is held by
# file descriptor 9 until the process ends, the run of the new update.sh included (it inherits it).
if [ -z "$UPDATE_RESUME" ]; then
  command -v flock >/dev/null 2>&1 || die "flock is required (apt-get install -y util-linux)."
  exec 9>"$APP_DIR/$UPDATE_LOCK_NAME"
  flock -n 9 || die "Another update is already running in ${APP_DIR} (lock file ${UPDATE_LOCK_NAME}). Nothing was changed; wait for it to finish."
fi
# v10.2.23 (OBS-R1-22): an earlier update stopped in the middle of the build swap (killed, power loss)
if [ -e "$APP_DIR/$UPDATE_SWAP_MARKER_NAME" ]; then
  die "An earlier update stopped while swapping the build in: dist/ or node_modules/ may be missing. Nothing was changed. Repair it first: cd ${APP_DIR} && $(update_restore_build_command) ; then start the service and run the update again."
fi

# v9.0.123 (TD-586): from the moment the source changes, any failure prints the rollback steps
SOURCE_CHANGED=0
HINT_SHOWN=0
# v10.2.23 (OBS-R1-22): the build in place is the running one until the swap, so only the source goes back before it
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
  if [ -e "$APP_DIR/$UPDATE_SWAP_MARKER_NAME" ]; then
    # the swap stopped half way: the new build parts are still in the side folder, which is kept
    log "Rollback: the build swap stopped half way, so dist/ or node_modules/ may be missing. Put the previous build back:"
    log "  1) cd ${APP_DIR} && $(update_restore_build_command) && $(previous_source_step)"
    log "  2) ${SUDO:+sudo }systemctl restart ${SERVICE_NAME}"
    return 0
  fi
  if [ "$BUILD_SWAPPED" -eq 0 ]; then
    # nothing was restarted or migrated: the service runs the previous build and the database is unchanged
    log "Rollback: the service still runs the previous build and the database is unchanged; only the source goes back:"
    log "  cd ${APP_DIR} && $(previous_source_step)"
    return 0
  fi
  log "Rollback:"
  log "  1) ${SUDO:+sudo }systemctl stop ${SERVICE_NAME}"
  log "  2) cd ${APP_DIR} && $(update_restore_build_command) && $(previous_source_step)"
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
  # the side folder holds a second node_modules; it is removed whatever happened (the next run builds it again),
  # except after a swap that stopped half way, when it may hold the only copy of the new build
  if [ -n "$BUILD_DIR" ] && [ ! -e "$APP_DIR/$UPDATE_SWAP_MARKER_NAME" ]; then rm -rf "${BUILD_DIR:?}"; fi
}
trap on_exit EXIT
# v10.2.28 (#339 review N-A): a signal (a dropped SSH session, Ctrl+C, kill) ends the run with a non-zero status, so
# on_exit prints the rollback steps; with the default action the EXIT trap saw status 0 and printed nothing
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# v10.2.23 (OBS-R1-22): npm failed because the disk is full; retrying would only fill the log
disk_full_in_log() {
  tail -n 400 "$LOG_FILE" 2>/dev/null | grep -qE 'ENOSPC|[Nn]o space left on device'
}
die_if_disk_full() {
  if disk_full_in_log; then
    die "The disk of ${APP_DIR} is full (ENOSPC): $1 could not write. The service still runs the previous build, untouched. Free space on the disk mounted at $(update_disk_mount "$APP_DIR") and run the update again."
  fi
}

if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

if [ -n "$UPDATE_RESUME" ]; then
  # the backup and the source step ran in the first run, with the previous update.sh
  UPDATE_MODE="${UPDATE_RESUME_MODE:?}"
  PREVIOUS_COMMIT="${UPDATE_RESUME_PREVIOUS_COMMIT:-}"
  PRE_DEPLOY_DUMP="${UPDATE_RESUME_DUMP:-}"
  SOURCE_CHANGED=1
else
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
    # v10.2.23 (OBS-R1-17): refused before anything is touched
    update_assert_source_outside "$SOURCE_DIR" "$APP_DIR" || die "Nothing was changed."
    UPDATE_MODE="manual"
    log "Update mode: MANUAL (source directory: $SOURCE_DIR)"
  else
    UPDATE_MODE="git"
    log "Update mode: GIT (git pull --ff-only)"
  fi
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

# v10.2.23 (OBS-R1-22): the side build needs room next to the running one, and the backup and the rehearsal need
# theirs; stop before the backup, the source or the build is touched when a disk cannot hold them
command -v rsync >/dev/null 2>&1 || die "rsync is required to build the update in a side folder (apt-get install -y rsync)."
if [ -z "$UPDATE_RESUME" ]; then
  BACKUP_STEP=0
  if [ "$SKIP_BACKUP" -eq 0 ] && [ -f scripts/backup.sh ]; then BACKUP_STEP=1; fi
  update_space_check "$APP_DIR" "$UPDATE_MODE" "$BACKUP_STEP" "$REHEARSE" || die "$UPDATE_SPACE_MESSAGE"
  success "Free disk space: $(( UPDATE_SPACE_FREE_KB / 1024 )) MB on the disk of ${APP_DIR} (the update needs about $(( UPDATE_SPACE_NEED_KB / 1024 )) MB)."

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
  # v10.2.23 (OBS-R1-22): bash keeps reading this file as it was when it started; if the new source brings another
  # update.sh or update-steps.sh, the rest of the update runs with the new ones
  STEPS_SUM_BEFORE="$(cat update.sh scripts/update-steps.sh 2>/dev/null | sha256sum)"
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
    # v10.2.23 (OBS-R1-17): the current source is kept for a rollback, then the new one replaces it with --delete, so
    # files the new version does not have are removed, also files that were never part of a release; live state
    # (.env, git history, logs, uploads, media library, backups, db data, node_modules, dist, installer logs and the
    # folders .env names) is excluded, neither copied nor deleted
    DELETIONS="$(update_sync_deletions "$SOURCE_DIR" "$APP_DIR")" || die "Could not compare the new source with ${APP_DIR}. Nothing was changed."
    if [ -n "$DELETIONS" ]; then
      log "These $(printf '%s\n' "$DELETIONS" | wc -l) files and folders are not in the new source and will be removed (a copy stays in ${UPDATE_PREVIOUS_SOURCE_NAME}/):"
      printf '%s\n' "$DELETIONS" | head -200 | sed 's/^/    /'
      if [ "$(printf '%s\n' "$DELETIONS" | wc -l)" -gt 200 ]; then log "    ... (the full list is in ${UPDATE_PREVIOUS_SOURCE_NAME}/)"; fi
    fi
    update_save_previous_source "$APP_DIR" || die "Could not keep the current source in ${UPDATE_PREVIOUS_SOURCE_NAME}/. Live installation is untouched."
    success "Current source kept in ${APP_DIR}/${UPDATE_PREVIOUS_SOURCE_NAME}"
    SOURCE_CHANGED=1
    update_sync_source "$SOURCE_DIR" "$APP_DIR" || die "Source sync failed. The running build is untouched; put the previous source back and retry."
    if [ -n "$SOURCE_ZIP" ]; then
      rm -rf "${STAGE_DIR:-}" && success "Temporary extraction directory removed."
    fi
    success "Source synced."
  fi
  # only a new update.sh that knows how to continue (UPDATE_RESUME) is run again
  if [ "$(cat update.sh scripts/update-steps.sh 2>/dev/null | sha256sum)" != "$STEPS_SUM_BEFORE" ] && [ -f scripts/update-steps.sh ] \
    && grep -q UPDATE_RESUME update.sh; then
    log "The new version brings another update.sh; continuing with it."
    exec env UPDATE_RESUME=1 UPDATE_RESUME_LOG="$LOG_FILE" UPDATE_RESUME_MODE="$UPDATE_MODE" \
      UPDATE_RESUME_PREVIOUS_COMMIT="$PREVIOUS_COMMIT" UPDATE_RESUME_DUMP="$PRE_DEPLOY_DUMP" \
      UPDATE_RESUME_STARTED="$UPDATE_STARTED" APP_DIR="$APP_DIR" bash "$APP_DIR/update.sh" "${ORIG_ARGS[@]}"
  fi
fi

# the backup and the source are written now: check again what the build and the rehearsal still need
update_space_check "$APP_DIR" git 0 "$REHEARSE" 1 || die "$UPDATE_SPACE_MESSAGE"

# ---------- 3) Install & build in a side folder ----------
# v10.2.19 (OBS-R1-22): npm ci and the build used to run in place: npm ci replaced node_modules under the running
# process, and the old server served the new dist/index.html with its old API until the restart. Now both run in
# .build-next; the running dist/ and node_modules/ change only at the swap right before the restart.
# NOTE: NODE_ENV=production (from the environment of an operator shell or CI) makes
# npm omit devDependencies — but the build (vite/esbuild) REQUIRES them (v4.0.30 split).
# Force full install for the build step only; runtime keeps NODE_ENV=production.
BUILD_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
if [ "$UPDATE_MODE" = "git" ]; then BUILD_SOURCE="$BUILD_COMMIT"; else BUILD_SOURCE="manual update of ${UPDATE_STARTED}"; fi
BUILD_DIR="$(update_prepare_build_dir "$APP_DIR")" || die "Could not prepare the side folder ${UPDATE_BUILD_DIR_NAME}/."
SOURCE_FINGERPRINT="$(update_source_fingerprint "$BUILD_DIR")"
SKIP_BUILD=0
# v10.2.23 (OBS-R1-22): a run with nothing new keeps dist.prev/ as the rollback target instead of replacing it with a
# second copy of the running build
if [ "$REBUILD" -eq 0 ] && [ "$(update_dist_fingerprint "$APP_DIR/dist")" = "$SOURCE_FINGERPRINT" ]; then
  SKIP_BUILD=1
  log "dist/ is already built from this source ($(update_dist_commit "$APP_DIR/dist")): nothing to build or swap (--rebuild builds it again)."
  if [ -d "$APP_DIR/dist.prev" ]; then log "dist.prev/ still holds the build of $(update_dist_commit "$APP_DIR/dist.prev")."; fi
fi

if [ "$SKIP_BUILD" -eq 0 ]; then
  cd "$BUILD_DIR"
  log "[3/6] Installing dependencies in ${BUILD_DIR} (npm ci --include=dev)..."
  # AI Studio pulls delete package-lock.json; npm ci cannot run without it.
  if [ ! -f package-lock.json ]; then
    warn "package-lock.json missing — regenerating from package.json (npm install --package-lock-only)..."
    NODE_ENV=development npm install --include=dev --package-lock-only --no-audit --no-fund \
      || { die_if_disk_full "npm install"; die "Lockfile regeneration failed."; }
  fi
  NODE_ENV=development npm ci --include=dev || {
    die_if_disk_full "npm ci"
    warn "npm ci failed — lockfile is likely out of sync with package.json. Regenerating and retrying..."
    NODE_ENV=development npm install --include=dev --package-lock-only --no-audit --no-fund \
      || { die_if_disk_full "npm install"; die "Lockfile regeneration failed."; }
    NODE_ENV=development npm ci --include=dev || { die_if_disk_full "npm ci"; die "npm ci failed even after lockfile regeneration."; }
  }
  log "[4/6] Building application in ${BUILD_DIR}..."
  # the side folder has no .git: the build info takes the commit of the application directory
  rm -rf dist
  if ! GIT_COMMIT_SHA="$BUILD_COMMIT" npm run build; then
    die_if_disk_full "the build"
    die "Build failed - the service was NOT restarted and still runs the previous build, untouched in dist/."
  fi
  echo "$SOURCE_FINGERPRINT" > dist/"$UPDATE_FINGERPRINT_NAME"
  echo "$BUILD_SOURCE" > dist/"$UPDATE_COMMIT_NAME"
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
  if [ -d "$APP_DIR/dist.prev" ]; then
    success "New build in place. dist.prev/ holds the previous build, of $(update_dist_commit "$APP_DIR/dist.prev")."
  else
    success "New build in place (there was no previous build to keep)."
  fi
fi
cd "$APP_DIR"

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
elif command -v pm2 >/dev/null 2>&1 && pm2 id "$SERVICE_NAME" >/dev/null 2>&1 9>&-; then
  # the update lock (descriptor 9) must not be inherited by the pm2 daemon
  pm2 restart "$SERVICE_NAME" 9>&- && RESTART_OK=1
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
  if [ "$SKIP_BUILD" -eq 1 ]; then
    HINT_SHOWN=1
    log "This run changed no build: dist/ is the one an earlier update put in place, and dist.prev/ is still its rollback."
  else
    rollback_hint
  fi
  die "Update NOT completed."
fi
log "$STARTUP_OUTPUT"
if [ "$RESTART_OK" -ne 1 ]; then
  die "Startup verified BUT no managed service was restarted — the running process may still be an old build. Register a systemd/pm2 service and re-run."
fi
# v10.2.23 (OBS-R1-17): a git update keeps no copy of the source of an earlier manual update; git history replaces it
if [ "$UPDATE_MODE" = "git" ] && [ -d "$APP_DIR/$UPDATE_PREVIOUS_SOURCE_NAME" ]; then
  rm -rf "${APP_DIR:?}/${UPDATE_PREVIOUS_SOURCE_NAME:?}" && success "Removed ${UPDATE_PREVIOUS_SOURCE_NAME}/ of an earlier manual update (git history holds the previous source)."
fi
success "Update finished successfully. Running v$PKG_VERSION; migrations and startup complete"

log "NOTE: Schema migrations run automatically at startup. NEVER run 'npm run db:push'."
exit 0
