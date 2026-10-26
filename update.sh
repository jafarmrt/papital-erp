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
  # v11 (O16): the log names paths and versions of the server; only root reads it, and logs older than 90 days go
  ( umask 077; : >> "$LOG_FILE" )
  # the logs sit in the folder update.sh, install.sh and setup-domain.sh were started from; older ones become private too
  find "$PWD" -maxdepth 1 -type f \( -name 'update-*.log' -o -name 'install-*.log' -o -name 'domain-setup-*.log' \) -mtime +90 -delete 2>/dev/null || true
  find "$PWD" -maxdepth 1 -type f \( -name 'update-*.log' -o -name 'install-*.log' -o -name 'domain-setup-*.log' \) -perm /go=rwx -exec chmod go-rwx {} + 2>/dev/null || true
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

# Value of KEY in ./.env read literally, as the service reads it; v11 (O5): through scripts/env-file.sh (sourced below,
# after the cd), so the last line of a key wins and «export» and inline comments count as in node --env-file
env_file_value() { env_file_get .env "$1"; }

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
[ -f scripts/env-file.sh ] || die "scripts/env-file.sh not found in $APP_DIR"
# shellcheck source=scripts/env-file.sh
source scripts/env-file.sh
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
# v11 (phase 5.3, TD-1354): a new install runs the service as its own user, who owns the logs, uploads and backups;
# root never writes into those folders by path (the user could put a link there), its jobs run as that user
UPDATE_SERVICE_USER="$(update_service_user "$SERVICE_NAME")"
as_service_user() {
  if [ "$(id -u)" -eq 0 ] && [ "$UPDATE_SERVICE_USER" != root ]; then runuser -u "$UPDATE_SERVICE_USER" -- "$@"; else "$@"; fi
}
BUILD_SWAPPED=0

