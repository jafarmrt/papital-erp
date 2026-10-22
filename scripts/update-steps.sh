#!/usr/bin/env bash
# scripts/update-steps.sh — v10.2.23 (OBS-R1-22 / OBS-R1-17, 10.2 package 13): the build and source steps of update.sh.
#
# Sourced by update.sh. Run on its own only to put the previous source of a manual update back:
#   bash scripts/update-steps.sh restore-source <app-dir>
#
# OBS-R1-22: the new version is installed and built in a side folder (<app-dir>/.build-next, on the same disk so
# the swap is a rename). The running service keeps its own dist/ and node_modules/ until the swap, which happens
# right before the restart; until then a failed install, build or rehearsal leaves the running version untouched.
# The swap keeps the previous build as dist.prev/ and node_modules.prev/ for a rollback (removed by the next update).
# OBS-R1-17: a manual update (--source / --zip) first keeps the current source in <app-dir>/.previous-source, then
# syncs the new source with --delete, so files the new version no longer has are removed. These syncs compare by
# content (--checksum): a changed file of the same size and time is never kept. Live state (the list in
# update_state_excludes) is never copied, compared or deleted.

UPDATE_BUILD_DIR_NAME=".build-next"
UPDATE_PREVIOUS_SOURCE_NAME=".previous-source"
# held (flock) for the whole run, so a second update refuses at once instead of wiping the first one's side folder
UPDATE_LOCK_NAME=".update.lock"
# present only while the build swap runs; a later run that finds it refuses until the restore was done
UPDATE_SWAP_MARKER_NAME=".update-swapping"
# written into dist/ by the update: the source fingerprint and the commit the build was made from
UPDATE_FINGERPRINT_NAME=".source-fingerprint"
UPDATE_COMMIT_NAME=".source-commit"

# Value of KEY in <app-dir>/.env read literally, as the service reads it
update_env_value() {
  local app_dir="$1" key="$2"
  [ -f "$app_dir/.env" ] || return 0
  grep -E "^${key}=" "$app_dir/.env" | head -1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}

