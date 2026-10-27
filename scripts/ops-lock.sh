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
# v11 (phase 5.3, TD-1354): logs/ belongs to the service user, who could put a FIFO or a link to one there: opening it
# would wait forever (update.sh, the nightly check). Only a plain file is opened, and the open itself is given 10
# seconds, since the file can be swapped between the test and the open; anything else is not held
ops_lock_held() {
  [ -f "$1" ] && [ ! -L "$1" ] && [ -r "$1" ] || return 1
  command -v flock >/dev/null 2>&1 || return 1
  # shellcheck disable=SC2016
  local rc=0
  timeout 10 bash -c 'flock -n -x -E 75 6 6<"$1"' lock "$1" 2>/dev/null || rc=$?
  [ "$rc" -eq 75 ]
}

# ops_busy_hold <app-dir>: takes the shared busy lock on descriptor 7 until this process ends. A lock file that cannot be
# made or read (another user's folder) is skipped with a warning: the job itself still runs.
ops_busy_hold() {
  local file="$1/$OPS_BUSY_LOCK_NAME"
  command -v flock >/dev/null 2>&1 || return 0
  mkdir -p "$(dirname "$file")" 2>/dev/null || true
  # only a plain file is used: a link (bash's noclobber opens an existing non-file without O_EXCL, so a link to a FIFO
  # would hang the job) or anything else the user owning logs/ put there is skipped
  if [ -L "$file" ] || { [ -e "$file" ] && [ ! -f "$file" ]; }; then
    echo "[$(date)] WARNING: the operations lock $file is a link or not a plain file; this run is not seen by the nightly check and update.sh"
    return 0
  fi
  # made only when no file of that name is there (noclobber creates with O_EXCL)
  ( set -C; umask 022; : > "$file" ) 2>/dev/null || true
  # readable by every user: root may have made it (a sudo restore), and a non-root backup must still see the lock; only
  # when this user owns the app folder and logs/, so no one else can swap logs/ or the file between the test and chmod
  if [ -O "$1" ] && [ -O "$(dirname "$file")" ] && [ -O "$file" ] && [ ! -L "$file" ]; then chmod 644 "$file" 2>/dev/null || true; fi
  if [ -L "$file" ] || [ ! -f "$file" ] || [ ! -r "$file" ]; then
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