# v10.2.23 (OBS-R1-22): one update at a time; two runs would each wipe the other's side folder. The lock is held by
# file descriptor 9 until the process ends, the run of the new update.sh included (it inherits it).
if [ -z "$UPDATE_RESUME" ]; then
  command -v flock >/dev/null 2>&1 || die "flock is required (apt-get install -y util-linux)."
  # v11 (O18): readable by every user whatever root's umask, so a daily backup of a non-root service sees it held
  ( umask 022; : >> "$APP_DIR/$UPDATE_LOCK_NAME" ) && chmod 644 "$APP_DIR/$UPDATE_LOCK_NAME" 2>/dev/null || true
  exec 9>"$APP_DIR/$UPDATE_LOCK_NAME"
  # a few seconds: another job's lock check (scripts/ops-lock.sh) holds the file for a moment
  flock -w 10 9 || die "Another update is already running in ${APP_DIR} (lock file ${UPDATE_LOCK_NAME}). Nothing was changed; wait for it to finish."
  # v11 (O18): a backup, restore or upgrade rehearsal that is running finishes first (scripts/ops-lock.sh); a daily
  # backup that starts from now on waits for this update
  # shellcheck source=scripts/ops-lock.sh
  source scripts/ops-lock.sh
  ops_wait_idle "$APP_DIR" "${UPDATE_OPS_WAIT_SECONDS:-1800}" \
    || die "A backup, restore or upgrade rehearsal is still running in ${APP_DIR} (lock file ${OPS_BUSY_LOCK_NAME}). Nothing was changed; run the update again when it has finished."
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
  # v11 (phase 3.3, O2): the old hint offered «keep the database» with the previous build, which never starts on a
  # database the new version migrated; the steps now follow what this run did to the database
  local migrated
  migrated="$(update_migrations_changed "$APP_DIR")"
  if [ "$migrated" = "0" ]; then
    log "Rollback (this update changed nothing in the database, so no restore is needed):"
    log "  1) ${SUDO:+sudo }systemctl stop ${SERVICE_NAME}"
    log "  2) cd ${APP_DIR} && $(update_restore_build_command) && $(previous_source_step)"
    log "  3) ${SUDO:+sudo }systemctl start ${SERVICE_NAME}"
    return 0
  fi
  if [ "$migrated" = "unknown" ]; then
    log "This update brings new database migrations, and whether they already ran could not be read."
  else
    log "The database now holds ${migrated} migration(s) newer than the previous build. It refuses to start on a database"
    log "newer than itself, so the code alone cannot go back."
  fi
  log "Choose one:"
  log "  A) Go forward (keeps everything users wrote): leave the database as it is and run the update again once a"
  log "     corrected version is released. The previous build cannot be put back on this database."
  log "  B) Go back completely: restoring the backup erases every change made after it was taken (before ${UPDATE_STARTED})."
  log "     1) ${SUDO:+sudo }systemctl stop ${SERVICE_NAME}"
  log "     2) cd ${APP_DIR} && $(update_restore_build_command) && $(previous_source_step)"
  if [ -n "$PRE_DEPLOY_DUMP" ]; then
    log "     3) RESTORE_MODE=apply RESTORE_CONFIRM=yes ./scripts/restore.sh ${PRE_DEPLOY_DUMP}"
  else
    log "     3) restore the last backup taken before this update with scripts/restore.sh (RESTORE_MODE=apply)"
  fi
  log "     4) ${SUDO:+sudo }systemctl start ${SERVICE_NAME}"
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
# v11 (failed v11.2.0 update): whether the kernel killed a process for lack of memory since its count was <kills-before>
oom_kills_grew() {
  local now
  now="$(update_oom_kills)"
  [ -n "$1" ] && [ -n "$now" ] && [ "$now" -gt "$1" ]
}
# <what> failed and the kernel killed a process for lack of memory meanwhile; the shell only printed 'Killed'
die_if_out_of_memory() {
  if oom_kills_grew "$1"; then
    die "The server ran out of memory: the kernel killed a process during $2 ('Killed'; journalctl -k | grep -i oom names it). The previous build stays untouched in dist/. The build needs about ${UPDATE_MIN_MEMORY_MB:-2048} MB of free RAM and swap together; ${UPDATE_SWAP_ADVICE}, and run the update again."
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

# v10.1.68 (TD-1286) / v11 (O10, O17): the generated .env keys (ERP_SECRETS_KEY among them) are added right before the
# restart (update_refresh_ops_config), so a run stopped by a missing tool or by the checks below leaves .env as it was

# v10.2.23 (OBS-R1-22): the side build needs room next to the running one, and the backup and the rehearsal need
# theirs; stop before the backup, the source or the build is touched when a disk cannot hold them
command -v rsync >/dev/null 2>&1 || die "rsync is required to build the update in a side folder (apt-get install -y rsync)."

# v11 (O11): a git update with nothing new (the branch has no new commit and dist/ is built from this very source) takes
# no backup and does not restart the service; it only adds what this version's .env and cron file lack (below)
NOTHING_NEW=0
if [ -z "$UPDATE_RESUME" ] && [ "$UPDATE_MODE" = "git" ] && [ "$REBUILD" -eq 0 ] && git fetch --quiet 2>/dev/null \
  && [ "$(git rev-parse HEAD)" = "$(git rev-parse '@{u}' 2>/dev/null || true)" ]; then
  NOOP_DIR="$(update_prepare_build_dir "$APP_DIR")" || die "Could not prepare the side folder ${UPDATE_BUILD_DIR_NAME}/."
  # removed at exit like the side folder of a build (on_exit)
  BUILD_DIR="$NOOP_DIR"
  if [ "$(update_dist_fingerprint "$APP_DIR/dist")" = "$(update_source_fingerprint "$NOOP_DIR")" ]; then
    NOTHING_NEW=1
    PREVIOUS_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || true)"
    PRE_DEPLOY_DUMP=""
    log "Nothing new: ${APP_DIR} is at $(git rev-parse --short HEAD) like its branch on the remote, and dist/ is built from this source. No backup and no restart (--rebuild builds and restarts anyway)."
    [ "$REHEARSE" -eq 0 ] || log "--rehearse: no new migration to rehearse."
  fi
fi