# Fills the array UPDATE_EXCLUDES with the rsync filters of the live state of <app-dir>: never part of the source
update_state_excludes() {
  local app_dir="$1" key value rel
  UPDATE_EXCLUDES=(
    --include='/.env.example'
    --exclude='/.env' --exclude='/.env.*'
    --exclude='/.git'
    --exclude='/logs'
    --exclude='/install-*.log' --exclude='/update-*.log' --exclude='/domain-setup-*.log'
    --exclude='/.pgdata' --exclude='/.pgsql'
    --exclude='/backups'
    --exclude='/public/uploads'
    --exclude='/media-library'
    --exclude='/node_modules' --exclude='/node_modules.prev'
    --exclude='/dist' --exclude='/dist.prev'
    --exclude="/${UPDATE_BUILD_DIR_NAME}" --exclude="/${UPDATE_PREVIOUS_SOURCE_NAME}"
    --exclude="/${UPDATE_LOCK_NAME}" --exclude="/${UPDATE_SWAP_MARKER_NAME}"
    --exclude='*.zip'
  )
  # folders .env moved inside the application directory hold live state too; both sides are resolved
  # (`./`, `..`, symlinks), so a folder written another way, or reached through a link, is still excluded
  local app_real target
  app_real="$(realpath -m "$app_dir")"
  for key in MEDIA_DIR ATTACHMENTS_DIR LOG_DIR BACKUP_DIR UPLOADS_DIR; do
    value="$(update_env_value "$app_dir" "$key")"
    [ -n "$value" ] || continue
    case "$value" in
      /*) target="$(realpath -m "$value")" ;;
      *) target="$(realpath -m "$app_dir/$value")" ;;
    esac
    case "$target" in
      "$app_real"/*) rel="${target#"$app_real"/}" ;;
      *) continue ;;
    esac
    rel="${rel%/}"
    [ -n "$rel" ] && UPDATE_EXCLUDES+=(--exclude="/${rel}")
  done
}

# KB used by <path> (0 when missing)
update_size_kb() {
  if [ -e "$1" ]; then du -sk "$1" 2>/dev/null | awk '{ print $1 }'; else echo 0; fi
}

# The nearest existing folder of <path> (a backup folder not made yet is checked on its parent's disk)
update_existing_dir() {
  local dir="$1"
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do dir="$(dirname "$dir")"; done
  echo "$dir"
}

# Free KB and the mount point of the disk of <path>; whether two paths are on one disk
update_disk_free_kb() { df -Pk "$(update_existing_dir "$1")" | awk 'NR == 2 { print $4 }'; }
update_disk_mount() { df -Pk "$(update_existing_dir "$1")" | awk 'NR == 2 { print $6 }'; }
update_same_disk() { [ "$(stat -c %d "$(update_existing_dir "$1")")" = "$(stat -c %d "$(update_existing_dir "$2")")" ]; }

# KB the pre-deployment backup will write: the newest earlier pre-deployment set (dump, manifest and archives),
# else the uploads folder plus 1 GB for the dump
update_backup_need_kb() {
  local app_dir="$1" backup_dir="$2" newest base total=0 f
  newest="$(ls -t "$backup_dir"/erp_pre-deployment_*.dump.gz 2>/dev/null | head -1 || true)"
  if [ -n "$newest" ]; then
    base="${newest%.dump.gz}"
    for f in "$base".* "$base"_*; do
      if [ -f "$f" ]; then total=$(( total + $(update_size_kb "$f") )); fi
    done
    echo "$total"
  else
    echo $(( $(update_size_kb "$app_dir/public/uploads") + 1048576 ))
  fi
}

# KB the upgrade rehearsal restores: twice the live database. The size is read with the application's own pg driver
# from <app-dir>, the URL passed in the environment (never on a command line; psql does not read a URL from
# PGDATABASE). When it cannot be read, ten times the newest pre-deployment dump stands in for it (a gzip dump is
# smaller than the database), else 0.
update_rehearsal_need_kb() {
  local app_dir="$1" url="$2" backup_dir="${3:-${BACKUP_DIR:-/var/backups/erp}}" bytes="" newest
  if [ -n "$url" ]; then
    bytes="$(cd "$app_dir" && UPDATE_DB_URL="$url" timeout 30 node -e '
      const { Client } = require("pg");
      const c = new Client({ connectionString: process.env.UPDATE_DB_URL });
      c.connect()
        .then(() => c.query("SELECT pg_database_size(current_database())::text AS b"))
        .then((r) => { process.stdout.write(String(r.rows[0].b)); return c.end(); })
        .catch(() => process.exit(1));' 2>/dev/null | tr -dc '0-9' || true)"
  fi
  if [ -z "$bytes" ]; then
    newest="$(ls -t "$backup_dir"/erp_pre-deployment_*.dump.gz 2>/dev/null | head -1 || true)"
    if [ -n "$newest" ]; then bytes=$(( $(update_size_kb "$newest") * 1024 * 10 )); fi
  fi
  echo $(( ${bytes:-0} * 2 / 1024 ))
}

# OBS-R1-22: free space the update needs before anything is touched. On the disk of <app-dir>: the side folder holds
# a copy of the source, a new node_modules and a new dist (estimated by the current ones; 1 GB of node_modules when
# there is none), a manual update keeps one more copy of the source, and UPDATE_SPACE_MARGIN_MB (default 1024) covers
# the npm cache and growth; a stale side folder is removed first, so it counts as free. With <backup>=1 the
# pre-deployment backup is counted on its own disk (BACKUP_DIR, default /var/backups/erp; added to the need when it
# is the same disk), and with <rehearse>=1 twice the database. With <after-source>=1 (the check after the backup and the
# pull or sync) the message says those are done. Sets UPDATE_SPACE_MESSAGE and returns 1 when short.
update_space_check() {
  local app_dir="$1" mode="$2" backup="${3:-0}" rehearse="${4:-0}" after_source="${5:-0}"
  local done_text="Nothing was changed"
  if [ "$after_source" = "1" ]; then
    done_text="The backup (when taken) and the new source are in place; the running build and the service are untouched"
  fi
  local source_kb modules_kb dist_kb need free backup_dir backup_kb backup_free
  UPDATE_SPACE_MESSAGE=""
  update_state_excludes "$app_dir"
  source_kb="$(rsync -an --stats --no-human-readable "${UPDATE_EXCLUDES[@]}" "$app_dir"/ /nonexistent-update-space-check/ 2>/dev/null \
    | awk -F: '/^Total file size/ { gsub(/[^0-9]/, "", $2); print int($2 / 1024) }')"
  source_kb="${source_kb:-0}"
  modules_kb=1048576
  if [ -d "$app_dir/node_modules" ]; then modules_kb="$(update_size_kb "$app_dir/node_modules/")"; fi
  dist_kb="$(update_size_kb "$app_dir/dist")"
  need=$(( source_kb + modules_kb + dist_kb + ${UPDATE_SPACE_MARGIN_MB:-1024} * 1024 ))
  if [ "$mode" = "manual" ]; then need=$(( need + source_kb )); fi
  free=$(( $(update_disk_free_kb "$app_dir") + $(update_size_kb "$app_dir/$UPDATE_BUILD_DIR_NAME") ))
  if [ "$rehearse" = "1" ]; then
    need=$(( need + $(update_rehearsal_need_kb "$app_dir" "$(update_env_value "$app_dir" DATABASE_URL)") ))
  fi
  if [ "$backup" = "1" ]; then
    backup_dir="${BACKUP_DIR:-/var/backups/erp}"
    backup_kb="$(update_backup_need_kb "$app_dir" "$backup_dir")"
    if update_same_disk "$app_dir" "$backup_dir"; then
      need=$(( need + backup_kb ))
    else
      backup_free="$(update_disk_free_kb "$backup_dir")"
      if [ "$backup_free" -lt "$backup_kb" ]; then
        UPDATE_SPACE_MESSAGE="Not enough free disk space for the pre-deployment backup: it needs about $(( backup_kb / 1024 )) MB in ${backup_dir} (disk mounted at $(update_disk_mount "$backup_dir")), $(( backup_free / 1024 )) MB is free. ${done_text}; free $(( (backup_kb - backup_free) / 1024 + 1 )) MB more on that disk (old backups) and run the update again."
        return 1
      fi
    fi
  fi
  UPDATE_SPACE_NEED_KB="$need"
  UPDATE_SPACE_FREE_KB="$free"
  if [ "$free" -lt "$need" ]; then
    UPDATE_SPACE_MESSAGE="Not enough free disk space for the update: it needs about $(( need / 1024 )) MB on the disk of ${app_dir} (mounted at $(update_disk_mount "$app_dir")), $(( free / 1024 )) MB is free. ${done_text}; free $(( (need - free) / 1024 + 1 )) MB more on that disk (old backups, logs) and run the update again."
    return 1
  fi
}

# OBS-R1-17: a new source inside <app-dir> would be removed by the --delete sync half way through
update_assert_source_outside() {
  local src_real app_real
  src_real="$(cd "$1" && pwd -P)"
  app_real="$(cd "$2" && pwd -P)"
  case "$src_real/" in
    "$app_real"/*) echo "The new source must be outside the application directory: $1" >&2; return 1 ;;
  esac
}

# OBS-R1-17: prints what the sync from <source-dir> will delete in <app-dir>: files the new source does not have
update_sync_deletions() {
  local source_dir="$1" app_dir="$2"
  update_state_excludes "$app_dir"
  rsync -an --checksum --delete --itemize-changes "${UPDATE_EXCLUDES[@]}" "$source_dir"/ "$app_dir"/ \
    | sed -n 's/^\*deleting  *//p'
}

