#!/usr/bin/env bash
# scripts/ops-lock.sh — v11 (phase 5.1, O13 / O18): the one lock convention of the operations scripts.
#
# Sourced by backup.sh, restore.sh, upgrade-rehearsal.sh, nightly-verify.sh and update.sh. Two lock files of APP_DIR:
#   .update.lock          held (exclusive) by update.sh for its whole run (UPDATE_LOCK_NAME of scripts/update-steps.sh)
#   logs/.ops-busy.lock   held (shared) by every backup, restore and upgrade rehearsal while it runs
# A job asks the locks, never the process list: an editor or a shell whose command line names a script (`less
# scripts/backup.sh`) made the nightly check skip its night when it matched process names with pgrep (O13). The locks
# end with the process that holds them, also when it is killed.

OPS_UPDATE_LOCK_NAME=".update.lock"
OPS_BUSY_LOCK_NAME="logs/.ops-busy.lock"

# ops_lock_held <file>: 0 when another process holds a lock on <file>; a missing or unreadable file is not held
ops_lock_held() {
  [ -r "$1" ] || return 1
  command -v flock >/dev/null 2>&1 || return 1
  ! ( exec 6<"$1" && flock -n -x 6 )
}

# ops_busy_hold <app-dir>: takes the shared busy lock on descriptor 7 until this process ends. A lock file that cannot be
# made or read (another user's folder) is skipped with a warning: the job itself still runs.
ops_busy_hold() {
  local file="$1/$OPS_BUSY_LOCK_NAME"
  command -v flock >/dev/null 2>&1 || return 0
  mkdir -p "$(dirname "$file")" 2>/dev/null || true
  # made only when no file or link of that name is there (noclobber creates with O_EXCL): root never writes through a
  # link that the user owning logs/ put in its place
  ( set -C; umask 022; : > "$file" ) 2>/dev/null || true
  # readable by every user: root may have made it (a sudo restore), and a non-root backup must still see the lock; only
  # in a folder this user owns, where no one else can swap the file for a link between the test and the chmod
  if [ -O "$(dirname "$file")" ] && [ -O "$file" ] && [ ! -L "$file" ]; then chmod 644 "$file" 2>/dev/null || true; fi
  if [ -L "$file" ] || [ ! -r "$file" ]; then
    echo "[$(date)] WARNING: the operations lock $file is a link or cannot be read; this run is not seen by the nightly check and update.sh"
    return 0
  fi
  exec 7<"$file"
  flock -s 7
}

# ops_busy_release: lets the busy lock go before the process ends
ops_busy_release() { exec 7<&- 2>/dev/null || true; }

# ops_busy_now <app-dir>: 0 when an update runs or a backup, restore or upgrade rehearsal holds the busy lock
ops_busy_now() {
  ops_lock_held "$1/$OPS_UPDATE_LOCK_NAME" || ops_lock_held "$1/$OPS_BUSY_LOCK_NAME"
}

# ops_backup_wait_for_update <app-dir> <max-seconds>: the daily backup holds the busy lock, and while an update runs it
# lets it go and waits (O18: pg_dump holds a lock on every table, so a migration of the restart queues behind it and
# every request of the app behind the migration). Waits at most <max-seconds>, then the backup runs anyway: a stuck
# update must not cost the night's backup. update.sh waits for the busy lock the other way round (ops_wait_idle), so
# the two never wait for each other.
ops_backup_wait_for_update() {
  local app_dir="$1" max="$2" waited=0 poll="${OPS_LOCK_POLL_SECONDS:-30}"
  while :; do
    ops_busy_hold "$app_dir"
    ops_lock_held "$app_dir/$OPS_UPDATE_LOCK_NAME" || return 0
    if [ "$waited" -ge "$max" ]; then
      echo "[$(date)] WARNING: an update still runs after ${waited}s; the backup runs anyway"
      return 0
    fi
    ops_busy_release
    [ "$waited" -gt 0 ] || echo "[$(date)] An update is running in $app_dir; the backup waits for it (at most ${max}s)"
    sleep "$poll"
    waited=$((waited + poll))
  done
}

# ops_wait_idle <app-dir> <max-seconds>: update.sh, holding .update.lock, waits until no backup, restore or rehearsal
# holds the busy lock; 1 when one still runs after <max-seconds>
ops_wait_idle() {
  local app_dir="$1" max="$2" waited=0 poll="${OPS_LOCK_POLL_SECONDS:-5}"
  while ops_lock_held "$app_dir/$OPS_BUSY_LOCK_NAME"; do
    [ "$waited" -lt "$max" ] || return 1
    [ "$waited" -gt 0 ] || echo "[$(date)] A backup, restore or upgrade rehearsal is running; waiting for it to finish (at most ${max}s)"
    sleep "$poll"
    waited=$((waited + poll))
  done
  return 0
}
