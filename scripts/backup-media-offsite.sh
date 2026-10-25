#!/bin/bash
# scripts/backup-media-offsite.sh — v10.2.31 (decision T43-a, 10.2 package 13 item 7): the encrypted off-server copy of
# the media library (photos and videos of products), which the daily backup leaves out because of its size.
#
#   scripts/backup-media-offsite.sh            (install-ops-cron.sh runs it every night)
#
# It copies MEDIA_DIR/originals (each file named by its content and never changed) to the rclone «crypt» remote
# MEDIA_RCLONE_REMOTE with `rclone copy --ignore-existing`, so a night sends only the files added since the last one, and
# then checks that every local original is on the remote with its size. Light versions and thumbnails are not sent:
# `npm run media:rebuild-light -- --apply` makes them again from the originals. A file deleted here stays on the remote.
# Like backup-offsite.sh it refuses any remote that is not of type crypt, so Google only ever sees unreadable names and
# contents. The rclone configuration is the one the daily off-server copy uses (docs/OFFSITE_BACKUP.md); nothing here
# reads or prints its passwords or tokens.
#
# Settings, from the environment or APP_DIR/.env:
#   MEDIA_RCLONE_REMOTE    crypt remote and optional folder, e.g. `papital-crypt:`; a remote without a folder gets the
#                          folder media-library/. Unset: the copy is off, the report says so and the exit is 0.
#   MEDIA_DIR              the media library (default APP_DIR/media-library, the same value the service uses)
#   MEDIA_OFFSITE_REPORT   the JSON report the health page reads (default APP_DIR/logs/media-offsite.json)
#   RCLONE_CONFIG          rclone configuration file (default: ~/.config/rclone/rclone.conf of the running user)
# Exit 0 when the copy is complete or off, 1 when it failed; the media library is only read.
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

log() { echo "[$(date)] $*"; }

# v11 (O5): read as the service reads it (node --env-file: the last line wins, «export», inline comments), one reader
# for every script (scripts/env-file.sh)
# shellcheck source=scripts/env-file.sh
source "$(dirname "${BASH_SOURCE[0]}")/env-file.sh"
env_file_value() { env_file_get "$APP_DIR/.env" "$1"; }
setting() {
  local key="$1" fallback="${2:-}" value
  value="${!key:-}"
  [ -n "$value" ] || value="$(env_file_value "$key")"
  echo "${value:-$fallback}"
}
absolute() { case "$1" in /*) echo "$1" ;; *) echo "$APP_DIR/$1" ;; esac; }

REMOTE="$(setting MEDIA_RCLONE_REMOTE)"
MEDIA_ROOT="$(absolute "$(setting MEDIA_DIR "$APP_DIR/media-library")")"
REPORT="$(absolute "$(setting MEDIA_OFFSITE_REPORT "$APP_DIR/logs/media-offsite.json")")"
RCLONE_CONFIG_VALUE="$(setting RCLONE_CONFIG)"
[ -z "$RCLONE_CONFIG_VALUE" ] || export RCLONE_CONFIG="$RCLONE_CONFIG_VALUE"
mkdir -p "$(dirname "$REPORT")"

# the time of the last complete copy, kept from the previous report
LAST_OK_AT="$(sed -n 's/.*"lastOkAt":\([0-9][0-9]*\).*/\1/p' "$REPORT" 2>/dev/null | head -1 || true)"
REMOTE_NAME="${REMOTE%%:*}"
FILES=0
BYTES=0
# report <state> <error code>: state ok, failed or off; the code names the failure for the health page
report() {
  local state="$1" code="${2:-}" now tmp
  now="$(date +%s)"
  [ "$state" != "ok" ] || LAST_OK_AT="$now"
  tmp="$(mktemp "$(dirname "$REPORT")/.media-offsite.XXXXXX")"
  printf '{"version":1,"state":"%s","at":%s,"lastOkAt":%s,"files":%s,"bytes":%s,"remote":"%s","error":"%s"}\n' \
    "$state" "$now" "${LAST_OK_AT:-null}" "$FILES" "$BYTES" "${REMOTE_NAME//[^A-Za-z0-9_.-]/}" "$code" > "$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$REPORT"
}
fail() { log "Media library off-server copy FAILED: $2"; report failed "$1"; exit 1; }

if [ -z "$REMOTE" ]; then
  log "MEDIA_RCLONE_REMOTE is not set: the off-server copy of the media library is off (docs/OFFSITE_BACKUP.md)"
  REMOTE_NAME=""
  report off
  exit 0
fi

# one run at a time: the first copy of a large library can outlast a night
LOCK="$(dirname "$REPORT")/.media-offsite.lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  flock -n 9 || { log "Another copy of the media library is still running; this run is skipped"; exit 0; }
fi

case "$REMOTE" in *:*) ;; *) fail bad-remote "MEDIA_RCLONE_REMOTE must be an rclone remote such as papital-crypt: (got $REMOTE)" ;; esac
command -v rclone >/dev/null 2>&1 || fail no-rclone "rclone is not installed (sudo apt-get install rclone)"
# Only a crypt remote: `rclone listremotes --long` prints «name: type» per remote
REMOTE_TYPE="$(rclone listremotes --long 2>/dev/null | awk -v n="$REMOTE_NAME:" '$1 == n { print $2 }' | head -1)"
[ -n "$REMOTE_TYPE" ] || fail no-remote "rclone has no remote named $REMOTE_NAME (run rclone config as $(id -un); docs/OFFSITE_BACKUP.md)"
[ "$REMOTE_TYPE" = "crypt" ] || fail not-crypt "remote $REMOTE_NAME is of type $REMOTE_TYPE, not crypt: the media files would be stored unencrypted"

# a remote without a folder gets media-library/, so the daily backups stay alone at its top
case "$REMOTE" in *:) TARGET="${REMOTE}media-library/originals" ;; *) TARGET="${REMOTE%/}/originals" ;; esac
SOURCE="$MEDIA_ROOT/originals"
if [ ! -d "$SOURCE" ]; then
  log "No media library files yet ($SOURCE): nothing to copy"
  report ok
  exit 0
fi
read -r FILES BYTES <<< "$(find "$SOURCE" -type f -printf '%s\n' | awk '{ n++; s += $1 } END { printf "%d %d\n", n, s }')"

# low priority: the library is read while the application serves users
NICE=(nice -n 10)
! command -v ionice >/dev/null 2>&1 || NICE+=(ionice -c 3)
log "Copying new files of the media library ($FILES files) to $TARGET"
"${NICE[@]}" rclone copy "$SOURCE" "$TARGET" --ignore-existing --log-level NOTICE \
  || fail copy-failed "rclone copy to $REMOTE_NAME failed"
# every local original must be on the remote with its size (a crypt remote has no content hashes to compare, which
# rclone reports as an ERROR line that is dropped here)
"${NICE[@]}" rclone check "$SOURCE" "$TARGET" --one-way --size-only --log-level NOTICE 2> >(grep -v 'No common hash found' >&2) \
  || fail check-failed "some files of the media library are missing or different on $REMOTE_NAME after the copy"

report ok
log "Media library off-server copy completed: $FILES files on $TARGET"