# OBS-R1-17: keeps the current source of <app-dir> in <app-dir>/.previous-source (live state left out)
update_save_previous_source() {
  local app_dir="$1"
  update_state_excludes "$app_dir"
  mkdir -p "$app_dir/$UPDATE_PREVIOUS_SOURCE_NAME"
  rsync -a --checksum --delete "${UPDATE_EXCLUDES[@]}" "$app_dir"/ "$app_dir/$UPDATE_PREVIOUS_SOURCE_NAME"/
}

# OBS-R1-17: makes the source of <app-dir> equal to <source-dir>: changed files replaced, files the new source no
# longer has removed; live state is excluded, so it is neither copied nor deleted
update_sync_source() {
  local source_dir="$1" app_dir="$2"
  update_assert_source_outside "$source_dir" "$app_dir" || return 1
  update_state_excludes "$app_dir"
  rsync -a --checksum --delete "${UPDATE_EXCLUDES[@]}" "$source_dir"/ "$app_dir"/
}

# Puts <app-dir>/.previous-source back over <app-dir> (the source only; dist and node_modules are separate)
update_restore_source() {
  local app_dir="$1"
  [ -d "$app_dir/$UPDATE_PREVIOUS_SOURCE_NAME" ] || { echo "No previous source in $app_dir/$UPDATE_PREVIOUS_SOURCE_NAME" >&2; return 1; }
  update_state_excludes "$app_dir"
  rsync -a --checksum --delete "${UPDATE_EXCLUDES[@]}" "$app_dir/$UPDATE_PREVIOUS_SOURCE_NAME"/ "$app_dir"/
}

# OBS-R1-22: a fresh side folder with the source of <app-dir>; prints its path. Its .env is a link to the live one,
# for the upgrade rehearsal, which reads DATABASE_URL from there.
update_prepare_build_dir() {
  local app_dir="$1" build_dir="$1/$UPDATE_BUILD_DIR_NAME"
  rm -rf "$build_dir"
  mkdir -p "$build_dir"
  update_state_excludes "$app_dir"
  rsync -a "${UPDATE_EXCLUDES[@]}" "$app_dir"/ "$build_dir"/
  ln -s ../.env "$build_dir/.env"
  # the build reads .env.local, .env.production … as it did in place (Vite); linked, never copied
  local env_file
  for env_file in "$app_dir"/.env.*; do
    [ -f "$env_file" ] || continue
    [ -e "$build_dir/$(basename "$env_file")" ] || ln -s "../$(basename "$env_file")" "$build_dir/$(basename "$env_file")"
  done
  echo "$build_dir"
}

