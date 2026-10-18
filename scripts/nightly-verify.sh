#!/bin/bash
# scripts/nightly-verify.sh — v10.2.14 (O-04, 10.2 package 13): the nightly check on a copy of last night's backup
# ==============================================================================
#   ./scripts/nightly-verify.sh [dump-file.dump.gz]     (default: the newest daily dump in BACKUP_DIR)
#
#   1) restores the dump into a drill database with scripts/restore.sh (verified against the backup's manifest);
#   2) runs the financial health check and every business invariant on that copy (scripts/nightly-verify.ts, read
#      only) and compares the counts with the night before;
#   3) drops the copy and writes the report the system health page shows (APP_DIR/logs/nightly-verify.json).
# The live database is never touched and no data leaves the server. scripts/install-ops-cron.sh runs it every day at
# NIGHTLY_VERIFY_HOUR:NIGHTLY_VERIFY_MINUTE (default 04:00, after the 02:30 backup) as root, because creating the drill
# database needs `sudo -u postgres` (or RESTORE_ADMIN_URL in .env).
# Exit 0 = the backup restores and nothing got worse; 1 = otherwise (the report says what).
#
# Env: the same as restore.sh (DATABASE_URL from APP_DIR/.env, RESTORE_ADMIN_URL, BACKUP_DIR);
#      NIGHTLY_VERIFY_REPORT overrides the report file.
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export APP_DIR

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "Nightly check FAILED: $*"; exit 1; }

env_file_value() {
  local key="$1" file="$APP_DIR/.env"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" | head -1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}
[ -n "${DATABASE_URL:-}" ] || DATABASE_URL="$(env_file_value DATABASE_URL)"
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL must be set (or present in $APP_DIR/.env)"
export DATABASE_URL
[ -n "${RESTORE_ADMIN_URL:-}" ] || RESTORE_ADMIN_URL="$(env_file_value RESTORE_ADMIN_URL)"
[ -z "${RESTORE_ADMIN_URL:-}" ] || export RESTORE_ADMIN_URL
[ -n "${BACKUP_DIR:-}" ] || BACKUP_DIR="$(env_file_value BACKUP_DIR)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp}"
export BACKUP_DIR
REPORT="${NIGHTLY_VERIFY_REPORT:-$APP_DIR/logs/nightly-verify.json}"

url_for_db() {
  local base="${DATABASE_URL%%\?*}"
  local query="${DATABASE_URL#"$base"}"
  echo "${base%/*}/$1$query"
}

TSX="$APP_DIR/node_modules/.bin/tsx"
[ -x "$TSX" ] || fail "$TSX not found — install the dependencies (npm ci --include=dev)"

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/erp_daily_*.dump.gz 2>/dev/null | head -1 || true)
  [ -n "$BACKUP_FILE" ] || fail "no daily dump in $BACKUP_DIR"
fi

# one run at a time (a slow night must not overlap the next one or an upgrade rehearsal's drill)
LOCK_FILE="$APP_DIR/logs/.nightly-verify.lock"
mkdir -p "$(dirname "$LOCK_FILE")" "$(dirname "$REPORT")"
exec 9>"$LOCK_FILE"
flock -n 9 || fail "another nightly check is still running"

WORK_DIR="$(mktemp -d)"
DRILL_DB=""
cleanup() {
  local rc=$?
  if [ -n "$DRILL_DB" ]; then
    psql "$(url_for_db postgres)" -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DRILL_DB\";" >/dev/null 2>&1 \
      || log "WARNING: could not drop $DRILL_DB — drop it by hand"
  fi
  rm -rf "$WORK_DIR"
  exit $rc
}
trap cleanup EXIT

# the report belongs to the owner of the log directory (the service user), so the app can read it
report_owner() {
  [ "$(id -u)" -eq 0 ] || return 0
  [ -f "$REPORT" ] && chown "$(stat -c %U "$(dirname "$REPORT")")" "$REPORT" 2>/dev/null || true
}

# the application log files belong to the service user: a run as root must not create them
log "[1/2] Restoring $(basename "$BACKUP_FILE") into a drill database"
set +e
RESTORE_MODE=drill RESTORE_KEEP=1 bash "$APP_DIR/scripts/restore.sh" "$BACKUP_FILE" 2>&1 | tee "$WORK_DIR/restore.log"
RESTORE_RC=${PIPESTATUS[0]}
set -e
DRILL_DB="$(grep -o 'Drill database kept for inspection: [A-Za-z0-9_]*' "$WORK_DIR/restore.log" | tail -1 | awk '{print $NF}' || true)"
if [ "$RESTORE_RC" -ne 0 ] || [ -z "$DRILL_DB" ]; then
  (cd "$APP_DIR" && LOG_DIR="$WORK_DIR/logs" "$TSX" scripts/nightly-verify.ts --report "$REPORT" --backup "$BACKUP_FILE" --restore-failed) || true
  report_owner
  fail "the backup did not pass the restore drill (above)"
fi

log "[2/2] Checking the accounts and stock on the copy"
set +e
(cd "$APP_DIR" && LOG_DIR="$WORK_DIR/logs" DATABASE_URL="$(url_for_db "$DRILL_DB")" "$TSX" scripts/nightly-verify.ts --report "$REPORT" --backup "$BACKUP_FILE")
CHECK_RC=$?
set -e
report_owner
[ "$CHECK_RC" -eq 0 ] || fail "see above; the system health page shows the same result"
log "SUCCESS: last night's backup restores and its accounts and stock are not worse than the night before"
