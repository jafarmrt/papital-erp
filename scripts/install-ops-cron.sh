#!/usr/bin/env bash
# v10.0.3 (TD-1020): installs the operations schedule of a Linux server in one cron file:
#   - scripts/backup.sh every day at BACKUP_HOUR:BACKUP_MINUTE (server time; default 02:30) — the local backup and,
#     when BACKUP_RCLONE_REMOTE is set in .env, its encrypted off-server copy (scripts/backup-offsite.sh);
#   - scripts/monitor.sh every five minutes — health, disk, backup age and event queue alerts (v10.0.6).
# install.sh runs it; on a server installed earlier run it once by hand:
#   sudo bash scripts/install-ops-cron.sh [service-user]
# The file is rewritten as a whole, so running it again changes nothing. The output of both jobs goes to
# APP_DIR/logs/backup.log and APP_DIR/logs/monitor.log.
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RUN_USER="${1:-${RUN_USER:-$(id -un)}}"
CRON_FILE="${CRON_FILE:-/etc/cron.d/papital-erp}"
BACKUP_HOUR="${BACKUP_HOUR:-2}"
BACKUP_MINUTE="${BACKUP_MINUTE:-30}"
LOG_DIR="$APP_DIR/logs"

case "$BACKUP_HOUR" in ''|*[!0-9]*) echo "ERROR: BACKUP_HOUR must be 0-23" >&2; exit 1 ;; esac
case "$BACKUP_MINUTE" in ''|*[!0-9]*) echo "ERROR: BACKUP_MINUTE must be 0-59" >&2; exit 1 ;; esac
[ "$BACKUP_HOUR" -le 23 ] && [ "$BACKUP_MINUTE" -le 59 ] || { echo "ERROR: backup time out of range" >&2; exit 1; }
id "$RUN_USER" >/dev/null 2>&1 || { echo "ERROR: user $RUN_USER does not exist" >&2; exit 1; }
[ -f "$APP_DIR/scripts/backup.sh" ] || { echo "ERROR: $APP_DIR/scripts/backup.sh not found" >&2; exit 1; }

mkdir -p "$LOG_DIR"
# the jobs run as RUN_USER; the log directory must be writable by it (it already is when install.sh made it)
if [ "$(id -u)" -eq 0 ] && [ "$RUN_USER" != "root" ]; then chown "$RUN_USER" "$LOG_DIR" 2>/dev/null || true; fi

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT
cat > "$TMP_FILE" <<CRON
# Papital ERP operations schedule (scripts/install-ops-cron.sh). Rewritten by that script; edit it there.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${BACKUP_MINUTE} ${BACKUP_HOUR} * * * ${RUN_USER} ${APP_DIR}/scripts/backup.sh >> ${LOG_DIR}/backup.log 2>&1
*/5 * * * * ${RUN_USER} ${APP_DIR}/scripts/monitor.sh >> ${LOG_DIR}/monitor.log 2>&1
CRON
# cron ignores files in /etc/cron.d that are writable by others or not owned by root
chmod 644 "$TMP_FILE"
mkdir -p "$(dirname "$CRON_FILE")"
mv "$TMP_FILE" "$CRON_FILE"
trap - EXIT
echo "Installed $CRON_FILE: daily backup at $(printf '%02d:%02d' "$BACKUP_HOUR" "$BACKUP_MINUTE") and monitor every 5 minutes as $RUN_USER"
# the older single-purpose file of GO_LIVE_CHECKLIST.md 6.1 would run a second backup every night
OLD_FILE="$(dirname "$CRON_FILE")/papital-erp-backup"
if [ -f "$OLD_FILE" ]; then
  rm -f "$OLD_FILE"
  echo "Removed the older $OLD_FILE (its backup job is in $CRON_FILE now)"
fi
