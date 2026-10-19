#!/bin/bash
# scripts/nightly-verify.sh — v10.2.16 (O-04, 10.2 package 13): the nightly check on a copy of the latest good backup
# ==============================================================================
#   ./scripts/nightly-verify.sh [dump-file.dump.gz]   (default: the daily dump BACKUP_DIR/.last_daily_ok names; a dump
#                                                      named by hand is not refused for its age)
#
#   1) restores the dump into a drill database with scripts/restore.sh (verified against the backup's manifest);
#   2) runs the financial health check and every business invariant on that copy (scripts/nightly-verify.ts, read
#      only) and compares the counts with the last healthy night;
#   3) drops the copy and writes the report the system health page shows (APP_DIR/logs/nightly-verify.json).
# The live database is never touched and no data leaves the server. scripts/install-ops-cron.sh runs it every day at
# NIGHTLY_VERIFY_HOUR:NIGHTLY_VERIFY_MINUTE (default 04:00, after the 02:30 backup) as root, because creating the drill
# database needs `sudo -u postgres` (or RESTORE_ADMIN_URL in .env).
#
# Safety:
#   - one run at a time (flock), and a night is skipped (exit 0, the old report stays) while a backup, an upgrade
#     rehearsal, an update or a restore is running;
#   - the dump is the one backup.sh last finished (.last_daily_ok), refused when older than
#     NIGHTLY_VERIFY_MAX_DUMP_AGE_HOURS (26);
#   - before restoring, the free space of the database's data and WAL disks and of the temporary directory is compared
#     with the database size and the dump size, keeping 10% of each disk free; not enough room is a failed night;
#   - the temporary files go under BACKUP_DIR/.nightly-verify-tmp (the backup disk), never /tmp;
#   - the restore and the check run under `timeout` (NIGHTLY_VERIFY_TIMEOUT seconds, default 7200) at low CPU and disk
#     priority (nice, ionice); the drill copy is dropped on every exit, and copies older than 12 hours left by a killed
#     run are dropped at the next start (younger ones may be an upgrade rehearsal's and are left alone);
#   - passwords never appear on a command line: they go to psql through a PGPASSFILE (mode 600) and to the check
#     through its environment.
# Exit 0 = the backup restores and nothing got worse, or the night was skipped; 1 = otherwise (the report says what).
#
# Env: the same as restore.sh (DATABASE_URL from APP_DIR/.env, RESTORE_ADMIN_URL, BACKUP_DIR);
#      NIGHTLY_VERIFY_REPORT (also read from .env) overrides the report file.
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
[ -n "${RESTORE_ADMIN_URL:-}" ] || RESTORE_ADMIN_URL="$(env_file_value RESTORE_ADMIN_URL)"
[ -n "${BACKUP_DIR:-}" ] || BACKUP_DIR="$(env_file_value BACKUP_DIR)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp}"
export BACKUP_DIR
# the same value the service reads (process.env with the app's .env)
[ -n "${NIGHTLY_VERIFY_REPORT:-}" ] || NIGHTLY_VERIFY_REPORT="$(env_file_value NIGHTLY_VERIFY_REPORT)"
REPORT="${NIGHTLY_VERIFY_REPORT:-$APP_DIR/logs/nightly-verify.json}"
TIMEOUT_SECONDS="${NIGHTLY_VERIFY_TIMEOUT:-7200}"
MAX_DUMP_AGE_HOURS="${NIGHTLY_VERIFY_MAX_DUMP_AGE_HOURS:-26}"
DRILL_MAX_AGE_HOURS=12
FREE_MARGIN_PERCENT=10
BUSY_PATTERN="${NIGHTLY_VERIFY_BUSY_PATTERN:-scripts/(backup|upgrade-rehearsal|restore)\.sh( |$)|(^|[ /])update\.sh( |$)}"
DRILL_RE='^erp_restore_drill_[0-9]{8}_[0-9]{6}$'

TSX="$APP_DIR/node_modules/.bin/tsx"
[ -x "$TSX" ] || fail "$TSX not found — install the dependencies (npm ci --include=dev)"

# one run at a time; the lock is ours alone, so the other jobs that restore or rebuild are looked for by name
LOCK_FILE="$APP_DIR/logs/.nightly-verify.lock"
mkdir -p "$(dirname "$LOCK_FILE")" "$(dirname "$REPORT")"
exec 9>"$LOCK_FILE"
flock -n 9 || { log "SKIPPED: another nightly check is still running"; exit 0; }
if pgrep -f -- "$BUSY_PATTERN" >/dev/null 2>&1; then
  log "SKIPPED: a backup, an upgrade rehearsal, an update or a restore is running; the check runs again next night"
  exit 0
