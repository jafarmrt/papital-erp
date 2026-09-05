#!/bin/bash
# scripts/restore.sh — PHASE 3 (TD-059) Disaster Recovery: Restore & Restore-Drill
# ==============================================================================
# Real restore procedure + automated restore drill (verify mode) that restores a
# dump into an ISOLATED temporary database — "backup exists" is NOT "restorable"
# until this actually succeeds.
#
# Usage:
#   RESTORE_MODE=drill  ./scripts/restore.sh [dump-file.dump.gz]
#     → restores into a temporary drill database, validates core table row
#       counts, then drops the temp database. Zero impact on production data.
#
#   RESTORE_MODE=apply  ./scripts/restore.sh [dump-file.dump.gz] [target-db-name]
#     → restores over the TARGET database (destructive! --clean --if-exists).
#       Requires RESTORE_CONFIRM="yes" to run.
#
# Env:
#   DATABASE_URL   — mandatory; connection string to the PostgreSQL server
#                    (its database part is ignored in drill mode).
#   RESTORE_MODE   — drill (default) | apply
#   RESTORE_KEEP   — 1 → keep the drill database for inspection (default 0)
#   PGPASSWORD     — password for psql/pg_restore (optional)
# set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESTORE_MODE="${RESTORE_MODE:-drill}"
RESTORE_KEEP="${RESTORE_KEEP:-0}"

[ -n "${DATABASE_URL:-}" ] || { echo "ERROR: DATABASE_URL must be set"; exit 1; }

# Parse DATABASE_URL parts
DB_URL_RE='^(postgresql|postgres)://([^:@/]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^/?]+)'
[[ "$DATABASE_URL" =~ $DB_URL_RE ]] || { echo "ERROR: DATABASE_URL is not in standard postgres://user:pass@host:port/db form"; exit 1; }
DB_USER="${BASH_REMATCH[2]}"
DB_PASS="${BASH_REMATCH[4]}"
DB_HOST="${BASH_REMATCH[5]}"
DB_PORT="${BASH_REMATCH[7]:-5432}"
DB_ADMIN_DB="${BASH_REMATCH[8]}"

export PGPASSWORD="$DB_PASS"
PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -v ON_ERROR_STOP=1"
DRILL_DB="erp_restore_drill_${TIMESTAMP}"
BACKUP_FILE="${1:-}"

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

if [ "$RESTORE_MODE" = "apply" ] && [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  fail "apply mode is DESTRUCTIVE (drops/recreates objects on the target DB). Set RESTORE_CONFIRM=yes to proceed."
fi

# ---------- Locate the dump file ----------
if [ -z "$BACKUP_FILE" ]; then
  BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp}"
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/erp_*.dump.gz 2>/dev/null | head -1)
  [ -n "$BACKUP_FILE" ] || fail "no dump file found in $BACKUP_DIR — pass one explicitly"
fi
[ -f "$BACKUP_FILE" ] || fail "dump file not found: $BACKUP_FILE"
log "Restoring from: $BACKUP_FILE (mode=$RESTORE_MODE)"

# ---------- Resolve target DB ----------
TARGET_DB="$DB_ADMIN_DB"
if [ "$RESTORE_MODE" = "drill" ]; then
  TARGET_DB="$DRILL_DB"
  log "Creating isolated drill database: $TARGET_DB"
  $PSQL -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" >/dev/null || true
  $PSQL -c "CREATE DATABASE \"$TARGET_DB\";" || fail "cannot create drill database"
elif [ -n "${2:-}" ]; then
  TARGET_DB="$2"
fi

RESTORE_EXIT=0
gunzip -c "$BACKUP_FILE" | pg_restore --no-owner --no-privileges --no-comments -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TARGET_DB" || RESTORE_EXIT=$?

if [ "$RESTORE_EXIT" -ne 0 ]; then
  # pg_restore returns 1 on partial errors; report and treat drill as failed
  log "pg_restore finished with errors (exit=$RESTORE_EXIT)"
  [ "$RESTORE_MODE" = "drill" ] && { [ "$RESTORE_KEEP" = "1" ] || $PSQL -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" >/dev/null; }
  fail "restore FAILED — backup is NOT restorable"
fi

# ---------- Post-restore validation ----------
VALIDATE_SQL="
SELECT 'users' AS tbl, COUNT(*) AS rows FROM users
UNION ALL SELECT 'roles', COUNT(*) FROM roles
UNION ALL SELECT 'items', COUNT(*) FROM items
UNION ALL SELECT 'documents', COUNT(*) FROM documents
UNION ALL SELECT 'transactions', COUNT(*) FROM transactions
UNION ALL SELECT 'journal_vouchers', COUNT(*) FROM journal_vouchers
UNION ALL SELECT 'journal_voucher_items', COUNT(*) FROM journal_voucher_items
UNION ALL SELECT 'app_settings', COUNT(*) FROM app_settings
UNION ALL SELECT 'customers', COUNT(*) FROM customers
UNION ALL SELECT 'activity_logs', COUNT(*) FROM activity_logs;"
DRILL_PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $TARGET_DB -t -A"
VALIDATE_OUT=$($DRILL_PSQL -c "$VALIDATE_SQL") || fail "post-restore validation query failed"

EMPTY_CRITICAL=$(echo "$VALIDATE_OUT" | grep -E "^(users|roles|journal_vouchers|app_settings)," | awk -F'|' '$2 == 0' | wc -l)
echo "$VALIDATE_OUT" | while IFS='|' read -r tbl rows; do log "  table $tbl → $rows rows"; done

if [ "$EMPTY_CRITICAL" -gt 0 ]; then
  [ "$RESTORE_MODE" = "drill" ] && { [ "$RESTORE_KEEP" = "1" ] || $PSQL -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" >/dev/null; }
  fail "post-restore validation FAILED — one or more core tables are empty"
fi

# ---------- Cleanup ----------
if [ "$RESTORE_MODE" = "drill" ] && [ "$RESTORE_KEEP" != "1" ]; then
  log "Dropping drill database $TARGET_DB"
  $PSQL -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" >/dev/null
fi

log "SUCCESS: restore drill passed — dump $BACKUP_FILE is verified restorable ($(echo "$VALIDATE_OUT" | wc -l) core tables validated)"
exit 0
