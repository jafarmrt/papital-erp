#!/bin/bash
# scripts/restore.sh — PHASE 3 (TD-059) Disaster Recovery: Restore & Restore-Drill
# ==============================================================================
# "A backup exists" is NOT "the backup is restorable" until a restore actually succeeds and the restored database
# holds exactly what was backed up.
#
# Usage:
#   ./scripts/restore.sh [dump-file.dump.gz]                      (RESTORE_MODE=drill, the default)
#     → restores into a temporary drill database, compares it with the backup's manifest (rows and content of every
#       table, every constraint), checks sequences, attachment files and the migration level, then drops it.
#       Zero impact on the live database.
#
#   RESTORE_MODE=apply RESTORE_CONFIRM=yes ./scripts/restore.sh <dump-file.dump.gz> [target-db-name]
#     → restores into a NEW database, verifies it exactly like a drill, and only then swaps it in under the target's
#       name; the old database is kept as <target>_before_restore_<timestamp>. Attachment files are restored from the
#       backup's archive (the current directory is kept as <dir>.before_restore_<timestamp>). The service must be
#       stopped: the swap is refused while any other session is connected to the target.
#
# v8.0.85 (TD-361): the drill compares the restored database with the manifest written by backup.sh from the same
#   snapshot as the dump; a backup without a manifest (made before v8.0.85) gets only the basic checks, said so.
# v8.0.86 (TD-363): creating and dropping databases needs CREATEDB, which the role made by install.sh does not
#   have: RESTORE_ADMIN_URL (a role with CREATEDB, e.g. postgres) is used for that, else `sudo -u postgres psql`
#   on the local server, else the script stops before doing anything and says what to set.
# v8.0.87 (TD-360): apply never restores over the live database (that merged the backup into the current data and
#   left tables from two points in time); it builds and verifies a separate database and swaps names.
#
# Env:
#   DATABASE_URL        — the application's connection (read from APP_DIR/.env when unset); its role owns the
#                         drill / restored database and runs pg_restore, exactly as the application will use it.
#   RESTORE_MODE        — drill (default) | apply
#   RESTORE_KEEP        — 1 → keep the drill database for inspection (default 0)
#   RESTORE_ADMIN_URL   — optional connection of a role with CREATEDB (any database, e.g. .../postgres)
#   RESTORE_ALLOW_SUDO  — 0 → never fall back to `sudo -u postgres psql` (default 1)
#   APP_DIR             — application directory (default: the parent of this script)
#   UPLOADS_DIR / ATTACHMENTS_DIR — where apply restores the uploads / attachments archives
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RESTORE_MODE="${RESTORE_MODE:-drill}"
RESTORE_KEEP="${RESTORE_KEEP:-0}"
MANIFEST_SQL="$APP_DIR/scripts/sql/backup-manifest.sql"

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

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
[ -n "${ATTACHMENTS_DIR:-}" ] || ATTACHMENTS_DIR="$(env_file_value ATTACHMENTS_DIR)"
UPLOADS_DIR="${UPLOADS_DIR:-$APP_DIR/public/uploads}"
ATTACHMENTS_ROOT="${ATTACHMENTS_DIR:-$UPLOADS_DIR/.attachments}"
case "$ATTACHMENTS_ROOT" in /*) ;; *) ATTACHMENTS_ROOT="$APP_DIR/$ATTACHMENTS_ROOT" ;; esac

DB_URL_RE='^(postgresql|postgres)://([^:@/]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^/?]+)'
[[ "$DATABASE_URL" =~ $DB_URL_RE ]] || fail "DATABASE_URL is not in standard postgres://user:pass@host:port/db form"
DB_USER="${BASH_REMATCH[2]}"
DB_NAME="${BASH_REMATCH[8]}"

# DATABASE_URL with another database name (query string such as ?sslmode=require kept)
url_for_db() {
  local base="${DATABASE_URL%%\?*}"
  local query="${DATABASE_URL#"$base"}"
  echo "${base%/*}/$1$query"
}

if [ "$RESTORE_MODE" != "drill" ] && [ "$RESTORE_MODE" != "apply" ]; then
  fail "RESTORE_MODE must be drill or apply"
fi
if [ "$RESTORE_MODE" = "apply" ] && [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  fail "apply mode replaces the target database. Set RESTORE_CONFIRM=yes to proceed."
fi

# ---------- Locate the dump file and its companions ----------
BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  # v10.3.24 (TD-1353): the folder backup.sh writes to, from .env too
  [ -n "${BACKUP_DIR:-}" ] || BACKUP_DIR="$(env_file_value BACKUP_DIR)"
  BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp}"
  # a relative folder is under APP_DIR, whichever directory cron, update.sh or a shell starts from
  case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$APP_DIR/$BACKUP_DIR" ;; esac
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/erp_*.dump.gz 2>/dev/null | head -1 || true)
  [ -n "$BACKUP_FILE" ] || fail "no dump file found in $BACKUP_DIR — pass one explicitly"
fi
[ -f "$BACKUP_FILE" ] || fail "dump file not found: $BACKUP_FILE"
BACKUP_BASE="${BACKUP_FILE%.dump.gz}"
MANIFEST_FILE="$BACKUP_BASE.manifest"
UPLOADS_ARCHIVE="${BACKUP_BASE}_uploads.tar.gz"
ATTACHMENTS_ARCHIVE="${BACKUP_BASE}_attachments.tar.gz"
log "Restoring from: $BACKUP_FILE (mode=$RESTORE_MODE)"

# v11 (phase 5.3, TD-1354): the backups belong to the service user on a new install, who could put a link or a FIFO in
# place of a file there. Root reads a backup file as the owner of its folder (the folder a link leads to) or, in a folder
# of root's, as the owner of the file, so a link reaches only what that user may read
as_owner() {
  local owner="$1"; shift
  if [ "$(id -u)" -eq 0 ] && [ "$owner" != root ]; then runuser -u "$owner" -- "$@"; else "$@"; fi
}
backup_reader() {
  local owner
  owner="$(stat -L -c %U "$(dirname "$1")" 2>/dev/null || echo root)"
  [ "$owner" != root ] || owner="$(stat -c %U "$1" 2>/dev/null || echo root)"
  echo "$owner"
}
read_backup() {
  # shellcheck disable=SC2016
  as_owner "$(backup_reader "$1")" sh -c '[ -f "$1" ] && [ ! -L "$1" ] && exec cat -- "$1"' backup "$1"
}
# end of the backup readers

WORK_DIR="$(mktemp -d)"
NEW_DB=""
UNPACK_DIRS=()
cleanup() {
  local rc=$?
  if [ -n "$NEW_DB" ] && { [ "$RESTORE_MODE" = "apply" ] || [ "$RESTORE_KEEP" != "1" ]; }; then
    admin_sql "DROP DATABASE IF EXISTS \"$NEW_DB\";" >/dev/null 2>&1 || log "WARNING: could not drop $NEW_DB"
  fi
  rm -rf "$WORK_DIR"
  local u
  for u in "${UNPACK_DIRS[@]}"; do rm -rf "$u"; done
  exit $rc
}
# set before WORK_DIR holds the password file, so any exit from here on removes it (#346 review M1)
trap cleanup EXIT
# v10.2.28 (TD-1351): the password goes to psql and pg_restore through a PGPASSFILE in WORK_DIR (removed by cleanup), not their command line
# shellcheck source=scripts/pg-password.sh
. "$APP_DIR/scripts/pg-password.sh"
pg_password_setup "$WORK_DIR"
# the manifest is read once, into a copy of this run
if read_backup "$MANIFEST_FILE" > "$WORK_DIR/manifest" 2>/dev/null; then MANIFEST_FILE="$WORK_DIR/manifest"; else MANIFEST_FILE="$WORK_DIR/no-manifest"; fi

# ---------- Admin connection (CREATE / DROP / RENAME DATABASE) ----------
# The maintenance database "postgres" is used so that the check also works when the target database is gone.
MAINT_URL="$(url_for_db postgres)"
ADMIN_KIND=""
if [ -n "${RESTORE_ADMIN_URL:-}" ]; then
  ADMIN_KIND="url"
elif [ "$(psql "$MAINT_URL" -X -tA -c "SELECT rolcreatedb OR rolsuper FROM pg_roles WHERE rolname = current_user" 2>/dev/null)" = "t" ]; then
  ADMIN_KIND="app"
elif [ "${RESTORE_ALLOW_SUDO:-1}" = "1" ] && command -v sudo >/dev/null 2>&1 && sudo -n -u postgres psql -X -tA -d postgres -c "SELECT 1" >/dev/null 2>&1; then
  ADMIN_KIND="sudo"
else
  fail "the role '$DB_USER' cannot create databases. Set RESTORE_ADMIN_URL to a role with CREATEDB (e.g. postgresql://postgres:...@localhost:5432/postgres) or run this script as a user that may run 'sudo -u postgres psql'. Nothing was changed."
fi
admin_sql() {
  case "$ADMIN_KIND" in
    url) psql "$RESTORE_ADMIN_URL" -X -q -tA -v ON_ERROR_STOP=1 -c "$1" ;;
    app) psql "$MAINT_URL" -X -q -tA -v ON_ERROR_STOP=1 -c "$1" ;;
    sudo) sudo -n -u postgres psql -X -q -tA -v ON_ERROR_STOP=1 -d postgres -c "$1" ;;
  esac
}

# ---------- Restore into a new database owned by the application role ----------
NEW_DB="${DB_NAME}_restore_${TIMESTAMP}"
[ "$RESTORE_MODE" = "drill" ] && NEW_DB="erp_restore_drill_${TIMESTAMP}"
NEW_URL="$(url_for_db "$NEW_DB")"
log "Creating database $NEW_DB (owner $DB_USER)"
admin_sql "CREATE DATABASE \"$NEW_DB\" OWNER \"$DB_USER\";" >/dev/null || fail "cannot create database $NEW_DB"
read_backup "$BACKUP_FILE" | gunzip -c > "$WORK_DIR/restore.dump" || fail "cannot decompress $BACKUP_FILE"
if ! pg_restore --no-owner --no-privileges --no-comments --exit-on-error -d "$NEW_URL" "$WORK_DIR/restore.dump" 2> "$WORK_DIR/pg_restore.err"; then
  cat "$WORK_DIR/pg_restore.err"
  fail "restore FAILED — pg_restore stopped at the first error above; the backup is NOT restorable as is"
fi

# ---------- Verification (TD-361) ----------
PROBLEMS=0
problem() { log "  ✗ $*"; PROBLEMS=$((PROBLEMS + 1)); }
psql_new() { psql "$NEW_URL" -X -q -v ON_ERROR_STOP=1 -tA -F'|' "$@"; }

if [ -f "$MANIFEST_FILE" ]; then
  grep -E '^(table|constraint)\|' "$MANIFEST_FILE" > "$WORK_DIR/expected"
  psql_new -c "BEGIN" -f "$MANIFEST_SQL" -c "COMMIT" > "$WORK_DIR/actual" || fail "manifest query failed on $NEW_DB"
  if diff "$WORK_DIR/expected" "$WORK_DIR/actual" > "$WORK_DIR/manifest.diff"; then
    log "  ✓ content identical to the backup manifest ($(grep -c '^table|' "$WORK_DIR/expected") tables, $(grep -c '^constraint|' "$WORK_DIR/expected") constraints)"
  else
    problem "restored content differs from the backup manifest (first lines; < backup, > restored):"
    head -20 "$WORK_DIR/manifest.diff"
  fi
else
  log "  ! no manifest next to the dump (backup made before v8.0.85): content NOT compared, only basic checks"
  for tbl in users roles journal_vouchers app_settings; do
    n="$(psql_new -c "SELECT count(*) FROM $tbl" 2>/dev/null || echo missing)"
    if [ "$n" = "missing" ] || [ "$n" = "0" ]; then problem "core table $tbl is ${n/0/empty}"; else log "  table $tbl → $n rows"; fi
  done
fi

# Sequences must be ahead of the data they number (sequences are not part of the manifest: they are not transactional)
psql_new > "$WORK_DIR/sequences" <<'SQL' || fail "sequence check failed on the restored database"
SELECT format('SELECT %L WHERE (SELECT max(%I) FROM %I.%I) > (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM %I.%I)',
              sn.nspname || '.' || s.relname, a.attname, tn.nspname, t.relname, sn.nspname, s.relname)
  FROM pg_depend d
  JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
  JOIN pg_namespace sn ON sn.oid = s.relnamespace
  JOIN pg_class t ON t.oid = d.refobjid
  JOIN pg_namespace tn ON tn.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
 WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
   AND format_type(a.atttypid, NULL) IN ('integer', 'bigint', 'smallint')
\gexec
SQL
if [ -s "$WORK_DIR/sequences" ]; then
  problem "sequence(s) behind their data (the next insert would collide): $(tr '\n' ' ' < "$WORK_DIR/sequences")"
else
  log "  ✓ every sequence is ahead of its data"
fi

# Migration level of the backup vs this code (informational: newer migrations run when the service starts)
APPLIED="$(psql_new -c "SELECT count(*) FROM drizzle.__drizzle_migrations" 2>/dev/null || echo '?')"
KNOWN="$(grep -c '"tag"' "$APP_DIR/drizzle/meta/_journal.json" 2>/dev/null || echo '?')"
log "  migrations: backup has $APPLIED applied, this code knows $KNOWN (from v11 the 136 migrations of 11.2 count as one baseline, 0000)"

# Attachment files: every active attachment record must have its file in the backup's archive
ATT_KIND="$(grep '^meta|attachments_archive|' "$MANIFEST_FILE" 2>/dev/null | cut -d'|' -f3 || true)"
ATT_PREFIX="$(grep '^meta|attachments_archive|' "$MANIFEST_FILE" 2>/dev/null | cut -d'|' -f4 || true)"
ATT_ARCHIVE="$UPLOADS_ARCHIVE"
[ "$ATT_KIND" = "attachments" ] && ATT_ARCHIVE="$ATTACHMENTS_ARCHIVE"
[ -n "$ATT_PREFIX" ] || ATT_PREFIX="uploads/.attachments"
psql_new -c "SELECT storage_path FROM file_attachments WHERE is_deleted = 0 ORDER BY 1" > "$WORK_DIR/attachments" 2>/dev/null || : > "$WORK_DIR/attachments"
ATT_TOTAL="$(grep -c . "$WORK_DIR/attachments" || true)"
if [ "$ATT_TOTAL" -gt 0 ]; then
  if [ ! -f "$ATT_ARCHIVE" ]; then
    problem "$ATT_TOTAL attachment record(s) but no attachment archive next to the dump ($ATT_ARCHIVE)"
  else
    read_backup "$ATT_ARCHIVE" | tar -tzf - > "$WORK_DIR/archive_list" || fail "cannot read $ATT_ARCHIVE"
    LOST=0
    BEFORE=0
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      if ! grep -qxF "$ATT_PREFIX/$p" "$WORK_DIR/archive_list"; then
        if grep -qxF "attachment_missing|$p" "$MANIFEST_FILE" 2>/dev/null; then
          BEFORE=$((BEFORE + 1))
        else
          LOST=$((LOST + 1))
          [ "$LOST" -le 10 ] && log "    missing in archive: $p"
        fi
      fi
    done < "$WORK_DIR/attachments"
    [ "$BEFORE" -eq 0 ] || log "  ! $BEFORE attachment file(s) were already missing on disk when the backup was taken"
    if [ "$LOST" -gt 0 ]; then problem "$LOST attachment file(s) are not in $ATT_ARCHIVE"; else log "  ✓ attachment files present in the archive ($((ATT_TOTAL - BEFORE)) of $ATT_TOTAL)"; fi
  fi
fi

if [ "$PROBLEMS" -gt 0 ]; then
  [ "$RESTORE_MODE" = "drill" ] && [ "$RESTORE_KEEP" = "1" ] && log "Drill database kept for inspection: $NEW_DB"
  fail "restore verification FAILED ($PROBLEMS problem(s)) — the backup is NOT verified restorable"
fi

if [ "$RESTORE_MODE" = "drill" ]; then
  if [ "$RESTORE_KEEP" = "1" ]; then
    log "Drill database kept for inspection: $NEW_DB"
    NEW_DB=""
  fi
  log "SUCCESS: restore drill passed — $BACKUP_FILE restores into a database identical to the backup"
  exit 0
fi

# ---------- apply: swap the verified database in (TD-360) ----------
# v11 (O15): the archive holds the folder under the name it had when the backup was taken (public/uploads → uploads),
# which is not always the name of <dir>; it is unpacked into a new folder beside <dir> and that one folder is moved to
# <dir>, so the files land where the log says. Both archives are unpacked and checked before the database is swapped,
# so an archive that cannot be used stops the run while nothing was changed.
# v11 (phase 5.3, TD-1354): the files belong to whoever owns <dir> (the service user of a new install), and that user
# unpacks them. The archive is read once, into a copy of this run that no one else can change, and refused when it holds
# anything but folders and plain files without set-id bits (a device or a set-id program unpacked by root would hand
# root to whoever wrote the archive) or more than one folder at its top. Its folder's contents go straight into the
# unpack folder, which root then moves to <dir> itself: no name the owner could swap for a link is ever followed.
unpack_archive() {
  local archive="$1" dir="$2" parent unpack owner parent_owner copy mode
  UNPACKED=""
  [ -f "$archive" ] || return 0
  parent="$(dirname "$dir")"
  # never inside the uploads folder, which is itself moved aside before the attachments are put in place
  case "$parent/" in "$UPLOADS_DIR"/*) parent="$(dirname "$UPLOADS_DIR")" ;; esac
  mkdir -p "$parent"
  parent_owner="$(stat -c %U "$parent")"
  if [ -d "$dir" ] && [ ! -L "$dir" ]; then owner="$(stat -c %U "$dir")"; mode="$(stat -c %a "$dir")"; else owner="$(stat -c %U "$(dirname "$dir")")"; mode=750; fi
  copy="$WORK_DIR/$(basename "$archive")"
  read_backup "$archive" > "$copy" || fail "cannot read $archive; nothing was changed"
  tar -tvzf "$copy" > "$WORK_DIR/archive_types" || fail "cannot read $archive; nothing was changed"
  if grep -qvE '^[-d][-rwx]{9} ' "$WORK_DIR/archive_types"; then
    fail "$archive holds something other than folders and plain files (a link, a device or a set-id file); nothing was changed"
  fi
  tar -tzf "$copy" > "$WORK_DIR/archive_names" || fail "cannot read $archive; nothing was changed"
  if [ "$(cut -d/ -f1 "$WORK_DIR/archive_names" | sort -u | wc -l)" -ne 1 ] || ! head -1 "$WORK_DIR/archive_types" | grep -q '^d'; then
    fail "$archive does not hold exactly one folder; nothing was changed"
  fi
  if [ "$(id -u)" -ne 0 ] || [ "$parent_owner" = "$owner" ]; then
    unpack="$(as_owner "$owner" mktemp -d "$parent/.restore_unpack_XXXXXX")"
  elif [ "$parent_owner" = root ]; then
    # in a folder of root's, where no one else can swap it, root makes the unpack folder and gives it to the owner
    unpack="$(mktemp -d "$parent/.restore_unpack_XXXXXX")"
    chown "$owner" "$unpack"
  else
    fail "$parent belongs to $parent_owner, neither root nor the owner of $dir ($owner); nothing was changed"
  fi
  UNPACK_DIRS+=("$unpack")
  as_owner "$owner" tar -xzf - --no-same-owner --no-same-permissions --strip-components=1 -C "$unpack" < "$copy" || fail "cannot unpack $archive; nothing was changed"
  as_owner "$owner" chmod "$mode" "$unpack"
  rm -f "$copy"
  UNPACKED="$unpack"
}
place_archive() {
  local archive="$1" unpacked="$2" dir="$3"
  [ -n "$unpacked" ] || return 0
  if [ -e "$dir" ] || [ -L "$dir" ]; then mv -T "$dir" "$dir.before_restore_${TIMESTAMP}"; log "Previous $(basename "$dir") kept as $dir.before_restore_${TIMESTAMP}"; fi
  mv -T "$unpacked" "$dir"
  log "Files restored from $archive into $dir"
}
unpack_archive "$UPLOADS_ARCHIVE" "$UPLOADS_DIR"
UPLOADS_UNPACKED="$UNPACKED"
ATTACHMENTS_UNPACKED=""
if [ "$ATT_KIND" = "attachments" ]; then
  unpack_archive "$ATTACHMENTS_ARCHIVE" "$ATTACHMENTS_ROOT"
  ATTACHMENTS_UNPACKED="$UNPACKED"
fi

TARGET_DB="${2:-$DB_NAME}"
OLD_DB="${TARGET_DB}_before_restore_${TIMESTAMP}"
OTHERS="$(psql "$(url_for_db "$TARGET_DB")" -X -tA -c "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()" 2>/dev/null || echo 0)"
[ "$OTHERS" = "0" ] || fail "$OTHERS other session(s) are connected to $TARGET_DB — stop the service first (systemctl stop papital-erp); nothing was changed"
TARGET_EXISTS="$(admin_sql "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'")" || fail "cannot read the database list"
if [ "$TARGET_EXISTS" = "1" ]; then
  admin_sql "ALTER DATABASE \"$TARGET_DB\" RENAME TO \"$OLD_DB\";" >/dev/null || fail "cannot rename $TARGET_DB (is a session still connected?) — nothing was changed"
fi
if ! admin_sql "ALTER DATABASE \"$NEW_DB\" RENAME TO \"$TARGET_DB\";" >/dev/null; then
  [ "$TARGET_EXISTS" = "1" ] && admin_sql "ALTER DATABASE \"$OLD_DB\" RENAME TO \"$TARGET_DB\";" >/dev/null
  fail "cannot rename $NEW_DB to $TARGET_DB — the original database was put back"
fi
NEW_DB=""
# v11 (O15): the line says what was done: a target that did not exist was not kept
if [ "$TARGET_EXISTS" = "1" ]; then
  log "Database $TARGET_DB replaced by the restored copy; the previous one is kept as ${OLD_DB}"
else
  log "Database $TARGET_DB created from the restored copy (there was no database of that name before)"
fi
# v11 (O11): the copies kept by this and earlier restores stay until someone drops them; each is named with its command
KEPT_DBS="$(admin_sql "SELECT datname FROM pg_database WHERE datname LIKE '$(printf '%s' "$TARGET_DB" | sed 's/[_%]/\\&/g')\\_before\\_restore\\_%' ORDER BY 1")" || KEPT_DBS=""
if [ -n "$KEPT_DBS" ]; then
  log "Databases kept by restores (each holds a full copy of the data; drop one when it is no longer needed):"
  while IFS= read -r kept; do
    [ -n "$kept" ] && log "    sudo -u postgres dropdb \"$kept\""
  done <<< "$KEPT_DBS"
fi

place_archive "$UPLOADS_ARCHIVE" "$UPLOADS_UNPACKED" "$UPLOADS_DIR"
place_archive "$ATTACHMENTS_ARCHIVE" "$ATTACHMENTS_UNPACKED" "$ATTACHMENTS_ROOT"

log "SUCCESS: restore applied. Start the service (systemctl start papital-erp) and wait for http://localhost:3000/health/startup"
exit 0
