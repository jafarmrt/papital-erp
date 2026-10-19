#!/usr/bin/env bash
# scripts/update-steps.sh — v10.2.19 (OBS-R1-22 / OBS-R1-17, 10.2 package 13): the build and source steps of update.sh.
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
    --exclude='*.zip'
  )
  # folders .env moved inside the application directory hold live state too
  for key in MEDIA_DIR ATTACHMENTS_DIR LOG_DIR BACKUP_DIR; do
    value="$(update_env_value "$app_dir" "$key")"
    [ -n "$value" ] || continue
    case "$value" in
      "$app_dir"/*) rel="${value#"$app_dir"/}" ;;
      /*) continue ;;
      *) rel="${value#./}" ;;
    esac
    rel="${rel%/}"
    [ -n "$rel" ] && UPDATE_EXCLUDES+=(--exclude="/${rel}")
  done
}

# OBS-R1-22: free space the update needs on the disk of <app-dir>, in KB, before anything is touched: the side folder
# holds a copy of the source, a new node_modules and a new dist (estimated by the current ones; 1 GB of node_modules
# when there is none), a manual update keeps one more copy of the source, and UPDATE_SPACE_MARGIN_MB (default 1024)
# covers the npm cache and growth. Sets UPDATE_SPACE_NEED_KB / UPDATE_SPACE_FREE_KB; returns 1 when free < need.
update_space_check() {
  local app_dir="$1" mode="$2" source_kb modules_kb dist_kb margin_kb
  update_state_excludes "$app_dir"
  source_kb="$(rsync -an --stats --no-human-readable "${UPDATE_EXCLUDES[@]}" "$app_dir"/ /nonexistent-update-space-check/ 2>/dev/null \
    | awk -F: '/^Total file size/ { gsub(/[^0-9]/, "", $2); print int($2 / 1024) }')"
  source_kb="${source_kb:-0}"
  if [ -d "$app_dir/node_modules" ]; then
    modules_kb="$(du -sk "$app_dir/node_modules/" 2>/dev/null | awk '{ print $1 }')"
  fi
  modules_kb="${modules_kb:-1048576}"
  dist_kb=0
  if [ -d "$app_dir/dist" ]; then dist_kb="$(du -sk "$app_dir/dist" 2>/dev/null | awk '{ print $1 }')"; fi
  margin_kb=$(( ${UPDATE_SPACE_MARGIN_MB:-1024} * 1024 ))
  UPDATE_SPACE_NEED_KB=$(( source_kb + modules_kb + ${dist_kb:-0} + margin_kb ))
  if [ "$mode" = "manual" ]; then UPDATE_SPACE_NEED_KB=$(( UPDATE_SPACE_NEED_KB + source_kb )); fi
  UPDATE_SPACE_FREE_KB="$(df -Pk "$app_dir" | awk 'NR == 2 { print $4 }')"
  [ "${UPDATE_SPACE_FREE_KB:-0}" -ge "$UPDATE_SPACE_NEED_KB" ]
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
  local source_dir="$1" app_dir="$2" src_real app_real
  src_real="$(cd "$source_dir" && pwd -P)"
  app_real="$(cd "$app_dir" && pwd -P)"
  case "$src_real/" in
    "$app_real"/*) echo "The new source must be outside the application directory: $source_dir" >&2; return 1 ;;
  esac
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
  echo "$build_dir"
}

# OBS-R1-22: moves the built dist/ and node_modules/ of the side folder into <app-dir>, keeping the running ones as
# dist.prev/ and node_modules.prev/; a lock file the install regenerated goes back to <app-dir>
update_swap_build() {
  local app_dir="$1" build_dir="$1/$UPDATE_BUILD_DIR_NAME"
  [ -f "$build_dir/dist/server.cjs" ] && [ -d "$build_dir/node_modules" ] \
    || { echo "The side folder holds no complete build: $build_dir" >&2; return 1; }
  rm -rf "$app_dir/dist.prev" "$app_dir/node_modules.prev"
  if [ -e "$app_dir/dist" ]; then mv "$app_dir/dist" "$app_dir/dist.prev"; fi
  if [ -e "$app_dir/node_modules" ] || [ -L "$app_dir/node_modules" ]; then mv "$app_dir/node_modules" "$app_dir/node_modules.prev"; fi
  mv "$build_dir/dist" "$app_dir/dist"
  mv "$build_dir/node_modules" "$app_dir/node_modules"
  if [ -f "$build_dir/package-lock.json" ] && ! cmp -s "$build_dir/package-lock.json" "$app_dir/package-lock.json"; then
    cp "$build_dir/package-lock.json" "$app_dir/package-lock.json"
  fi
}

# The rollback command of the build swap
update_restore_build_command() {
  echo "rm -rf dist node_modules && mv dist.prev dist && mv node_modules.prev node_modules"
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