if [ -z "$UPDATE_RESUME" ] && [ "$NOTHING_NEW" -eq 0 ]; then
  BACKUP_STEP=0
  if [ "$SKIP_BACKUP" -eq 0 ] && [ -f scripts/backup.sh ]; then BACKUP_STEP=1; fi
  update_space_check "$APP_DIR" "$UPDATE_MODE" "$BACKUP_STEP" "$REHEARSE" || die "$UPDATE_SPACE_MESSAGE"
  success "Free disk space: $(( UPDATE_SPACE_FREE_KB / 1024 )) MB on the disk of ${APP_DIR} (the update needs about $(( UPDATE_SPACE_NEED_KB / 1024 )) MB)."
  update_database_space_check "$APP_DIR" || die "$UPDATE_DB_SPACE_MESSAGE"
  update_memory_check || die "$UPDATE_MEMORY_MESSAGE"
  if [ -n "$UPDATE_MEMORY_FREE_MB" ]; then
    success "Free memory: ${UPDATE_MEMORY_FREE_MB} MB of RAM and swap (the build needs about ${UPDATE_MIN_MEMORY_MB:-2048} MB)."
  fi

  # ---------- 1) Pre-update database backup ----------
  PREVIOUS_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || true)"
  PRE_DEPLOY_DUMP=""
  if [ "$SKIP_BACKUP" -eq 0 ]; then
    log "[1/6] Creating pre-deployment database backup..."
    # scripts/backup.sh reads DATABASE_URL from .env and tags the dump as pre-deployment (README: kept 90 days)
    if [ -f scripts/backup.sh ]; then
      # v9.0.183 (TD-605): .env is read literally, as the service reads it (node --env-file); it is never run as shell code
      as_service_user env BACKUP_KIND=pre-deployment RETENTION_DAYS="${PRE_DEPLOY_RETENTION_DAYS:-90}" bash scripts/backup.sh \
        || die "Database backup failed — aborting update."
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
    # v11 (phase 3.3, O4): an earlier update could write a regenerated lock into the checkout, and that change blocked
    # every later pull; when it is the only local change, the released lock is put back (the server never edits it)
    if git ls-files --error-unmatch package-lock.json >/dev/null 2>&1 && ! git diff --quiet -- package-lock.json \
      && [ -z "$(git status --porcelain --untracked-files=no | grep -v ' package-lock.json$' || true)" ]; then
      warn "package-lock.json was changed by an earlier update (a regenerated lock file); putting the released one back before the pull."
      git checkout -- package-lock.json || die "Could not put package-lock.json back. Nothing else was changed."
    fi
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

# the backup and the source are written now: check again what the build and the rehearsal still need (nothing to build
# or migrate when nothing is new)
if [ "$NOTHING_NEW" -eq 0 ]; then
  update_space_check "$APP_DIR" git 0 "$REHEARSE" 1 || die "$UPDATE_SPACE_MESSAGE"
  # checked again here: a first run with an older update.sh (the one an update starts with) had no database check
  update_database_space_check "$APP_DIR" 1 || die "$UPDATE_DB_SPACE_MESSAGE"
fi
if [ "$NOTHING_NEW" -eq 0 ] && [ -n "$UPDATE_DB_SPACE_NEED_KB" ]; then
  success "Free disk space for the database: $(( UPDATE_DB_SPACE_FREE_KB / 1024 )) MB left for it (the migrations may need about $(( UPDATE_DB_SPACE_NEED_KB / 1024 )) MB, twice the database)."