fi

# ---------- temporary files on the backup disk ----------
TMP_ROOT="$BACKUP_DIR/.nightly-verify-tmp"
mkdir -p "$TMP_ROOT"
chmod 700 "$TMP_ROOT"
find "$TMP_ROOT" -mindepth 1 -maxdepth 1 -mmin +720 -exec rm -rf {} + 2>/dev/null || true
export TMPDIR="$TMP_ROOT"
WORK_DIR="$(mktemp -d)"

# ---------- passwords through a PGPASSFILE, never on a command line ----------
PGPASSFILE="$WORK_DIR/pgpass"
( umask 077; : > "$PGPASSFILE" )
export PGPASSFILE
FULL_DATABASE_URL="$DATABASE_URL"
URL_RE='^(postgres(ql)?://)([^:@/]+)(:([^@]*))?@([^/?]*)(.*)$'
url_decode() { local v="${1//+/ }"; printf '%b' "${v//%/\\x}"; }
pgpass_field() { printf '%s' "$1" | sed -e 's/[\\:]/\\&/g'; }
# prints the URL without its password and adds host:port:*:user:password to the PGPASSFILE
strip_password() {
  local url="$1"
  if [[ "$url" =~ $URL_RE ]] && [ -n "${BASH_REMATCH[4]}" ]; then
    local scheme="${BASH_REMATCH[1]}" user="${BASH_REMATCH[3]}" pass="${BASH_REMATCH[5]}" hostport="${BASH_REMATCH[6]}" rest="${BASH_REMATCH[7]}"
    local host="${hostport%%:*}" port="5432"
    [ "$hostport" = "$host" ] || port="${hostport##*:}"
    printf '%s:%s:*:%s:%s\n' "$(pgpass_field "${host:-localhost}")" "$port" "$(pgpass_field "$(url_decode "$user")")" \
      "$(pgpass_field "$(url_decode "$pass")")" >> "$PGPASSFILE"
    echo "${scheme}${user}@${hostport}${rest}"
  else
    echo "$url"
  fi
}
DATABASE_URL="$(strip_password "$DATABASE_URL")"
export DATABASE_URL
if [ -n "${RESTORE_ADMIN_URL:-}" ]; then
  RESTORE_ADMIN_URL="$(strip_password "$RESTORE_ADMIN_URL")"
  export RESTORE_ADMIN_URL
fi

# a URL of another database on the same server (query string kept); the second argument picks the URL
url_for_db() {
  local source="${2:-$DATABASE_URL}"
  local base="${source%%\?*}"
  local query="${source#"$base"}"
  echo "${base%/*}/$1$query"
}
maint_sql() { psql "$(url_for_db postgres)" -X -q -tA -v ON_ERROR_STOP=1 -c "$1"; }

# drops a drill copy; any other name is refused
drop_drill() {
  local db="$1"
  if ! [[ "$db" =~ $DRILL_RE ]]; then
    log "WARNING: refused to drop $db (not a drill copy)"
    return 1
  fi
  maint_sql "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);" >/dev/null 2>&1 \
    || maint_sql "DROP DATABASE IF EXISTS \"$db\";" >/dev/null 2>&1 \
    || { [ -n "${RESTORE_ADMIN_URL:-}" ] && psql "$RESTORE_ADMIN_URL" -X -q -tA -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\";" >/dev/null 2>&1; }
}

# the drill copy restore.sh announces ("Creating database <name>") — read from its log, so a killed run finds it too
drill_from_log() {
  [ -f "$WORK_DIR/restore.log" ] || return 0
  grep -oE 'Creating database erp_restore_drill_[0-9]{8}_[0-9]{6}' "$WORK_DIR/restore.log" | tail -1 | awk '{print $3}' || true
}

DRILL_DB=""
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  [ -n "$DRILL_DB" ] || DRILL_DB="$(drill_from_log)"
  if [ -n "$DRILL_DB" ]; then
    drop_drill "$DRILL_DB" || log "WARNING: could not drop $DRILL_DB — the next run drops it after ${DRILL_MAX_AGE_HOURS} hours"
  fi
  rm -rf "$WORK_DIR"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# the report belongs to the owner of the log directory (the service user), so the app can read it
report_owner() {
  [ "$(id -u)" -eq 0 ] || return 0
  [ -f "$REPORT" ] && chown "$(stat -c %U "$(dirname "$REPORT")")" "$REPORT" 2>/dev/null || true
}

