#!/bin/bash
# scripts/restore-media.sh — v11 (phase 5.1, O7): brings the media library (photos and videos of products) back from its
# encrypted off-server copy, after a lost disk or on a new server. The daily backup and restore.sh leave the library out
# because of its size; scripts/backup-media-offsite.sh copies its originals to MEDIA_RCLONE_REMOTE every night.
#
#   scripts/restore-media.sh            (copies the originals the server lacks; files already here are never touched)
#
# It copies <remote>/originals back into MEDIA_DIR/originals with `rclone copy --ignore-existing`, so a file that is
# here already stays as it is and the run can be repeated, then checks that every file of the remote is here with its
# size. The light versions and thumbnails are made again from the originals with the command it prints at the end. The
# same settings as backup-media-offsite.sh (MEDIA_RCLONE_REMOTE, MEDIA_DIR, RCLONE_CONFIG; from the environment or
# APP_DIR/.env); like it, only a crypt remote is accepted. Run it as the user that runs the service (the files must
# belong to it). Exit 0 when every file of the copy is here, 1 otherwise.
set -euo pipefail
umask 027

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

log() { echo "[$(date)] $*"; }
fail() { log "Media library restore FAILED: $*"; exit 1; }

# shellcheck source=scripts/env-file.sh
source "$(dirname "${BASH_SOURCE[0]}")/env-file.sh"
setting() {
  local key="$1" fallback="${2:-}" value
  value="${!key:-}"
  [ -n "$value" ] || value="$(env_file_get "$APP_DIR/.env" "$key")"
  echo "${value:-$fallback}"
}
absolute() { case "$1" in /*) echo "$1" ;; *) echo "$APP_DIR/$1" ;; esac; }

REMOTE="$(setting MEDIA_RCLONE_REMOTE)"
MEDIA_ROOT="$(absolute "$(setting MEDIA_DIR "$APP_DIR/media-library")")"
RCLONE_CONFIG_VALUE="$(setting RCLONE_CONFIG)"
[ -z "$RCLONE_CONFIG_VALUE" ] || export RCLONE_CONFIG="$RCLONE_CONFIG_VALUE"

# the files must belong to the service's user: root copying them would leave them unreadable for a non-root service
OWNER="$(stat -c %U "$MEDIA_ROOT" 2>/dev/null || stat -c %U "$APP_DIR")"
if [ "$(id -u)" = "0" ] && [ "$OWNER" != "root" ]; then
  fail "run it as the user that owns $APP_DIR: sudo -u $OWNER bash $APP_DIR/scripts/restore-media.sh"
fi
[ -n "$REMOTE" ] || fail "MEDIA_RCLONE_REMOTE is not set in $APP_DIR/.env: there is no off-server copy to restore from (docs/OFFSITE_BACKUP.md)"
case "$REMOTE" in *:*) ;; *) fail "MEDIA_RCLONE_REMOTE must be an rclone remote such as papital-crypt: (got $REMOTE)" ;; esac
command -v rclone >/dev/null 2>&1 || fail "rclone is not installed (sudo apt-get install rclone)"
REMOTE_NAME="${REMOTE%%:*}"
REMOTE_TYPE="$(rclone listremotes --long 2>/dev/null | awk -v n="$REMOTE_NAME:" '$1 == n { print $2 }' | head -1)"
[ -n "$REMOTE_TYPE" ] || fail "rclone has no remote named $REMOTE_NAME (run rclone config as $(id -un); docs/OFFSITE_BACKUP.md)"
[ "$REMOTE_TYPE" = "crypt" ] || fail "remote $REMOTE_NAME is of type $REMOTE_TYPE, not crypt; the copy is only ever read from a crypt remote"

# the folder backup-media-offsite.sh writes to
case "$REMOTE" in *:) SOURCE="${REMOTE}media-library/originals" ;; *) SOURCE="${REMOTE%/}/originals" ;; esac
TARGET="$MEDIA_ROOT/originals"
mkdir -p "$TARGET"

log "Copying the originals the server lacks from $SOURCE to $TARGET"
rclone copy "$SOURCE" "$TARGET" --ignore-existing --log-level NOTICE || fail "rclone copy from $REMOTE_NAME failed"
# every file of the copy must be here with its size (a crypt remote has no content hashes, which rclone reports as an
# ERROR line that is dropped here)
rclone check "$SOURCE" "$TARGET" --one-way --size-only --log-level NOTICE 2> >(grep -v 'No common hash found' >&2) \
  || fail "some files of the copy on $REMOTE_NAME are missing or different here after the copy"

COUNT="$(find "$TARGET" -type f | wc -l)"
log "Media library restored: $COUNT original(s) in $TARGET"
log "Next, as the service user, make the light versions and thumbnails again: cd $APP_DIR && npm run media:rebuild-light -- --apply"
