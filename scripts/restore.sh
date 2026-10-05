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

env_file_value() {
  local key="$1" file="$APP_DIR/.env"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" | head -1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}

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
  BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp}"
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/erp_*.dump.gz 2>/dev/null | head -1 || true)
  [ -n "$BACKUP_FILE" ] || fail "no dump file found in $BACKUP_DIR — pass one explicitly"
fi
[ -f "$BACKUP_FILE" ] || fail "dump file not found: $BACKUP_FILE"
BACKUP_BASE="${BACKUP_FILE%.dump.gz}"
MANIFEST_FILE="$BACKUP_BASE.manifest"
UPLOADS_ARCHIVE="${BACKUP_BASE}_uploads.tar.gz"
ATTACHMENTS_ARCHIVE="${BACKUP_BASE}_attachments.tar.gz"
log "Restoring from: $BACKUP_FILE (mode=$RESTORE_MODE)"

WORK_DIR="$(mktemp -d)"
NEW_DB=""
cleanup() {
  local rc=$?
  if [ -n "$NEW_DB" ] && { [ "$RESTORE_MODE" = "apply" ] || [ "$RESTORE_KEEP" != "1" ]; }; then
    admin_sql "DROP DATABASE IF EXISTS \"$NEW_DB\";" >/dev/null 2>&1 || log "WARNING: could not drop $NEW_DB"
  fi
  rm -rf "$WORK_DIR"
  exit $rc
}

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
trap cleanup EXIT

# ---------- Restore into a new database owned by the application role ----------
NEW_DB="${DB_NAME}_restore_${TIMESTAMP}"
[ "$RESTORE_MODE" = "drill" ] && NEW_DB="erp_restore_drill_${TIMESTAMP}"
NEW_URL="$(url_for_db "$NEW_DB")"
log "Creating database $NEW_DB (owner $DB_USER)"
admin_sql "CREATE DATABASE \"$NEW_DB\" OWNER \"$DB_USER\";" >/dev/null || fail "cannot create database $NEW_DB"
gunzip -c "$BACKUP_FILE" > "$WORK_DIR/restore.dump" || fail "cannot decompress $BACKUP_FILE"
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
log "  migrations: backup has $APPLIED applied, this code knows $KNOWN"

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
    tar -tzf "$ATT_ARCHIVE" > "$WORK_DIR/archive_list" || fail "cannot read $ATT_ARCHIVE"
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
log "Database $TARGET_DB replaced by the restored copy; the previous one is kept as ${OLD_DB} (drop it when no longer needed)"

restore_archive() {
  local archive="$1" dir="$2"
  [ -f "$archive" ] || return 0
  if [ -e "$dir" ]; then mv "$dir" "$dir.before_restore_${TIMESTAMP}"; log "Previous $(basename "$dir") kept as $dir.before_restore_${TIMESTAMP}"; fi
  mkdir -p "$(dirname "$dir")"
  tar -xzf "$archive" -C "$(dirname "$dir")"
  log "Files restored from $archive into $dir"
}
restore_archive "$UPLOADS_ARCHIVE" "$UPLOADS_DIR"
[ "$ATT_KIND" = "attachments" ] && restore_archive "$ATTACHMENTS_ARCHIVE" "$ATTACHMENTS_ROOT"

log "SUCCESS: restore applied. Start the service (systemctl start papital-erp) and wait for http://localhost:3000/health/startup"
exit 0