BACKUP_FILE=""
BACKUP_AT=""
# a night that could not be checked: written as a failed report, then exit 1
night_failed() {
  local reason="$1" detail="${2:-}"
  local args=(scripts/nightly-verify.ts --report "$REPORT" --backup "$BACKUP_FILE" --failed "$reason")
  [ -z "$BACKUP_AT" ] || args+=(--backup-at "$BACKUP_AT")
  [ -z "$detail" ] || args+=(--detail "$detail")
  (cd "$APP_DIR" && LOG_DIR="$WORK_DIR/logs" "$TSX" "${args[@]}") || true
  report_owner
  fail "$reason${detail:+: $detail}"
}

# ---------- drill copies a killed run left behind ----------
NOW=$(date +%s)
if OLD_DRILLS="$(maint_sql "SELECT datname FROM pg_database WHERE datname LIKE 'erp\\_restore\\_drill\\_%'" 2>/dev/null)"; then
  for db in $OLD_DRILLS; do
    [[ "$db" =~ $DRILL_RE ]] || continue
    stamp="${db#erp_restore_drill_}"
    created=$(date -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s 2>/dev/null) || continue
    if [ $((NOW - created)) -gt $((DRILL_MAX_AGE_HOURS * 3600)) ]; then
      if drop_drill "$db"; then log "Dropped the drill copy $db left by an earlier run"; else log "WARNING: could not drop the old drill copy $db"; fi
    fi
  done
else
  log "WARNING: could not list the drill copies; old ones are not dropped this night"
fi

# ---------- the dump ----------
if [ -n "${1:-}" ]; then
  BACKUP_FILE="$1"
  [ -f "$BACKUP_FILE" ] || night_failed no_dump "$BACKUP_FILE not found"
  BACKUP_AT="$(stat -c %Y "$BACKUP_FILE")"
else
  MARKER="$BACKUP_DIR/.last_daily_ok"
  stamp="" name=""
  [ -f "$MARKER" ] && read -r stamp name < "$MARKER" || true
  if ! [[ "$stamp" =~ ^[0-9]+$ ]] || ! [[ "$name" =~ ^erp_daily_[0-9_]+$ ]] || [ ! -f "$BACKUP_DIR/$name.dump.gz" ]; then
    night_failed no_dump "no finished daily backup named by $MARKER"
  fi
  BACKUP_FILE="$BACKUP_DIR/$name.dump.gz"
  BACKUP_AT="$stamp"
  # the nightly run checks a recent backup; a dump named by hand may be of any age
  if [ $((NOW - BACKUP_AT)) -gt $((MAX_DUMP_AGE_HOURS * 3600)) ]; then
    night_failed stale_dump "$(basename "$BACKUP_FILE") is $(( (NOW - BACKUP_AT) / 3600 )) hours old"
  fi
fi

# ---------- free space ----------
# the dump unpacked into the temporary directory, the database as large as it is now on the data disk and one GiB of WAL on the WAL disk; each disk keeps 10% free
GIB=1073741824
read -r packed unpacked _ < <(gzip -l "$BACKUP_FILE" 2>/dev/null | awk 'NR == 2') || true
if ! [[ "${packed:-}" =~ ^[0-9]+$ ]] || ! [[ "${unpacked:-}" =~ ^[0-9]+$ ]]; then
  night_failed space_unknown "gzip -l could not read $(basename "$BACKUP_FILE")"
fi
# a size 4 GiB or more is reported modulo 4 GiB; a dump (already compressed by pg_dump) never shrinks much in gzip, so
# a reported size well below the packed size has wrapped
while [ $(( packed - unpacked )) -gt 1048576 ]; do unpacked=$((unpacked + 4 * GIB)); done
DB_BYTES="$(psql "$DATABASE_URL" -X -tA -c 'SELECT pg_database_size(current_database())' 2>/dev/null || true)"
[[ "$DB_BYTES" =~ ^[0-9]+$ ]] || night_failed space_unknown "the size of the live database could not be read"

