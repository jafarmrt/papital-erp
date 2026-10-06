#!/usr/bin/env bash
# TD-472 (B01-03): releases from v9.0.25 on tracked a `node_modules` symlink (git mode 120000).
# On a server, `git pull` replaced the real dependency directory with that broken link, and `npm ci` rebuilt it,
# leaving the work tree permanently modified. The release that removes the link from the repository can then not
# be pulled ("local changes would be overwritten"). This script drops such an index entry (never the directory
# itself) so that `git pull --ff-only` succeeds. It is a no-op on any other checkout.
# Usage: bash scripts/untrack-node-modules-link.sh [repo-dir]   (update.sh runs it before pulling)
set -euo pipefail
cd "${1:-.}"
mode="$(git ls-files -s -- node_modules | awk 'NR == 1 { print $1 }')"
if [ "$mode" = "120000" ]; then
  echo "Tracked node_modules symlink found in the git index - untracking it (the directory is kept)."
  git rm -q --cached -- node_modules
fi
