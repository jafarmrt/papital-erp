#!/bin/bash
# scripts/backup-offsite.sh — v10.0.4 (O-02, TD-957): the encrypted off-server copy of one backup.
#
#   scripts/backup-offsite.sh <backup base path>        e.g. /var/backups/erp/erp_daily_20261009_023000
#
# backup.sh runs it after a verified local backup. It copies the dump, the manifest and the archives of that backup
# AND the application .env (JWT_SECRET, DATABASE_URL and ERP_SECRETS_KEY, without which the stored Nobitex password and
# the WooCommerce and webhook keys cannot be read on a new server) to BACKUP_RCLONE_REMOTE with rclone.
#
# The remote must be an rclone «crypt» remote (for example `papital-crypt:` wrapping a Google Drive remote): rclone
# encrypts names and contents on this server with the crypt password, so Google never sees a readable file. Any other
# remote type is refused, because the .env must never leave the server unencrypted. The crypt password is kept off
# the server by the owner (docs/OFFSITE_BACKUP.md); without it the copies cannot be read, so it is not in .env.
#
# Settings, from the environment or APP_DIR/.env:
#   BACKUP_RCLONE_REMOTE     crypt remote and optional folder, e.g. `papital-crypt:` or `papital-crypt:erp` (required)
#   OFFSITE_RETENTION_DAYS   copies of the same kind older than this are deleted from the remote (default 30)
#   RCLONE_CONFIG            rclone configuration file (default: ~/.config/rclone/rclone.conf of the running user)
#   BACKUP_DIR               where the status file .last_offsite_ok is written (default /var/backups/erp)
# Exit 0 when every file was copied, 1 otherwise; the local backup is never touched.
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BASE="${1:?usage: backup-offsite.sh <backup base path>}"

log()  { echo "[$(date)] $*"; }
fail() { log "Off-server copy FAILED: $*"; exit 1; }

# Value of KEY in APP_DIR/.env (first match, surrounding quotes removed), read literally like the service does
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

REMOTE="$(setting BACKUP_RCLONE_REMOTE)"
RETENTION="$(setting OFFSITE_RETENTION_DAYS 30)"
BACKUP_DIR="$(setting BACKUP_DIR /var/backups/erp)"
RCLONE_CONFIG_VALUE="$(setting RCLONE_CONFIG)"
[ -z "$RCLONE_CONFIG_VALUE" ] || export RCLONE_CONFIG="$RCLONE_CONFIG_VALUE"

[ -n "$REMOTE" ] || fail "BACKUP_RCLONE_REMOTE is not set (docs/OFFSITE_BACKUP.md)"
case "$REMOTE" in *:*) ;; *) fail "BACKUP_RCLONE_REMOTE must be an rclone remote such as papital-crypt: (got $REMOTE)" ;; esac
case "$RETENTION" in ''|*[!0-9]*) fail "OFFSITE_RETENTION_DAYS must be a whole number of days" ;; esac
[ "$RETENTION" -ge 1 ] || fail "OFFSITE_RETENTION_DAYS must be at least 1"
command -v rclone >/dev/null 2>&1 || fail "rclone is not installed (sudo apt-get install rclone)"
[ -f "$BASE.dump.gz" ] || fail "$BASE.dump.gz not found"
[ -f "$BASE.manifest" ] || fail "$BASE.manifest not found"
[ -f "$APP_DIR/.env" ] || fail "$APP_DIR/.env not found"

# Only a crypt remote: `rclone listremotes --long` prints «name: type» per remote
REMOTE_NAME="${REMOTE%%:*}"
REMOTE_TYPE="$(rclone listremotes --long 2>/dev/null | awk -v n="$REMOTE_NAME:" '$1 == n { print $2 }' | head -1)"
[ -n "$REMOTE_TYPE" ] || fail "rclone has no remote named $REMOTE_NAME (run rclone config as $(id -un); docs/OFFSITE_BACKUP.md)"
[ "$REMOTE_TYPE" = "crypt" ] || fail "remote $REMOTE_NAME is of type $REMOTE_TYPE, not crypt: the backup and .env would be stored unencrypted"

case "$REMOTE" in *:) TARGET="$REMOTE" ;; *) TARGET="${REMOTE%/}/" ;; esac
NAME="$(basename "$BASE")"
KIND="$(echo "$NAME" | sed -n 's/^erp_\(.*\)_[0-9]\{8\}_[0-9]\{6\}$/\1/p')"
[ -n "$KIND" ] || fail "$NAME is not a backup name (erp_<kind>_<date>_<time>)"

FILES=("$BASE.dump.gz" "$BASE.manifest")
[ ! -f "${BASE}_uploads.tar.gz" ] || FILES+=("${BASE}_uploads.tar.gz")
[ ! -f "${BASE}_attachments.tar.gz" ] || FILES+=("${BASE}_attachments.tar.gz")
for f in "${FILES[@]}"; do
  rclone copyto "$f" "${TARGET}$(basename "$f")" || fail "upload of $(basename "$f") to $REMOTE failed"
done
rclone copyto "$APP_DIR/.env" "${TARGET}${NAME}.env" || fail "upload of the .env copy to $REMOTE failed"

# Every file must be on the remote now, with the local size (rclone lsl prints «size date time name»)
LISTING="$(rclone lsl "$TARGET" --include "${NAME}*" 2>/dev/null)" || fail "listing $REMOTE failed"
for f in "${FILES[@]}" "$APP_DIR/.env"; do
  want_name="$(basename "$f")"
  [ "$f" != "$APP_DIR/.env" ] || want_name="${NAME}.env"
  want_size="$(stat -c '%s' "$f")"
  echo "$LISTING" | awk -v n="$want_name" -v s="$want_size" '$NF == n && $1 == s { found = 1 } END { exit found ? 0 : 1 }' \
    || fail "$want_name is not on $REMOTE with its size $want_size after the upload"
done

# Retention: copies of this kind older than OFFSITE_RETENTION_DAYS (a Drive remote moves them to its trash)
rclone delete "$TARGET" --min-age "${RETENTION}d" --include "erp_${KIND}_*" \
  || log "WARNING: deleting copies older than ${RETENTION} days from $REMOTE failed (the new copy is complete)"

echo "$(date +%s) $NAME" > "$BACKUP_DIR/.last_offsite_ok"
log "Off-server copy completed: ${#FILES[@]} backup file(s) and the .env copy of $NAME on $REMOTE (retention ${RETENTION}d)"