DB_HOST=""
[[ "$DATABASE_URL" =~ $URL_RE ]] && DB_HOST="${BASH_REMATCH[6]%%:*}"
DATA_DIR=""
case "$DB_HOST" in
  ''|localhost|127.0.0.1|'[::1]'|/*)
    q='SHOW data_directory'
    DATA_DIR="$(psql "$DATABASE_URL" -X -tA -c "$q" 2>/dev/null || true)"
    if [ -z "$DATA_DIR" ] && [ -n "${RESTORE_ADMIN_URL:-}" ]; then DATA_DIR="$(psql "$RESTORE_ADMIN_URL" -X -tA -c "$q" 2>/dev/null || true)"; fi
    if [ -z "$DATA_DIR" ] && command -v sudo >/dev/null 2>&1; then DATA_DIR="$(sudo -n -u postgres psql -X -tA -d postgres -c "$q" 2>/dev/null || true)"; fi
    [ -n "$DATA_DIR" ] && [ -d "$DATA_DIR" ] || night_failed space_unknown "the data directory of the local PostgreSQL could not be read"
    ;;
  *) log "The database server $DB_HOST is not this machine: only the temporary directory's disk is checked" ;;
esac

declare -A NEED=() SIZE=() AVAIL=()
add_need() {
  local dir="$1" bytes="$2" line size avail mount
  line="$(df -PB1 "$dir" 2>/dev/null | awk 'NR == 2 {print $2, $4, $6}' || true)"
  [ -n "$line" ] || night_failed space_unknown "df could not read $dir"
  read -r size avail mount <<< "$line"
  SIZE[$mount]="$size"
  AVAIL[$mount]="$avail"
  NEED[$mount]=$(( ${NEED[$mount]:-0} + bytes ))
}
add_need "$WORK_DIR" "$unpacked"
if [ -n "$DATA_DIR" ]; then
  add_need "$DATA_DIR" "$DB_BYTES"
  WAL_DIR="$(readlink -f "$DATA_DIR/pg_wal" 2>/dev/null || true)"
  [ -n "$WAL_DIR" ] && [ -d "$WAL_DIR" ] || WAL_DIR="$DATA_DIR"
  add_need "$WAL_DIR" "$GIB"
fi
for mount in "${!NEED[@]}"; do
  keep=$(( SIZE[$mount] * FREE_MARGIN_PERCENT / 100 ))
  if [ $(( AVAIL[$mount] - NEED[$mount] )) -lt "$keep" ]; then
    night_failed no_space "$mount needs ${NEED[$mount]} bytes and ${FREE_MARGIN_PERCENT}% free, ${AVAIL[$mount]} bytes available"
  fi
done
log "Free space checked: dump $unpacked bytes unpacked, database $DB_BYTES bytes"

# ---------- restore and check, under one time limit and at low priority ----------
DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))
LOW_PRIORITY=(nice -n 10)
command -v ionice >/dev/null 2>&1 && LOW_PRIORITY+=(ionice -c 2 -n 7)
remaining() { echo $(( DEADLINE - $(date +%s) )); }
timed_out() { [ "$1" -eq 124 ] || [ "$1" -eq 137 ]; }

log "[1/2] Restoring $(basename "$BACKUP_FILE") into a drill database"
set +e
(
  export RESTORE_MODE=drill RESTORE_KEEP=1
  timeout --kill-after=60 "$(remaining)" "${LOW_PRIORITY[@]}" bash "$APP_DIR/scripts/restore.sh" "$BACKUP_FILE"
) 2>&1 | tee "$WORK_DIR/restore.log"
RESTORE_RC=${PIPESTATUS[0]}
set -e
DRILL_DB="$(drill_from_log)"
timed_out "$RESTORE_RC" && night_failed timeout "the restore did not finish within $TIMEOUT_SECONDS seconds"
if [ "$RESTORE_RC" -ne 0 ] || [ -z "$DRILL_DB" ] || ! grep -q "Drill database kept for inspection: $DRILL_DB" "$WORK_DIR/restore.log"; then
  night_failed restore "the backup did not pass the restore drill (above)"
fi

log "[2/2] Checking the accounts and stock on the copy"
[ "$(remaining)" -gt 0 ] || night_failed timeout "no time left for the check after the restore"
set +e
(
  cd "$APP_DIR"
  # the full URL goes only through the environment
  export LOG_DIR="$WORK_DIR/logs" DATABASE_URL
  DATABASE_URL="$(url_for_db "$DRILL_DB" "$FULL_DATABASE_URL")"
  timeout --kill-after=60 "$(remaining)" "${LOW_PRIORITY[@]}" "$TSX" scripts/nightly-verify.ts --report "$REPORT" \
    --backup "$BACKUP_FILE" --backup-at "$BACKUP_AT"
)
CHECK_RC=$?
set -e
timed_out "$CHECK_RC" && night_failed timeout "the check did not finish within $TIMEOUT_SECONDS seconds"
report_owner
[ "$CHECK_RC" -eq 0 ] || fail "see above; the system health page shows the same result"
log "SUCCESS: the latest backup restores and its accounts and stock are not worse than the last healthy night"
