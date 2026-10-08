#!/bin/bash
# scripts/monitor.sh — v10.0.4 (O-03, TD-1021): health, disk, backup age and event queue alerts of one server.
#
# Run every five minutes by cron (scripts/install-ops-cron.sh). Each run checks:
#   app      GET /health/ready answers 200
#   disk     use of the file systems holding APP_DIR and BACKUP_DIR stays below MONITOR_DISK_PERCENT (default 85)
#   backup   the last good daily backup (BACKUP_DIR/.last_daily_ok, written by backup.sh) is younger than
#            MONITOR_BACKUP_MAX_AGE_HOURS (default 26)
#   offsite  the same for its off-server copy (.last_offsite_ok), only when BACKUP_RCLONE_REMOTE is set
#   events   /metrics (read with METRICS_TOKEN): no unresolved dead-letter event and no outbox event stuck in
#            processing, and the queue gauges were read (src/middleware/metrics.ts)
# A check that starts failing sends one alert, a failing check is sent again every MONITOR_REPEAT_HOURS (default 6),
# and a check that recovers sends one «resolved» line. All changes of one run go in one message. The alert texts are
# Persian (scripts/ops/monitor-messages.fa.txt); what this script prints on the terminal is English.
#
# Alert channels (from the environment or APP_DIR/.env; any that is configured is used):
#   ALERT_BOT_TOKEN + ALERT_CHAT_ID [+ ALERT_BOT_API]   a bot of a Telegram-style API: Bale by default
#                                                       (https://tapi.bale.ai), or https://api.telegram.org
#   ALERT_SMTP_URL + ALERT_SMTP_USER + ALERT_SMTP_PASSWORD + ALERT_EMAIL_TO   e-mail through an SMTP server,
#                                                       e.g. smtps://smtp.gmail.com:465 with an app password
# With no channel configured the alerts are only printed (and the run exits 2 so the cron log shows it).
# State lives in MONITOR_STATE_DIR (default APP_DIR/logs/monitor-state). Exit 0 when every check passes, 1 otherwise.
set -uo pipefail
umask 077

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MESSAGES_FILE="${MONITOR_MESSAGES_FILE:-$APP_DIR/scripts/ops/monitor-messages.fa.txt}"

log() { echo "[$(date)] $*"; }