fi

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
  # checked again here: a first run with an older update.sh had no memory check before the pull
  update_memory_check 1 || die "$UPDATE_MEMORY_MESSAGE"
  cd "$BUILD_DIR"
  log "[3/6] Installing dependencies in ${BUILD_DIR} (npm ci --include=dev)..."
  # AI Studio pulls delete package-lock.json; npm ci cannot run without it.
  if [ ! -f package-lock.json ]; then
    warn "package-lock.json missing — regenerating from package.json (npm install --package-lock-only)..."
    NODE_ENV=development npm install --include=dev --package-lock-only --no-audit --no-fund \
      || { die_if_disk_full "npm install"; die "Lockfile regeneration failed."; }
  fi
  # v11 (phase 3.3, O4): every failure of npm ci used to be taken for a lock file out of step with package.json, so a
  # network or registry hiccup regenerated the lock, installed dependency versions no release had tested and wrote that
  # lock into the git checkout, where it blocked the next git pull. Now only npm's own lock mismatch (EUSAGE) touches
  # the lock, and never a lock git tracks (a released lock that does not match is a fault of the release: the update
  # stops with the running build untouched); any other failure is retried NPM_CI_ATTEMPTS times (default 3).
  [[ "${NPM_CI_ATTEMPTS:-3}" =~ ^[1-9][0-9]*$ ]] || die "NPM_CI_ATTEMPTS must be a whole number of 1 or more."
  [[ "${NPM_CI_RETRY_DELAY:-20}" =~ ^[0-9]+$ ]] || die "NPM_CI_RETRY_DELAY must be a whole number of seconds."
  NPM_CI_OUT="$BUILD_DIR/.npm-ci.log"
  NPM_CI_ATTEMPT=1
  LOCK_REGENERATED=0
  OOM_KILLS_BEFORE="$(update_oom_kills)"
  until NODE_ENV=development npm ci --include=dev 2>&1 | tee "$NPM_CI_OUT"; do
    die_if_disk_full "npm ci"
    # killed for lack of memory, not a network failure: retrying would only be killed again
    die_if_out_of_memory "$OOM_KILLS_BEFORE" "npm ci"
    if update_npm_lock_mismatch "$NPM_CI_OUT"; then
      if git -C "$APP_DIR" ls-files --error-unmatch package-lock.json >/dev/null 2>&1; then
        die "npm ci refused the package-lock.json of this release: it does not match package.json. The service still runs the previous build, untouched; the lock file was not changed. This is a fault of the release: report it and do not regenerate the lock on the server."
      fi
      [ "$LOCK_REGENERATED" -eq 0 ] || die "npm ci failed even after lockfile regeneration."
      warn "npm ci failed: package-lock.json is out of sync with package.json. Regenerating it and retrying..."
      NODE_ENV=development npm install --include=dev --package-lock-only --no-audit --no-fund \
        || { die_if_disk_full "npm install"; die "Lockfile regeneration failed."; }
      LOCK_REGENERATED=1
      continue
    fi
    if [ "$NPM_CI_ATTEMPT" -ge "${NPM_CI_ATTEMPTS:-3}" ]; then
      die "npm ci failed ${NPM_CI_ATTEMPT} times (not a lock file mismatch: most likely the network or the npm registry). The service still runs the previous build, untouched; the lock file was not changed. Check the network and run the update again."
    fi
    NPM_CI_WAIT=$(( NPM_CI_ATTEMPT * ${NPM_CI_RETRY_DELAY:-20} ))
    warn "npm ci failed (not a lock file mismatch: most likely the network or the npm registry); retrying in ${NPM_CI_WAIT}s (attempt $(( NPM_CI_ATTEMPT + 1 )) of ${NPM_CI_ATTEMPTS:-3})..."
    sleep "$NPM_CI_WAIT"
    NPM_CI_ATTEMPT=$(( NPM_CI_ATTEMPT + 1 ))
  done
  rm -f "$NPM_CI_OUT"
  log "[4/6] Building application in ${BUILD_DIR}..."
  # the side folder has no .git: the build info takes the commit of the application directory
  rm -rf dist
  OOM_KILLS_BEFORE="$(update_oom_kills)"
  if ! GIT_COMMIT_SHA="$BUILD_COMMIT" npm run build; then
    die_if_disk_full "the build"
    die_if_out_of_memory "$OOM_KILLS_BEFORE" "the build"
    die "Build failed - the service was NOT restarted and still runs the previous build, untouched in dist/."
  fi
  if oom_kills_grew "$OOM_KILLS_BEFORE"; then
    warn "The build passed, but the kernel killed a process for lack of memory meanwhile (journalctl -k | grep -i oom names it). Before the next update, ${UPDATE_SWAP_ADVICE}."
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
# v11 (O10): the generated .env keys and the cron jobs of this version (scripts/update-steps.sh)
update_refresh_ops_config "$APP_DIR"
for note in "${UPDATE_OPS_NOTES[@]}"; do
  [ -n "$note" ] || continue
  case "$note" in WARN:*) warn "${note#WARN: }" ;; *) log "$note" ;; esac
done
# a service that did not start after an earlier update (the cause since fixed) is restarted and checked, as before
NOOP_RUNNING=0
if [ "$NOTHING_NEW" -eq 1 ] && bash scripts/verify-startup.sh "$APP_PORT" "${UPDATE_NOOP_CHECK_SECONDS:-15}" "$PKG_VERSION" >/dev/null 2>&1; then
  NOOP_RUNNING=1
fi
if [ "$NOTHING_NEW" -eq 1 ] && [ "$NOOP_RUNNING" -eq 1 ] && [ -z "$UPDATE_ENV_KEYS_ADDED" ]; then
  success "Nothing to update: v${PKG_VERSION} keeps running; no backup was taken and the service was not restarted."
  exit 0
fi
if [ "$NOTHING_NEW" -eq 1 ] && [ "$NOOP_RUNNING" -eq 0 ]; then
  log "Nothing new, but the service does not answer as started on port ${APP_PORT}: restarting it (nothing else changed)."
elif [ "$NOTHING_NEW" -eq 1 ]; then
  log "Restarting only so the service reads the keys added to .env (nothing else changed)."
fi
log "[5/6] Restarting service..."
# v11 (O16): log files an older version wrote readable by every user become private to the service's user and group
# (the new server writes them so); the folder of an older install was 0755. Only in a folder of root's own: the folder
# of a service user is that user's (phase 5.3)
if [ -d logs ] && [ ! -L logs ] && [ -O logs ]; then
  chmod 750 logs 2>/dev/null || true
  find logs -maxdepth 1 -type f ! -name '.*.lock' -perm /o=r -exec chmod o-rwx {} + 2>/dev/null || true
fi
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
