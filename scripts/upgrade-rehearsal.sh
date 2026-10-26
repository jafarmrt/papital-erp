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

# v11 (O5): read as the service reads it (node --env-file: the last line wins, «export», inline comments), one reader
# for every script (scripts/env-file.sh)
# shellcheck source=scripts/env-file.sh
source "$(dirname "${BASH_SOURCE[0]}")/env-file.sh"
env_file_value() { env_file_get "$APP_DIR/.env" "$1"; }
# v11 (O13): the busy lock the nightly check and update.sh look for (scripts/ops-lock.sh)
# shellcheck source=scripts/ops-lock.sh
source "$(dirname "${BASH_SOURCE[0]}")/ops-lock.sh"
ops_busy_hold "$APP_DIR"
[ -n "${DATABASE_URL:-}" ] || DATABASE_URL="$(env_file_value DATABASE_URL)"
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL must be set (or present in $APP_DIR/.env)"
export DATABASE_URL

# a URL of another database on the same server; the second argument picks the URL (DATABASE_URL by default)
url_for_db() {
  local source="${2:-$DATABASE_URL}"
  local base="${source%%\?*}"
  local query="${source#"$base"}"
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
# v10.2.28 (TD-1351, #346 review M1: after the trap, so any exit removes it): psql and restore.sh get the password through a PGPASSFILE in WORK_DIR, not a command line;
# the migrations (Node) get the full URL through their environment
# shellcheck source=scripts/pg-password.sh
. "$APP_DIR/scripts/pg-password.sh"
pg_password_setup "$WORK_DIR"

log "[1/2] Restoring the backup into a drill database"
set +e
RESTORE_MODE=drill RESTORE_KEEP=1 bash "$APP_DIR/scripts/restore.sh" "$@" 2>&1 | tee "$WORK_DIR/restore.log"
RESTORE_RC=${PIPESTATUS[0]}
set -e
DRILL_DB="$(grep -o 'Drill database kept for inspection: [A-Za-z0-9_]*' "$WORK_DIR/restore.log" | tail -1 | awk '{print $NF}' || true)"
[ "$RESTORE_RC" -eq 0 ] || fail "the backup did not pass the restore drill (above); fix the backup first"
[ -n "$DRILL_DB" ] || fail "restore.sh did not report the drill database"

log "[2/2] Running this code's migrations on the copy and comparing before and after"
if (cd "$APP_DIR" && DATABASE_URL="$(url_for_db "$DRILL_DB" "$PG_FULL_DATABASE_URL")" "$TSX" scripts/upgrade-rehearsal.ts); then
  log "SUCCESS: the migrations of this code run on a copy of the backup without changing business totals"
else
  fail "see above — do NOT restart the service on this code before the cause is fixed"
fi
