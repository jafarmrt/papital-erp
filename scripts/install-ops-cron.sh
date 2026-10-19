#!/usr/bin/env bash
# v10.0.3 (TD-1020): installs the operations schedule of a Linux server in one cron file:
#   - scripts/backup.sh every day at BACKUP_HOUR:BACKUP_MINUTE (server time; default 02:30) — the local backup and,
#     when BACKUP_RCLONE_REMOTE is set in .env, its encrypted off-server copy (scripts/backup-offsite.sh);
#   - scripts/monitor.sh every five minutes — health, disk, backup age and event queue alerts (v10.0.6);
#   - scripts/nightly-verify.sh every day at NIGHTLY_VERIFY_HOUR:NIGHTLY_VERIFY_MINUTE (default 04:00) as root — restores
#     the latest good backup into a drill copy and checks its accounts and stock (v10.2.16, O-04); root, because
#     creating the drill database needs `sudo -u postgres` unless .env sets RESTORE_ADMIN_URL. It starts at least 60
#     minutes after the backup, so it never checks a backup still being written.
# install.sh runs it; on a server installed earlier run it once by hand:
#   sudo bash scripts/install-ops-cron.sh [service-user]
# The file is rewritten as a whole: a run without the time variables writes the default times again, replacing any
# custom times set earlier; the times it wrote are printed. The output of the three jobs goes to APP_DIR/logs/backup.log,
# APP_DIR/logs/monitor.log and APP_DIR/logs/nightly-verify.log.
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RUN_USER="${1:-${RUN_USER:-$(id -un)}}"
CRON_FILE="${CRON_FILE:-/etc/cron.d/papital-erp}"
LOG_DIR="$APP_DIR/logs"

if [ -z "${BACKUP_HOUR+x}${BACKUP_MINUTE+x}${NIGHTLY_VERIFY_HOUR+x}${NIGHTLY_VERIFY_MINUTE+x}" ]; then
  echo "Note: no time variables given, so the default times are written (any custom times set earlier are replaced)"
fi
BACKUP_HOUR="${BACKUP_HOUR:-2}"
BACKUP_MINUTE="${BACKUP_MINUTE:-30}"
NIGHTLY_VERIFY_HOUR="${NIGHTLY_VERIFY_HOUR:-4}"
NIGHTLY_VERIFY_MINUTE="${NIGHTLY_VERIFY_MINUTE:-0}"

# a whole number up to MAX, read as decimal (08 and 09 are hours, not bad octal)
decimal_in_range() {
  local name="$1" value="$2" max="$3"
  case "$value" in ''|*[!0-9]*) echo "ERROR: $name must be 0-$max" >&2; exit 1 ;; esac
  value=$((10#$value))
  [ "$value" -le "$max" ] || { echo "ERROR: $name must be 0-$max" >&2; exit 1; }
  echo "$value"
}
BACKUP_HOUR="$(decimal_in_range BACKUP_HOUR "$BACKUP_HOUR" 23)"
BACKUP_MINUTE="$(decimal_in_range BACKUP_MINUTE "$BACKUP_MINUTE" 59)"
NIGHTLY_VERIFY_HOUR="$(decimal_in_range NIGHTLY_VERIFY_HOUR "$NIGHTLY_VERIFY_HOUR" 23)"
NIGHTLY_VERIFY_MINUTE="$(decimal_in_range NIGHTLY_VERIFY_MINUTE "$NIGHTLY_VERIFY_MINUTE" 59)"
# the check restores the backup the daily job last finished: it starts 60 minutes or more after the backup starts
GAP=$(( ((NIGHTLY_VERIFY_HOUR * 60 + NIGHTLY_VERIFY_MINUTE) - (BACKUP_HOUR * 60 + BACKUP_MINUTE) + 1440) % 1440 ))
if [ "$GAP" -lt 60 ]; then
  echo "ERROR: the nightly check must start at least 60 minutes after the daily backup (backup $(printf '%02d:%02d' "$BACKUP_HOUR" "$BACKUP_MINUTE"), check $(printf '%02d:%02d' "$NIGHTLY_VERIFY_HOUR" "$NIGHTLY_VERIFY_MINUTE"))" >&2
  exit 1
fi
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
${NIGHTLY_VERIFY_MINUTE} ${NIGHTLY_VERIFY_HOUR} * * * root ${APP_DIR}/scripts/nightly-verify.sh >> ${LOG_DIR}/nightly-verify.log 2>&1
CRON
# cron ignores files in /etc/cron.d that are writable by others or not owned by root
chmod 644 "$TMP_FILE"
mkdir -p "$(dirname "$CRON_FILE")"
mv "$TMP_FILE" "$CRON_FILE"
trap - EXIT
echo "Installed $CRON_FILE: daily backup at $(printf '%02d:%02d' "$BACKUP_HOUR" "$BACKUP_MINUTE") and monitor every 5 minutes as $RUN_USER, nightly backup check at $(printf '%02d:%02d' "$NIGHTLY_VERIFY_HOUR" "$NIGHTLY_VERIFY_MINUTE") as root"
# the older single-purpose file of GO_LIVE_CHECKLIST.md 6.1 would run a second backup every night
OLD_FILE="$(dirname "$CRON_FILE")/papital-erp-backup"
if [ -f "$OLD_FILE" ]; then
  rm -f "$OLD_FILE"
  echo "Removed the older $OLD_FILE (its backup job is in $CRON_FILE now)"
fi
