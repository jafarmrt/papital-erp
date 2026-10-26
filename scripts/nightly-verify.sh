#!/bin/bash
# scripts/nightly-verify.sh — v10.2.16 (O-04, 10.2 package 13): the nightly check on a copy of the latest good backup
# ==============================================================================
#   ./scripts/nightly-verify.sh [dump-file.dump.gz]   (default: the daily dump BACKUP_DIR/.last_daily_ok names; a dump
#                                                      named by hand is not refused for its age)
#   ./scripts/nightly-verify.sh --accept-baseline      (accepts the findings of the last report as the new normal)
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
#     NIGHTLY_VERIFY_MAX_DUMP_AGE_HOURS (26), and a failed night when it is the same dump the previous night checked
#     more than 12 hours ago (no new backup was taken);
#   - before restoring, the free space of the database's data and WAL disks and of the temporary directory is compared
#     with what the restore writes there (v10.3.24, TD-1352: the database and its largest index again, for the sort
#     files of the index rebuild; WAL up to twice max_wal_size, less the WAL already there; the dump unpacked), keeping 10% of
#     each disk free; not enough room is a failed night;
#   - the restore's temporary files go under BACKUP_DIR/.nightly-verify-tmp (the backup disk), never /tmp;
#   - the restore and the check run under `timeout` (NIGHTLY_VERIFY_TIMEOUT seconds, default 7200) at low CPU and disk
#     priority (nice, ionice), every other database call and df under a 120-second limit; stopping the script stops
#     the restore at once; the drill copy is dropped on every exit, and copies older than 12 hours are dropped at the
#     next start (younger ones may be an upgrade rehearsal's and are left alone; an older copy kept on purpose with
#     RESTORE_KEEP=1 or REHEARSAL_KEEP=1 is dropped too);
#   - passwords never appear on a command line: they go to psql through a PGPASSFILE (mode 600) and to the check
#     through its environment.
# A failed or worse night is shown on the system health page, and since v10.3.24 (TD-1350) scripts/monitor.sh reads the
# report and sends the alert.
# Exit 0 = the backup restores and nothing got worse, or the night was skipped; 1 = otherwise (the report says what).
#
# Env: the same as restore.sh (DATABASE_URL from APP_DIR/.env, RESTORE_ADMIN_URL, BACKUP_DIR); NIGHTLY_VERIFY_REPORT,
#      NIGHTLY_VERIFY_TIMEOUT and NIGHTLY_VERIFY_MAX_DUMP_AGE_HOURS, each also read from .env (cron gives no environment).
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export APP_DIR

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "Nightly check FAILED: $*"; exit 1; }

