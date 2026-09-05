#!/bin/bash
# scripts/backup.sh — PHASE 9 (14.1) Production Backup Strategy
# Full pg_dump backup with integrity verification, optional offsite upload and retention cleanup.
#
# Usage:
#   DATABASE_URL=... ./scripts/backup.sh                      # daily full backup (retention 30d)
#   BACKUP_KIND=pre-deployment RETENTION_DAYS=90 ./backup.sh  # snapshot before each deploy
#   BACKUP_KIND=pre-migration RETENTION_DAYS=180 ./backup.sh  # snapshot before schema migrations
#
# Cron example (/etc/cron.d/erp-backup):
#   0 2 * * * erp /home/erp/scripts/backup.sh >> /var/log/erp-backup.log 2>&1
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_KIND="${BACKUP_KIND:-daily}"

mkdir -p "$BACKUP_DIR"

# 1. Full dump (custom format, restorable with pg_restore --clean)
DUMP_FILE="$BACKUP_DIR/erp_${BACKUP_KIND}_${TIMESTAMP}.dump"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$DUMP_FILE"
gzip "$DUMP_FILE"

# 1b. V3.0.7 (TD-058 precursor): آپلودهای دیسکی (لوگو/تصاویر کالا) بخشی از داده
# قابل بازیابی هستند و خارج از pg_dump باقی می‌مانند — آرشیو tar جداگانه ساخته می‌شود.
UPLOADS_DIR="${UPLOADS_DIR:-$(pwd)/public/uploads}"
if [ -d "$UPLOADS_DIR" ] && [ -n "$(ls -A "$UPLOADS_DIR" 2>/dev/null)" ]; then
  UPLOADS_ARCHIVE="$BACKUP_DIR/erp_${BACKUP_KIND}_${TIMESTAMP}_uploads.tar.gz"
  tar -czf "$UPLOADS_ARCHIVE" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  gunzip -t "$UPLOADS_ARCHIVE" || { echo "[$(date)] Uploads archive verification FAILED for $UPLOADS_ARCHIVE"; exit 1; }
  if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
    aws s3 cp "$UPLOADS_ARCHIVE" "s3://$S3_BACKUP_BUCKET/$(date +%Y/%m/%d)/" \
      || echo "[$(date)] WARNING: uploads offsite upload failed (archive still valid locally)"
  fi
  echo "[$(date)] Uploads archive created: $UPLOADS_ARCHIVE ($(du -h "$UPLOADS_ARCHIVE" | cut -f1))"
fi

# 2. Verify backup integrity
gunzip -t "$DUMP_FILE.gz" || { echo "[$(date)] Backup verification FAILED for $DUMP_FILE.gz — keeping file for inspection"; exit 1; }

# 3. Upload to offsite storage (optional, e.g. S3)
if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
  aws s3 cp "$DUMP_FILE.gz" "s3://$S3_BACKUP_BUCKET/$(date +%Y/%m/%d)/" \
    || echo "[$(date)] WARNING: offsite upload failed (backup still valid locally)"
fi

# 4. Cleanup old backups of this kind
find "$BACKUP_DIR" -name "erp_${BACKUP_KIND}_*.dump.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "erp_${BACKUP_KIND}_*_uploads.tar.gz" -mtime +"$RETENTION_DAYS" -delete

# 5. Log
echo "[$(date)] ${BACKUP_KIND} backup completed: $DUMP_FILE.gz ($(du -h "$DUMP_FILE.gz" | cut -f1), retention ${RETENTION_DAYS}d)"

# Restore hint (see docs/runbook.md scenario 1 for the full procedure):
#   gunzip -c erp_${BACKUP_KIND}_${TIMESTAMP}.dump.gz | pg_restore --clean --if-exists -d erp_staging