env_file_value() {
  local key="$1" file="$APP_DIR/.env"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" | head -1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}
setting() {
  local key="$1" fallback="${2:-}" value
  value="${!key:-}"
  [ -n "$value" ] || value="$(env_file_value "$key")"
  echo "${value:-$fallback}"
}
whole_number() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

PORT_VALUE="$(setting PORT 3000)"
BASE_URL="$(setting MONITOR_URL "http://127.0.0.1:${PORT_VALUE}")"
BASE_URL="${BASE_URL%/}"
METRICS_TOKEN_VALUE="$(setting METRICS_TOKEN)"
DISK_LIMIT="$(setting MONITOR_DISK_PERCENT 85)"
MAX_AGE_HOURS="$(setting MONITOR_BACKUP_MAX_AGE_HOURS 26)"
REPEAT_HOURS="$(setting MONITOR_REPEAT_HOURS 6)"
BACKUP_DIR_VALUE="$(setting BACKUP_DIR /var/backups/erp)"
OFFSITE_REMOTE="$(setting BACKUP_RCLONE_REMOTE)"
STATE_DIR="$(setting MONITOR_STATE_DIR "$APP_DIR/logs/monitor-state")"
BOT_TOKEN="$(setting ALERT_BOT_TOKEN)"
BOT_CHAT="$(setting ALERT_CHAT_ID)"
BOT_API="$(setting ALERT_BOT_API https://tapi.bale.ai)"
SMTP_URL="$(setting ALERT_SMTP_URL)"
SMTP_USER="$(setting ALERT_SMTP_USER)"
SMTP_PASSWORD="$(setting ALERT_SMTP_PASSWORD)"
EMAIL_TO="$(setting ALERT_EMAIL_TO)"
for n in "$DISK_LIMIT" "$MAX_AGE_HOURS" "$REPEAT_HOURS"; do
  whole_number "$n" || { log "ERROR: MONITOR_DISK_PERCENT, MONITOR_BACKUP_MAX_AGE_HOURS and MONITOR_REPEAT_HOURS must be whole numbers"; exit 1; }
done
[ -f "$MESSAGES_FILE" ] || { log "ERROR: alert texts not found: $MESSAGES_FILE"; exit 1; }
mkdir -p "$STATE_DIR" || { log "ERROR: cannot create $STATE_DIR"; exit 1; }

NOW="$(date +%s)"
[ -f "$STATE_DIR/first_run" ] || echo "$NOW" > "$STATE_DIR/first_run"
FIRST_RUN="$(cat "$STATE_DIR/first_run" 2>/dev/null || echo "$NOW")"
whole_number "$FIRST_RUN" || FIRST_RUN="$NOW"

# Persian digits of a whole number, without sed or the locale (cron runs with LANG=C)
FA_DIGITS=("$(printf '\xdb\xb0')" "$(printf '\xdb\xb1')" "$(printf '\xdb\xb2')" "$(printf '\xdb\xb3')" "$(printf '\xdb\xb4')"
  "$(printf '\xdb\xb5')" "$(printf '\xdb\xb6')" "$(printf '\xdb\xb7')" "$(printf '\xdb\xb8')" "$(printf '\xdb\xb9')")
persian_digits() {
  local n="$1" out="" i
  for ((i = 0; i < ${#n}; i++)); do out+="${FA_DIGITS[${n:i:1}]}"; done
  echo "$out"
}

# Alert text of KEY with its arguments; a whole-number argument is written in Persian digits
text() {
  local key="$1" template arg out
  shift
  template="$(grep -E "^${key}\|" "$MESSAGES_FILE" | head -1 | cut -d'|' -f2-)"
  [ -n "$template" ] || template="$key %s %s"
  out="$template"
  for arg in "$@"; do
    if whole_number "$arg"; then arg="$(persian_digits "$arg")"; fi
    out="${out/\%s/$arg}"
  done
  echo "${out//\%s/}"
}

LINES=()      # alert lines of this run
FAILED=0
# record ID STATUS(ok|fail) KEY [ARGS...]: compares with the stored state and queues an alert line on a change
record() {
  local id="$1" status="$2" key="$3" file since last_alert
  shift 3
  file="$STATE_DIR/check_${id//[^a-zA-Z0-9_]/_}"
  if [ "$status" = "ok" ]; then
    if [ -f "$file" ]; then
      read -r since last_alert < "$file" || true
      rm -f "$file"
      # a failure that was never sent needs no «resolved» line
      if [ "${last_alert:-0}" != "0" ]; then
        LINES+=("$(text resolved "$(text "$key" "$@")")")
        log "RESOLVED $id"
      fi
    fi
    return 0
  fi
  FAILED=1
  since="$NOW"; last_alert=0
  [ ! -f "$file" ] || read -r since last_alert < "$file" || true
  whole_number "${since:-}" || since="$NOW"
  whole_number "${last_alert:-}" || last_alert=0
  if [ "$last_alert" = "0" ]; then
    LINES+=("$(text "$key" "$@")")
    PENDING_IDS+=("$file")
    log "PROBLEM $id ($key)"
  elif [ $((NOW - last_alert)) -ge $((REPEAT_HOURS * 3600)) ]; then
    LINES+=("$(text still "$(text "$key" "$@")")")
    PENDING_IDS+=("$file")
    log "STILL FAILING $id ($key)"
  fi
  echo "$since $last_alert" > "$file"
}
PENDING_IDS=()

# --- app ---
APP_CODE="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$BASE_URL/health/ready" 2>/dev/null)"
APP_CODE="${APP_CODE:-000}"
if [ "$APP_CODE" = "200" ]; then record app ok app_ok; else record app fail app_down "HTTP $APP_CODE"; fi

# --- disk ---
declare -A SEEN_FS=()
for dir in "$APP_DIR" "$BACKUP_DIR_VALUE"; do
  probe="$dir"
  while [ ! -e "$probe" ] && [ "$probe" != "/" ]; do probe="$(dirname "$probe")"; done
  line="$(df -P "$probe" 2>/dev/null | awk 'NR == 2 { print $6 " " $5 }')"
  mount="${line%% *}"; used="${line##* }"; used="${used%\%}"
  if [ -z "$line" ] || ! whole_number "$used"; then
    record "disk_$dir" fail disk_unreadable "$dir"
    continue
  fi
  [ -z "${SEEN_FS[$mount]:-}" ] || continue
  SEEN_FS[$mount]=1
  if [ "$used" -ge "$DISK_LIMIT" ]; then record "disk_$mount" fail disk_full "$mount" "$used"; else record "disk_$mount" ok disk_ok "$mount"; fi
done

# --- backup age ---
# check_age ID STATUS_FILE KEY_PREFIX: a missing file counts only after MAX_AGE_HOURS of monitoring
check_age() {
  local id="$1" status_file="$2" prefix="$3" stamp age_hours
  stamp="$(awk 'NR == 1 { print $1 }' "$status_file" 2>/dev/null)"
  if whole_number "${stamp:-}"; then
    age_hours=$(( (NOW - stamp) / 3600 ))
    if [ $((NOW - stamp)) -gt $((MAX_AGE_HOURS * 3600)) ]; then record "$id" fail "${prefix}_stale" "$age_hours"; else record "$id" ok "${prefix}_ok"; fi
  elif [ $((NOW - FIRST_RUN)) -gt $((MAX_AGE_HOURS * 3600)) ]; then
    record "$id" fail "${prefix}_missing"
  else
    record "$id" ok "${prefix}_ok"
  fi
}
check_age backup "$BACKUP_DIR_VALUE/.last_daily_ok" backup
[ -z "$OFFSITE_REMOTE" ] || check_age offsite "$BACKUP_DIR_VALUE/.last_offsite_ok" offsite

# --- event queue (only while the app answers; a down app is already the app alert) ---
metric() { echo "$METRICS" | awk -v n="$1" '$1 == n { printf "%d", $2; found = 1 } END { if (!found) exit 1 }'; }
if [ "$APP_CODE" = "200" ]; then
  if [ -z "$METRICS_TOKEN_VALUE" ]; then
    record events fail events_unreadable "METRICS_TOKEN"
  elif ! METRICS="$(curl -fsS -m 15 -H "X-Metrics-Token: $METRICS_TOKEN_VALUE" "$BASE_URL/metrics" 2>/dev/null)"; then
    record events fail events_unreadable "/metrics"
  else
    UP="$(metric erp_queue_metrics_up)" || UP=""
    DLQ="$(metric erp_dead_letter_unresolved)" || DLQ=""
    STUCK="$(metric erp_outbox_stuck)" || STUCK=""
    if [ "$UP" != "1" ] || ! whole_number "$DLQ" || ! whole_number "$STUCK"; then
      record events fail events_unreadable "erp_queue_metrics_up"
    elif [ "$DLQ" -gt 0 ] || [ "$STUCK" -gt 0 ]; then
      record events fail events_bad "$DLQ" "$STUCK"
    else
      record events ok events_ok
    fi
    echo "$METRICS" | grep -E '^erp_' > "$STATE_DIR/metrics.last" 2>/dev/null || true
  fi
fi

# --- send ---
[ "${#LINES[@]}" -gt 0 ] || exit "$FAILED"
HOST="$(hostname 2>/dev/null || echo server)"
MESSAGE="$(text title "$HOST")"
for l in "${LINES[@]}"; do MESSAGE+=$'\n'"• $l"; done

SENT=0; CHANNELS=0
if [ -n "$BOT_TOKEN" ] && [ -n "$BOT_CHAT" ]; then
  CHANNELS=$((CHANNELS + 1))
  if curl -fsS -m 20 -o /dev/null -X POST "${BOT_API%/}/bot${BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${BOT_CHAT}" --data-urlencode "text=${MESSAGE}"; then
    SENT=1
  else
    log "WARNING: the bot alert could not be sent"
  fi
fi
if [ -n "$SMTP_URL" ] && [ -n "$EMAIL_TO" ]; then
  CHANNELS=$((CHANNELS + 1))
  MAIL_FILE="$(mktemp)"
  {
    echo "From: ${SMTP_USER:-papital-erp}"
    echo "To: $EMAIL_TO"
    echo "Subject: =?UTF-8?B?$(text title "$HOST" | base64 -w0)?="
    echo "MIME-Version: 1.0"
    echo "Content-Type: text/plain; charset=UTF-8"
    echo "Content-Transfer-Encoding: 8bit"
    echo
    echo "$MESSAGE"
  } > "$MAIL_FILE"
  if curl -fsS -m 30 --ssl-reqd --url "$SMTP_URL" --user "${SMTP_USER}:${SMTP_PASSWORD}" \
      --mail-from "${SMTP_USER}" --mail-rcpt "$EMAIL_TO" --upload-file "$MAIL_FILE" >/dev/null; then
    SENT=1
  else
    log "WARNING: the e-mail alert could not be sent"
  fi
  rm -f "$MAIL_FILE"
fi

if [ "$CHANNELS" -eq 0 ]; then
  log "WARNING: no alert channel configured (ALERT_BOT_TOKEN/ALERT_CHAT_ID or ALERT_SMTP_URL/ALERT_EMAIL_TO); ${#LINES[@]} alert line(s) not sent"
  exit 2
fi
if [ "$SENT" -eq 1 ]; then
  # the failures queued in this run were sent: their next reminder waits MONITOR_REPEAT_HOURS
  for f in "${PENDING_IDS[@]}"; do
    [ -f "$f" ] || continue
    read -r since _ < "$f" || true
    echo "${since:-$NOW} $NOW" > "$f"
  done
  log "Alert sent: ${#LINES[@]} line(s)"
else
  log "ERROR: no alert channel accepted the message; it is sent again on the next run"
  exit 2
fi
exit "$FAILED"