# A fingerprint of the source in <dir> (the side folder before the install: its files, the env links left out). The
# .env and .env.* files are not part of it: a build reads no VITE_ variable today, so a changed .env needs no rebuild;
# if one ever does, run the update with --rebuild after changing it.
update_source_fingerprint() {
  (cd "$1" && find . -path ./node_modules -prune -o -path ./dist -prune -o -type f -print0 | LC_ALL=C sort -z \
    | xargs -0 -r sha256sum | sha256sum | cut -d' ' -f1)
}

# The fingerprint and the commit a built dist/ records (a build before v10.2.23: the commit of its build-info.json)
update_dist_fingerprint() { cat "$1/$UPDATE_FINGERPRINT_NAME" 2>/dev/null || true; }
update_dist_commit() {
  local commit
  commit="$(cat "$1/$UPDATE_COMMIT_NAME" 2>/dev/null || true)"
  if [ -z "$commit" ] && [ -f "$1/build-info.json" ]; then
    commit="$(sed -n 's/.*"gitCommit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1/build-info.json" | head -1)"
  fi
  echo "${commit:-unknown}"
}

# OBS-R1-22: moves the built dist/ and node_modules/ of the side folder into <app-dir>, keeping the running ones as
# dist.prev/ and node_modules.prev/; a lock file the install regenerated goes back to <app-dir>. The older .prev
# folders are first renamed into the side folder (one atomic rename each) and deleted there, before the marker is
# written, so a kill during that slow delete never leaves a half-deleted .prev for the repair to move in, and the
# repair never brings back a build older than the running one. HUP, INT and TERM (a dropped SSH session) are ignored
# while the renames run, and the marker stays until they all succeeded, so a swap cut short (a kill, a power loss) is
# found by the next run and repaired by update_restore_build_command.
update_swap_build() {
  local app_dir="$1" build_dir="$1/$UPDATE_BUILD_DIR_NAME" rc=0
  [ -f "$build_dir/dist/server.cjs" ] && [ -d "$build_dir/node_modules" ] \
    || { echo "The side folder holds no complete build: $build_dir" >&2; return 1; }
  # v10.2.26 (#339 review N-A): the caller's own signal traps come back after the swap
  local saved_traps
  saved_traps="$(trap -p HUP INT TERM)"
  trap '' HUP INT TERM
  { rm -rf "${build_dir:?}/.old-dist" "${build_dir:?}/.old-node_modules" \
    && { [ ! -e "$app_dir/dist.prev" ] || mv "$app_dir/dist.prev" "$build_dir/.old-dist"; } \
    && { { [ ! -e "$app_dir/node_modules.prev" ] && [ ! -L "$app_dir/node_modules.prev" ]; } || mv "$app_dir/node_modules.prev" "$build_dir/.old-node_modules"; } \
    && rm -rf "${build_dir:?}/.old-dist" "${build_dir:?}/.old-node_modules" \
    && : > "${app_dir:?}/${UPDATE_SWAP_MARKER_NAME:?}" \
    && { [ ! -e "$app_dir/dist" ] || mv "$app_dir/dist" "$app_dir/dist.prev"; } \
    && { { [ ! -e "$app_dir/node_modules" ] && [ ! -L "$app_dir/node_modules" ]; } || mv "$app_dir/node_modules" "$app_dir/node_modules.prev"; } \
    && mv "$build_dir/dist" "$app_dir/dist" \
    && mv "$build_dir/node_modules" "$app_dir/node_modules" \
    && rm -f "${app_dir:?}/${UPDATE_SWAP_MARKER_NAME:?}"; } || rc=1
  trap - HUP INT TERM
  eval "$saved_traps"
  [ "$rc" -eq 0 ] || return 1
  if [ -f "$build_dir/package-lock.json" ] && ! cmp -s "$build_dir/package-lock.json" "$app_dir/package-lock.json"; then
    cp "$build_dir/package-lock.json" "$app_dir/package-lock.json"
  fi
}

# The rollback command of the build swap, run in <app-dir>: each folder comes back only when its .prev exists, so it
# also repairs a swap that stopped half way and never deletes the only node_modules
update_restore_build_command() {
  echo "{ [ ! -d dist.prev ] || { rm -rf dist && mv dist.prev dist; }; } && { [ ! -d node_modules.prev ] || { rm -rf node_modules && mv node_modules.prev node_modules; }; } && rm -f ${UPDATE_SWAP_MARKER_NAME}"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  case "${1:-}" in
    restore-source)
      [ -n "${2:-}" ] || { echo "Usage: bash scripts/update-steps.sh restore-source <app-dir>" >&2; exit 2; }
      update_restore_source "$2"
      echo "The previous source was put back in $2"
      ;;
    *) echo "Usage: bash scripts/update-steps.sh restore-source <app-dir>" >&2; exit 2 ;;
  esac
fi
