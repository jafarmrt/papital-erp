#!/bin/bash
# scripts/backup.sh — PHASE 9 (14.1) Production Backup Strategy
# Full pg_dump backup with integrity verification, content manifest, optional offsite upload and retention cleanup.
#
# Usage:
#   ./scripts/backup.sh                                       # daily full backup (retention 30d)
#   BACKUP_KIND=pre-deployment RETENTION_DAYS=90 ./backup.sh  # snapshot before each deploy
#   BACKUP_KIND=pre-migration RETENTION_DAYS=180 ./backup.sh  # snapshot before schema migrations
#
# v8.0.84 (TD-362): the script finds the application directory from its own location (APP_DIR), reads DATABASE_URL
# (and ATTACHMENTS_DIR) from APP_DIR/.env when they are not in the environment, and archives APP_DIR/public/uploads —
# so a cron line from any working directory backs up the database AND the attachment files. A database that has
# attachment records but no attachment directory is a failed backup, never a silent database-only one.
#
# Cron example (/etc/cron.d/papital-erp-backup):
#   0 2 * * * papital /opt/papital-erp/scripts/backup.sh >> /var/log/papital-backup.log 2>&1
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_KIND="${BACKUP_KIND:-daily}"

log()  { echo "[$(date)] $*"; }
fail() { log "Backup FAILED: $*"; exit 1; }