# v11 (O5): read as the service reads it (node --env-file: the last line wins, «export», inline comments), one reader
# for every script (scripts/env-file.sh)
# shellcheck source=scripts/env-file.sh
source "$(dirname "${BASH_SOURCE[0]}")/env-file.sh"
env_file_value() { env_file_get "$APP_DIR/.env" "$1"; }
[ -n "${DATABASE_URL:-}" ] || DATABASE_URL="$(env_file_value DATABASE_URL)"
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL must be set (or present in $APP_DIR/.env)"
[ -n "${RESTORE_ADMIN_URL:-}" ] || RESTORE_ADMIN_URL="$(env_file_value RESTORE_ADMIN_URL)"
[ -n "${BACKUP_DIR:-}" ] || BACKUP_DIR="$(env_file_value BACKUP_DIR)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp}"
# a relative folder is under APP_DIR, whichever directory cron, update.sh or a shell starts from (v10.3.24)
case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$APP_DIR/$BACKUP_DIR" ;; esac
export BACKUP_DIR
# the same value the service reads (process.env with the app's .env)
[ -n "${NIGHTLY_VERIFY_REPORT:-}" ] || NIGHTLY_VERIFY_REPORT="$(env_file_value NIGHTLY_VERIFY_REPORT)"
REPORT="${NIGHTLY_VERIFY_REPORT:-$APP_DIR/logs/nightly-verify.json}"
# a whole number from .env or the environment, else the default
setting_number() {
  local key="$1" default="$2" value="${!1:-}"
  [ -n "$value" ] || value="$(env_file_value "$key")"
  if [ -z "$value" ]; then echo "$default"; return; fi
  if ! [[ "$value" =~ ^[0-9]{1,9}$ ]] || [ $((10#$value)) -lt 1 ]; then
    log "WARNING: $key=$value is not a whole number above zero; $default is used" >&2
    echo "$default"
    return
  fi
  echo $((10#$value))
}
TIMEOUT_SECONDS="$(setting_number NIGHTLY_VERIFY_TIMEOUT 7200)"
MAX_DUMP_AGE_HOURS="$(setting_number NIGHTLY_VERIFY_MAX_DUMP_AGE_HOURS 26)"
DRILL_MAX_AGE_HOURS=12
FREE_MARGIN_PERCENT=10
# v11 (O13): the other jobs are seen by their locks (scripts/ops-lock.sh), never by their names in the process list
# shellcheck source=scripts/ops-lock.sh
source "$(dirname "${BASH_SOURCE[0]}")/ops-lock.sh"
DRILL_RE='^erp_restore_drill_[0-9]{8}_[0-9]{6}$'
# a database that never answers must not hold the lock for every later night
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-30}"
CALL_LIMIT=120

TSX="$APP_DIR/node_modules/.bin/tsx"
[ -x "$TSX" ] || fail "$TSX not found — install the dependencies (npm ci --include=dev)"

# v11 (phase 5.3, TD-1354): a folder of root's own for what root keeps (the lock, the temporary files): made in /var/lib,
# where only root writes; a folder of that name that root does not own is never used
root_state_dir() {
  if [ -L "$1" ] || { [ -e "$1" ] && [ ! -O "$1" ]; }; then fail "$1 is a link or not owned by root; remove it or set its path"; fi
  [ -d "$1" ] || install -d -m 700 "$1"
}

# one run at a time
LOCK_FILE="$APP_DIR/logs/.nightly-verify.lock"
mkdir -p "$(dirname "$LOCK_FILE")" "$(dirname "$REPORT")"
# v11 (phase 5.3, TD-1354): logs/ belongs to the service user, which could put a link or a FIFO there (opening a FIFO
# waits forever); root keeps its lock in a folder of its own then
if [ "$(id -u)" -eq 0 ] && [ ! -O "$(dirname "$LOCK_FILE")" ]; then
  LOCK_FILE="${NIGHTLY_VERIFY_ROOT_LOCK:-/var/lib/papital-erp/nightly-verify.lock}"
  root_state_dir "$(dirname "$LOCK_FILE")"
fi
# made only when nothing of that name exists (noclobber: O_EXCL) and opened for reading, so no file is ever truncated
( set -C; : > "$LOCK_FILE" ) 2>/dev/null || true
[ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] || fail "the lock $LOCK_FILE is a link or not a plain file"
exec 9<"$LOCK_FILE"
if ! flock -n 9; then
  if [ "${1:-}" = "--accept-baseline" ]; then
    log "NOT ACCEPTED: a nightly check is still running; run --accept-baseline again after it finishes"
    exit 1
  fi
  log "SKIPPED: another nightly check is still running"
  exit 0
fi

# v11 (phase 5.3, TD-1354): the check reads and writes its report in a private copy (REPORT_WORK, in WORK_DIR); the
# report in logs/ is read only when it is a plain file and written back as the owner of logs/ (the service user, which
# the app reads it as), so root never reads or writes through a link the service user put there
REPORT_OWNER="$(stat -c %U "$(dirname "$REPORT")" 2>/dev/null || echo root)"
as_report_owner() {
  if [ "$(id -u)" -eq 0 ] && [ "$REPORT_OWNER" != "root" ] && command -v runuser >/dev/null 2>&1; then
    runuser -u "$REPORT_OWNER" -- "$@"
  else
    "$@"
  fi
}
report_in() {
  # shellcheck disable=SC2016
  as_report_owner sh -c '[ -f "$1" ] && [ ! -L "$1" ] && head -c 16777216 -- "$1"' report "$REPORT" > "$REPORT_WORK" 2>/dev/null || true
}
report_out() {
  [ -s "$REPORT_WORK" ] || return 0
  # shellcheck disable=SC2016
  as_report_owner sh -c 'cat > "$1.tmp" && chmod 644 "$1.tmp" && mv -f "$1.tmp" "$1"' report "$REPORT" < "$REPORT_WORK" \
    || log "WARNING: the report could not be written to $REPORT"
}

if [ "${1:-}" = "--accept-baseline" ]; then
  rc=0
  REPORT_WORK="$(mktemp)"
  report_in
  (cd "$APP_DIR" && "$TSX" scripts/nightly-verify.ts --report "$REPORT_WORK" --accept-baseline) || rc=$?
  report_out
  rm -f "$REPORT_WORK"
  exit "$rc"
fi
if ops_busy_now "$APP_DIR"; then
  log "SKIPPED: a backup, an upgrade rehearsal, an update or a restore is running; the check runs again next night"
  exit 0
fi

# ---------- temporary files on the backup disk ----------
# only restore.sh gets TMPDIR: a long path there breaks the socket tsx opens in it
TMP_ROOT="${NIGHTLY_VERIFY_TMP:-$BACKUP_DIR/.nightly-verify-tmp}"
# v11 (phase 5.3, TD-1354): root never works in a folder of the service user (it could swap a folder there for a link);
# its files then go to a folder of root's own
if [ -z "${NIGHTLY_VERIFY_TMP:-}" ] && [ "$(id -u)" -eq 0 ] && [ ! -O "$BACKUP_DIR" ]; then
  TMP_ROOT="${NIGHTLY_VERIFY_ROOT_TMP:-/var/lib/papital-erp/nightly-verify-tmp}"
  root_state_dir "$(dirname "$TMP_ROOT")"
  root_state_dir "$TMP_ROOT"
fi
mkdir -p "$TMP_ROOT"
chmod 700 "$TMP_ROOT"
find "$TMP_ROOT" -mindepth 1 -maxdepth 1 -mmin +720 -exec rm -rf {} + 2>/dev/null || true
WORK_DIR="$(mktemp -d -p "$TMP_ROOT")"
REPORT_WORK="$WORK_DIR/nightly-verify.json"
report_in

# ---------- passwords through a PGPASSFILE, never on a command line ----------
PGPASSFILE="$WORK_DIR/pgpass"
( umask 077; : > "$PGPASSFILE" )
export PGPASSFILE
FULL_DATABASE_URL="$DATABASE_URL"
URL_RE='^(postgres(ql)?://)([^:@/]+)(:([^@]*))?@([^/?]*)(.*)$'
# percent-decoding as libpq does it: a + stays a +, and a backslash is a plain character
url_decode() { local v="${1//\\/\\\\}"; printf '%b' "${v//%/\\x}"; }
pgpass_field() { printf '%s' "$1" | sed -e 's/[\\:]/\\&/g'; }
# host and port of the URL's host part; an IPv6 address comes without its brackets ([::1]:5433 -> ::1 5433)
split_hostport() {
  local hostport="$1" host port=""
  if [[ "$hostport" == \[* ]]; then
    host="${hostport%%]*}"
    host="${host#[}"
    [[ "$hostport" == *]:* ]] && port="${hostport##*]:}"
  else
    host="${hostport%%:*}"
    [ "$hostport" = "$host" ] || port="${hostport##*:}"
  fi
  echo "${host:-localhost} ${port:-5432}"
}
# prints the URL without its password and adds host:port:*:user:password to the PGPASSFILE
strip_password() {
  local url="$1"
  if [[ "$url" =~ $URL_RE ]] && [ -n "${BASH_REMATCH[4]}" ]; then
    local scheme="${BASH_REMATCH[1]}" user="${BASH_REMATCH[3]}" pass="${BASH_REMATCH[5]}" hostport="${BASH_REMATCH[6]}" rest="${BASH_REMATCH[7]}"
    local host port
    read -r host port <<< "$(split_hostport "$hostport")"
    printf '%s:%s:*:%s:%s\n' "$(pgpass_field "$host")" "$port" "$(pgpass_field "$(url_decode "$user")")" \
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
# v11 (O14): an exported PGPASSWORD must not beat the lines above (scripts/pg-password.sh)
# shellcheck source=scripts/pg-password.sh
source "$(dirname "${BASH_SOURCE[0]}")/pg-password.sh"
pg_password_fold_env

# a URL of another database on the same server (query string kept); the second argument picks the URL
url_for_db() {
  local source="${2:-$DATABASE_URL}"
  local base="${source%%\?*}"
  local query="${source#"$base"}"
  echo "${base%/*}/$1$query"
}
# the maintenance database, from the URL without its password (fixed here: the check later exports the full URL)
MAINT_URL="$(url_for_db postgres)"
maint_sql() { timeout "$CALL_LIMIT" psql "$MAINT_URL" -X -q -tA -v ON_ERROR_STOP=1 -c "$1"; }

# drops a drill copy; any other name is refused
drop_drill() {
  local db="$1"
  if ! [[ "$db" =~ $DRILL_RE ]]; then
    log "WARNING: refused to drop $db (not a drill copy)"
    return 1
  fi
  maint_sql "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);" >/dev/null 2>&1 \
    || maint_sql "DROP DATABASE IF EXISTS \"$db\";" >/dev/null 2>&1 \
    || { [ -n "${RESTORE_ADMIN_URL:-}" ] && timeout "$CALL_LIMIT" psql "$RESTORE_ADMIN_URL" -X -q -tA -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\";" >/dev/null 2>&1; }
}

# the drill copy restore.sh announces ("Creating database <name>") — read from its log, so a killed run finds it too
drill_from_log() {
  [ -f "$WORK_DIR/restore.log" ] || return 0
  grep -oE 'Creating database erp_restore_drill_[0-9]{8}_[0-9]{6}' "$WORK_DIR/restore.log" | tail -1 | awk '{print $3}' || true
}

DRILL_DB=""
CHILD_PID=""
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  stop_child
  # what the stopped restore left in its TMPDIR (made after this run's password file)
  if [ -n "${PGPASSFILE:-}" ] && [ -f "$PGPASSFILE" ]; then
    find "$TMP_ROOT" -mindepth 1 -maxdepth 1 -newer "$PGPASSFILE" ! -name "${WORK_DIR##*/}" -exec rm -rf {} + 2>/dev/null || true
  fi
  [ -n "$DRILL_DB" ] || DRILL_DB="$(drill_from_log)"
  if [ -n "$DRILL_DB" ]; then
    drop_drill "$DRILL_DB" || log "WARNING: could not drop $DRILL_DB — the next run drops it after ${DRILL_MAX_AGE_HOURS} hours"
  fi
  rm -rf "$WORK_DIR"
  exit "$rc"
}
# the restore or the check running in the background: timeout leads its own process group, so the whole group is
# stopped (timeout kills what is left 60 seconds later)
stop_child() {
  [ -n "$CHILD_PID" ] || return 0
  kill -TERM -- "-$CHILD_PID" 2>/dev/null || kill -TERM "$CHILD_PID" 2>/dev/null || true
  wait "$CHILD_PID" 2>/dev/null || true
  CHILD_PID=""
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# runs a command in the background under the remaining time and waits for it, so a signal stops it at once; the exit
# code is in CHILD_RC
CHILD_RC=0
run_timed() {
  timeout --kill-after=60 "$(remaining)" "$@" &
  CHILD_PID=$!
  CHILD_RC=0
  wait "$CHILD_PID" || CHILD_RC=$?
  CHILD_PID=""
}

BACKUP_FILE=""
BACKUP_AT=""
# a night that could not be checked: written as a failed report, then exit 1
night_failed() {
  local reason="$1" detail="${2:-}"
  local args=(scripts/nightly-verify.ts --report "$REPORT_WORK" --backup "$BACKUP_FILE" --failed "$reason")
  [ -z "$BACKUP_AT" ] || args+=(--backup-at "$BACKUP_AT")
  [ -z "$detail" ] || args+=(--detail "$detail")
  (cd "$APP_DIR" && LOG_DIR="$WORK_DIR/logs" "$TSX" "${args[@]}") || true
  report_out
  fail "$reason${detail:+: $detail}"
}

# ---------- drill copies a killed run left behind ----------
NOW=$(date +%s)
if OLD_DRILLS="$(maint_sql "SELECT datname FROM pg_database WHERE datname ~ '^erp_restore_drill_[0-9]{8}_[0-9]{6}$'" 2>/dev/null)"; then
  while IFS= read -r db; do
    [[ "$db" =~ $DRILL_RE ]] || continue
    stamp="${db#erp_restore_drill_}"
    created=$(date -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s 2>/dev/null) || continue
    if [ $((NOW - created)) -gt $((DRILL_MAX_AGE_HOURS * 3600)) ]; then
      if drop_drill "$db"; then log "Dropped the drill copy $db left by an earlier run"; else log "WARNING: could not drop the old drill copy $db"; fi
    fi
  done <<< "$OLD_DRILLS"
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
  # v11 (phase 5.3, TD-1354): backup.sh writes plain files; root does not read a file of another user's folder by a link
  if [ -L "$MARKER" ] || [ -L "$BACKUP_DIR/$name.dump.gz" ]; then
    night_failed no_dump "$MARKER or the dump it names is a link, not a file backup.sh wrote"
  fi
  BACKUP_FILE="$BACKUP_DIR/$name.dump.gz"
  BACKUP_AT="$stamp"
  # the nightly run checks a recent backup; a dump named by hand may be of any age
  if [ $((NOW - BACKUP_AT)) -gt $((MAX_DUMP_AGE_HOURS * 3600)) ]; then
    night_failed stale_dump "$(basename "$BACKUP_FILE") is $(( (NOW - BACKUP_AT) / 3600 )) hours old"
  fi
  # the same dump the previous night checked: last night's backup did not finish (a run again the same morning is fine)
  # shellcheck disable=SC2016 # the $ is JavaScript run by node, not the shell
  PREVIOUS="$(node -e 'try { const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(`${r.backupFile || ""} ${Math.floor(Date.parse(r.finishedAt) / 1000) || 0}`); } catch { /* no report */ }' "$REPORT_WORK" 2>/dev/null || true)"
  read -r previous_file previous_at <<< "${PREVIOUS:-}" || true
  if [ "${previous_file:-}" = "$name.dump.gz" ] && [[ "${previous_at:-}" =~ ^[0-9]+$ ]] && [ $((NOW - previous_at)) -gt $((12 * 3600)) ]; then
    night_failed no_new_backup "$name.dump.gz was already checked by the previous night"
  fi
fi

# ---------- free space ----------
# the dump unpacked into the temporary directory; on the data disk the database as large as it is now and its largest
# index once more (an index is rebuilt from sort files beside the data, as large as the index); on the WAL disk twice
# max_wal_size (a checkpoint starts at max_wal_size, and WAL keeps growing while it runs) less the WAL already there
# beyond wal_keep_size (it is recycled), at least one GiB; each disk keeps 10% free (v10.3.24, TD-1352; until then one GiB of WAL and no sort
# files). The index size comes from pg_class, which takes no lock: an index held by a REINDEX does not stall the check
GIB=1073741824
read -r packed unpacked _ < <(gzip -l "$BACKUP_FILE" 2>/dev/null | awk 'NR == 2') || true
if ! [[ "${packed:-}" =~ ^[0-9]+$ ]] || ! [[ "${unpacked:-}" =~ ^[0-9]+$ ]]; then
  night_failed space_unknown "gzip -l could not read $(basename "$BACKUP_FILE")"
fi
# a size 4 GiB or more is reported modulo 4 GiB; a dump (already compressed by pg_dump) never shrinks much in gzip, so
# a reported size well below the packed size has wrapped
while [ $(( packed - unpacked )) -gt 1048576 ]; do unpacked=$((unpacked + 4 * GIB)); done
DB_BYTES="$(timeout "$CALL_LIMIT" psql "$DATABASE_URL" -X -tA -c 'SELECT pg_database_size(current_database())' 2>/dev/null || true)"
[[ "$DB_BYTES" =~ ^[0-9]+$ ]] || night_failed space_unknown "the size of the live database could not be read"
q="SELECT pg_size_bytes(current_setting('max_wal_size')), pg_size_bytes(current_setting('wal_keep_size')), coalesce((SELECT max(relpages::bigint) FROM pg_class WHERE relkind = 'i'), 0) * current_setting('block_size')::bigint"
read -r MAX_WAL_BYTES KEEP_WAL_BYTES INDEX_BYTES <<< "$(timeout "$CALL_LIMIT" psql "$DATABASE_URL" -X -tA -F ' ' -c "$q" 2>/dev/null || true)" || true
if ! [[ "${MAX_WAL_BYTES:-}" =~ ^[0-9]+$ ]] || ! [[ "${KEEP_WAL_BYTES:-}" =~ ^[0-9]+$ ]] || ! [[ "${INDEX_BYTES:-}" =~ ^[0-9]+$ ]]; then
  night_failed space_unknown "the WAL settings or the index sizes of the live database could not be read"
fi

DB_HOST=""
if [[ "$DATABASE_URL" =~ $URL_RE ]]; then read -r DB_HOST _ <<< "$(split_hostport "${BASH_REMATCH[6]}")"; fi
DATA_DIR=""
case "$DB_HOST" in
  ''|localhost|127.0.0.1|::1|/*)
    q='SHOW data_directory'
    DATA_DIR="$(timeout "$CALL_LIMIT" psql "$DATABASE_URL" -X -tA -c "$q" 2>/dev/null || true)"
    if [ -z "$DATA_DIR" ] && [ -n "${RESTORE_ADMIN_URL:-}" ]; then DATA_DIR="$(timeout "$CALL_LIMIT" psql "$RESTORE_ADMIN_URL" -X -tA -c "$q" 2>/dev/null || true)"; fi
    if [ -z "$DATA_DIR" ] && command -v sudo >/dev/null 2>&1; then DATA_DIR="$(timeout "$CALL_LIMIT" sudo -n -u postgres psql -X -tA -d postgres -c "$q" 2>/dev/null || true)"; fi
    [ -n "$DATA_DIR" ] && [ -d "$DATA_DIR" ] || night_failed space_unknown "the data directory of the local PostgreSQL could not be read"
    ;;
  *) log "The database server $DB_HOST is not this machine: only the temporary directory's disk is checked" ;;
esac

WAL_BYTES=0
declare -A NEED=() SIZE=() AVAIL=()
add_need() {
  local dir="$1" bytes="$2" line size avail mount
  line="$(timeout "$CALL_LIMIT" df -PB1 "$dir" 2>/dev/null | awk 'NR == 2 {print $2, $4, $6}' || true)"
  [ -n "$line" ] || night_failed space_unknown "df could not read $dir"
  read -r size avail mount <<< "$line"
  SIZE[$mount]="$size"
  AVAIL[$mount]="$avail"
  NEED[$mount]=$(( ${NEED[$mount]:-0} + bytes ))
}
add_need "$WORK_DIR" "$unpacked"
if [ -n "$DATA_DIR" ]; then
  add_need "$DATA_DIR" $(( DB_BYTES + INDEX_BYTES ))
  WAL_DIR="$(readlink -f "$DATA_DIR/pg_wal" 2>/dev/null || true)"
  [ -n "$WAL_DIR" ] && [ -d "$WAL_DIR" ] || WAL_DIR="$DATA_DIR"
  WAL_NOW=0
  if [ "$WAL_DIR" != "$DATA_DIR" ]; then WAL_NOW="$(timeout "$CALL_LIMIT" du -sb "$WAL_DIR/" 2>/dev/null | awk '{print $1}' || true)"; fi
  [[ "${WAL_NOW:-}" =~ ^[0-9]+$ ]] || WAL_NOW=0
  # what wal_keep_size keeps is not recycled
  WAL_RECYCLED=$(( WAL_NOW > KEEP_WAL_BYTES ? WAL_NOW - KEEP_WAL_BYTES : 0 ))
  WAL_BYTES=$(( 2 * MAX_WAL_BYTES - WAL_RECYCLED ))
  [ "$WAL_BYTES" -ge "$GIB" ] || WAL_BYTES="$GIB"
  add_need "$WAL_DIR" "$WAL_BYTES"
fi
for mount in "${!NEED[@]}"; do
  keep=$(( SIZE[$mount] * FREE_MARGIN_PERCENT / 100 ))
  if [ $(( AVAIL[$mount] - NEED[$mount] )) -lt "$keep" ]; then
    night_failed no_space "$mount needs ${NEED[$mount]} bytes and ${FREE_MARGIN_PERCENT}% free, ${AVAIL[$mount]} bytes available"
  fi
done
log "Free space checked: dump $unpacked bytes unpacked, database $DB_BYTES bytes, largest index $INDEX_BYTES bytes, WAL $WAL_BYTES bytes"

# ---------- restore and check, under one time limit and at low priority ----------
DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))
LOW_PRIORITY=(nice -n 10)
command -v ionice >/dev/null 2>&1 && LOW_PRIORITY+=(ionice -c 2 -n 7)
# at least 1: `timeout 0` would mean no limit
remaining() { local left=$(( DEADLINE - $(date +%s) )); [ "$left" -ge 1 ] || left=1; echo "$left"; }
timed_out() { [ "$1" -eq 124 ] || [ "$1" -eq 137 ]; }

log "[1/2] Restoring $(basename "$BACKUP_FILE") into a drill database"
RESTORE_LOG="$WORK_DIR/restore.log"
run_timed env RESTORE_MODE=drill RESTORE_KEEP=1 TMPDIR="$TMP_ROOT" "${LOW_PRIORITY[@]}" bash "$APP_DIR/scripts/restore.sh" "$BACKUP_FILE" \
  > "$RESTORE_LOG" 2>&1
RESTORE_RC=$CHILD_RC
cat "$RESTORE_LOG"
DRILL_DB="$(drill_from_log)"
timed_out "$RESTORE_RC" && night_failed timeout "the restore did not finish within $TIMEOUT_SECONDS seconds"
if [ "$RESTORE_RC" -ne 0 ] || [ -z "$DRILL_DB" ] || ! grep -q "Drill database kept for inspection: $DRILL_DB" "$RESTORE_LOG"; then
  # a full disk is the server's problem, not the backup's
  grep -qi 'No space left on device' "$RESTORE_LOG" && night_failed no_space "a disk filled up during the restore (above)"
  night_failed restore "the backup did not pass the restore drill (above)"
fi

log "[2/2] Checking the accounts and stock on the copy"
[ $(( DEADLINE - $(date +%s) )) -gt 0 ] || night_failed timeout "no time left for the check after the restore"
# the full URL goes only through the environment, never on a command line; the steps after it use no URL
export LOG_DIR="$WORK_DIR/logs"
DATABASE_URL="$(url_for_db "$DRILL_DB" "$FULL_DATABASE_URL")"
cd "$APP_DIR"
run_timed "${LOW_PRIORITY[@]}" "$TSX" scripts/nightly-verify.ts --report "$REPORT_WORK" --backup "$BACKUP_FILE" --backup-at "$BACKUP_AT"
CHECK_RC=$CHILD_RC
timed_out "$CHECK_RC" && night_failed timeout "the check did not finish within $TIMEOUT_SECONDS seconds"
report_out
[ "$CHECK_RC" -eq 0 ] || fail "see above; the system health page shows the same result"
log "SUCCESS: the latest backup restores and its accounts and stock are not worse than the last healthy night"
