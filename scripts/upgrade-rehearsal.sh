#!/bin/bash
# scripts/upgrade-rehearsal.sh — v8.0.88 (TD-367): rehearse an upgrade on a copy of the real data
# ==============================================================================
# Run it with the NEW code in place (after `git pull` / unpacking and `npm ci`, before restarting the service):
#
#   ./scripts/upgrade-rehearsal.sh [dump-file.dump.gz]     (default: the newest dump in BACKUP_DIR)
#
#   1) restores the dump into a drill database with scripts/restore.sh (verified against the backup's manifest);
#   2) runs THIS code's migrations on that copy and compares, before and after: debit and credit of every account
#      per currency, stock and average cost of every item, stock per item and warehouse, bank balances and the
#      financial health check; rows removed and rows breaking NOT VALID constraints are listed as notes;
#   3) drops the copy (REHEARSAL_KEEP=1 keeps it for inspection).
# The live database is never touched, and no data leaves the server.
# Exit 0 = the upgrade is safe on this data; 1 = the backup is not restorable, a migration failed, or the
# migrations changed business totals (each listed).
#
# Env: the same as restore.sh (DATABASE_URL from APP_DIR/.env, RESTORE_ADMIN_URL or `sudo -u postgres`, BACKUP_DIR);
#      REHEARSAL_KEEP=1 keeps the migrated copy.
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export APP_DIR

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "Upgrade rehearsal FAILED: $*"; exit 1; }

env_file_value() {
  local key="$1" file="$APP_DIR/.env"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" | head -1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}
[ -n "${DATABASE_URL:-}" ] || DATABASE_URL="$(env_file_value DATABASE_URL)"
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL must be set (or present in $APP_DIR/.env)"
export DATABASE_URL

url_for_db() {
  local base="${DATABASE_URL%%\?*}"
  local query="${DATABASE_URL#"$base"}"
  echo "${base%/*}/$1$query"
}

TSX="$APP_DIR/node_modules/.bin/tsx"
[ -x "$TSX" ] || fail "$TSX not found — install the dependencies of the new code first (npm ci --include=dev)"

WORK_DIR="$(mktemp -d)"
DRILL_DB=""
cleanup() {
  local rc=$?
  if [ -n "$DRILL_DB" ]; then
    if [ "${REHEARSAL_KEEP:-0}" = "1" ]; then
      log "Migrated copy kept for inspection: $DRILL_DB (drop it when done)"
    else
      psql "$(url_for_db postgres)" -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DRILL_DB\";" >/dev/null 2>&1 \
        || log "WARNING: could not drop $DRILL_DB — drop it by hand"
    fi
  fi
  rm -rf "$WORK_DIR"
  exit $rc
}
trap cleanup EXIT

log "[1/2] Restoring the backup into a drill database"
set +e
RESTORE_MODE=drill RESTORE_KEEP=1 bash "$APP_DIR/scripts/restore.sh" "$@" 2>&1 | tee "$WORK_DIR/restore.log"
RESTORE_RC=${PIPESTATUS[0]}
set -e
DRILL_DB="$(grep -o 'Drill database kept for inspection: [A-Za-z0-9_]*' "$WORK_DIR/restore.log" | tail -1 | awk '{print $NF}' || true)"
[ "$RESTORE_RC" -eq 0 ] || fail "the backup did not pass the restore drill (above); fix the backup first"
[ -n "$DRILL_DB" ] || fail "restore.sh did not report the drill database"

log "[2/2] Running this code's migrations on the copy and comparing before and after"
if (cd "$APP_DIR" && DATABASE_URL="$(url_for_db "$DRILL_DB")" "$TSX" scripts/upgrade-rehearsal.ts); then
  log "SUCCESS: the migrations of this code run on a copy of the backup without changing business totals"
else
  fail "see above — do NOT restart the service on this code before the cause is fixed"
fi