# Value of KEY in APP_DIR/.env (first match, surrounding quotes removed); empty when absent.
env_file_value() {
  local key="$1" file="$APP_DIR/.env"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" | head -1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(env_file_value DATABASE_URL)"
fi
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set and $APP_DIR/.env has none"
export DATABASE_URL
if [ -z "${ATTACHMENTS_DIR:-}" ]; then
  ATTACHMENTS_DIR="$(env_file_value ATTACHMENTS_DIR)"
fi
UPLOADS_DIR="${UPLOADS_DIR:-$APP_DIR/public/uploads}"
ATTACHMENTS_ROOT="${ATTACHMENTS_DIR:-$UPLOADS_DIR/.attachments}"
case "$ATTACHMENTS_ROOT" in /*) ;; *) ATTACHMENTS_ROOT="$APP_DIR/$ATTACHMENTS_ROOT" ;; esac

mkdir -p "$BACKUP_DIR"
BASE="$BACKUP_DIR/erp_${BACKUP_KIND}_${TIMESTAMP}"
DUMP_FILE="$BASE.dump"
MANIFEST_FILE="$BASE.manifest"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# 1. Full dump (custom format) and its content manifest from ONE snapshot (v8.0.85, TD-361):
#    a repeatable-read transaction exports its snapshot, pg_dump reads exactly that snapshot, and the manifest
#    (scripts/sql/backup-manifest.sql: rows and content hash of every table, every constraint) is computed in the
#    same transaction — restore.sh compares a restored database with it line by line.
export ERP_DUMP_FILE="$DUMP_FILE" ERP_DUMP_ERR="$WORK_DIR/pg_dump.err" ERP_DUMP_RC="$WORK_DIR/pg_dump.rc"
if ! psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -tA -F'|' > "$WORK_DIR/manifest" 2> "$WORK_DIR/psql.err" <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS erp_snapshot \gset
\setenv ERP_SNAPSHOT :erp_snapshot
\! pg_dump --snapshot="\$ERP_SNAPSHOT" --format=custom --no-owner --no-privileges "\$DATABASE_URL" > "\$ERP_DUMP_FILE" 2> "\$ERP_DUMP_ERR"; echo \$? > "\$ERP_DUMP_RC"
\i '$APP_DIR/scripts/sql/backup-manifest.sql'
COMMIT;
SQL
then
  cat "$WORK_DIR/psql.err"
  rm -f "$DUMP_FILE"
  fail "manifest query failed"
fi
if [ "$(cat "$ERP_DUMP_RC" 2>/dev/null || echo 1)" != "0" ]; then
  cat "$ERP_DUMP_ERR" 2>/dev/null || true
  rm -f "$DUMP_FILE"
  fail "pg_dump failed"
fi

# 1b. Attachment files live on disk, outside pg_dump (AGENTS.md §10): the uploads directory is archived with the
#     dump. Active attachment records whose file is missing on disk right now are listed in the manifest, so a
#     restore drill tells "missing before the backup" apart from "lost by the backup".
ATT_ROWS="$(psql "$DATABASE_URL" -X -tA -v ON_ERROR_STOP=1 -c "SELECT CASE WHEN to_regclass('file_attachments') IS NULL THEN '' ELSE (SELECT string_agg(storage_path, E'\n' ORDER BY storage_path) FROM file_attachments WHERE is_deleted = 0) END")" \
  || fail "attachment records could not be read"
ATT_COUNT=0
[ -n "$ATT_ROWS" ] && ATT_COUNT="$(printf '%s\n' "$ATT_ROWS" | grep -c . || true)"
UPLOADS_ARCHIVE=""
ATTACHMENTS_ARCHIVE=""
if [ "$ATT_COUNT" -gt 0 ] && [ ! -d "$ATTACHMENTS_ROOT" ]; then
  rm -f "$DUMP_FILE"
  fail "$ATT_COUNT attachment record(s) in the database but the attachment directory $ATTACHMENTS_ROOT does not exist (set APP_DIR or ATTACHMENTS_DIR)"
fi
if [ -d "$UPLOADS_DIR" ] && [ -n "$(ls -A "$UPLOADS_DIR" 2>/dev/null)" ]; then
  UPLOADS_ARCHIVE="${BASE}_uploads.tar.gz"
  tar -czf "$UPLOADS_ARCHIVE" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  gunzip -t "$UPLOADS_ARCHIVE" || fail "uploads archive verification failed for $UPLOADS_ARCHIVE"
fi
ATT_PREFIX="$(basename "$UPLOADS_DIR")/.attachments"
case "$ATTACHMENTS_ROOT/" in
  "$UPLOADS_DIR"/.attachments/) ATT_ARCHIVE_KIND="uploads" ;;
  *)
    ATT_ARCHIVE_KIND="attachments"
    ATT_PREFIX="$(basename "$ATTACHMENTS_ROOT")"
    if [ -d "$ATTACHMENTS_ROOT" ]; then
      ATTACHMENTS_ARCHIVE="${BASE}_attachments.tar.gz"
      tar -czf "$ATTACHMENTS_ARCHIVE" -C "$(dirname "$ATTACHMENTS_ROOT")" "$(basename "$ATTACHMENTS_ROOT")"
      gunzip -t "$ATTACHMENTS_ARCHIVE" || fail "attachments archive verification failed for $ATTACHMENTS_ARCHIVE"
    fi
    ;;
esac
{
  echo "meta|format|1"
  echo "meta|created_at|$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "meta|attachments_archive|$ATT_ARCHIVE_KIND|$ATT_PREFIX"
  echo "meta|attachments|$ATT_COUNT"
  if [ "$ATT_COUNT" -gt 0 ]; then
    printf '%s\n' "$ATT_ROWS" | while IFS= read -r p; do
      if [ -n "$p" ] && [ ! -f "$ATTACHMENTS_ROOT/$p" ]; then echo "attachment_missing|$p"; fi
    done
  fi
  cat "$WORK_DIR/manifest"
} > "$MANIFEST_FILE"
MISSING_NOW="$(grep -c '^attachment_missing|' "$MANIFEST_FILE" || true)"
if [ "$MISSING_NOW" -gt 0 ]; then
  log "WARNING: $MISSING_NOW active attachment file(s) are already missing on disk (listed in $MANIFEST_FILE)"
fi

gzip "$DUMP_FILE"

# 2. Verify backup integrity
# 2a. gzip container integrity
gunzip -t "$DUMP_FILE.gz" || fail "gzip verification failed for $DUMP_FILE.gz — keeping file for inspection"
# 2b. V3.0.8 (TD-059): pg_restore must be able to read the archive TOC —
# gzip integrity alone never proved the dump itself is restorable.
# NOTE: do NOT use `gunzip -c | pg_restore --list` under `set -o pipefail`:
# pg_restore --list exits right after the TOC, gunzip receives SIGPIPE (exit
# 141) once the dump grows beyond a few KB, and the pipeline falsely fails.
# Decompress to a temp file and verify the file instead.
DUMP_TMP="$WORK_DIR/verify.dump"
gunzip -c "$DUMP_FILE.gz" > "$DUMP_TMP"
pg_restore --list "$DUMP_TMP" >/dev/null 2>&1 \
  || fail "pg_restore --list: $DUMP_FILE.gz is NOT a valid pg_dump archive — keeping file for inspection"
rm -f "$DUMP_TMP"

# 3. Upload to offsite storage (optional, e.g. S3)
if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
  OFFSITE_FILES=("$DUMP_FILE.gz" "$MANIFEST_FILE")
  [ -z "$UPLOADS_ARCHIVE" ] || OFFSITE_FILES+=("$UPLOADS_ARCHIVE")
  [ -z "$ATTACHMENTS_ARCHIVE" ] || OFFSITE_FILES+=("$ATTACHMENTS_ARCHIVE")
  for f in "${OFFSITE_FILES[@]}"; do
    aws s3 cp "$f" "s3://$S3_BACKUP_BUCKET/$(date +%Y/%m/%d)/" \
      || log "WARNING: offsite upload failed for $f (backup still valid locally)"
  done
fi

# 4. Cleanup old backups of this kind
find "$BACKUP_DIR" -name "erp_${BACKUP_KIND}_*.dump.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "erp_${BACKUP_KIND}_*.manifest" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "erp_${BACKUP_KIND}_*_uploads.tar.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "erp_${BACKUP_KIND}_*_attachments.tar.gz" -mtime +"$RETENTION_DAYS" -delete

# 5. Log
[ -z "$UPLOADS_ARCHIVE" ] || log "Uploads archive created: $UPLOADS_ARCHIVE ($(du -h "$UPLOADS_ARCHIVE" | cut -f1))"
[ -z "$ATTACHMENTS_ARCHIVE" ] || log "Attachments archive created: $ATTACHMENTS_ARCHIVE ($(du -h "$ATTACHMENTS_ARCHIVE" | cut -f1))"
log "${BACKUP_KIND} backup completed: $DUMP_FILE.gz ($(du -h "$DUMP_FILE.gz" | cut -f1), $ATT_COUNT attachment(s), retention ${RETENTION_DAYS}d)"

# Restore drill (see README «بازیابی از Backup»):  ./scripts/restore.sh $DUMP_FILE.gz
