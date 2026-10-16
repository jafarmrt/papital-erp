#!/bin/bash
# OT-B-04: installs node_modules with `npm ci` only when they are missing or the dependencies of
# package-lock.json changed. The decision is a hash of package-lock.json without the root package's own
# version (every release bumps it), stored in node_modules/.papital-lock-hash, never the file's mtime: a
# resumed or compacted session no longer reinstalls node_modules under a test that is running.
# Without a stored hash (the first run after this change) the old mtime rule decides once.
#   bash .claude/hooks/ensure-node-modules.sh [project-dir]
set -euo pipefail

cd "${1:-.}"
HASH_FILE=node_modules/.papital-lock-hash

lock_hash() {
  node -e '
    const fs = require("fs");
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    delete lock.version;
    if (lock.packages && lock.packages[""]) delete lock.packages[""].version;
    process.stdout.write(require("crypto").createHash("sha256").update(JSON.stringify(lock)).digest("hex"));
  '
}

WANT="$(lock_hash)"
NEED_CI=0
if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then
  NEED_CI=1
elif [ -f "$HASH_FILE" ]; then
  [ "$(cat "$HASH_FILE")" = "$WANT" ] || NEED_CI=1
elif [ package-lock.json -nt node_modules/.package-lock.json ]; then
  NEED_CI=1
fi

if [ "$NEED_CI" -eq 1 ]; then
  echo "[session-start] npm ci (node_modules missing or the dependencies of package-lock.json changed)"
  npm ci --no-audit --no-fund
else
  echo "[session-start] node_modules matches the dependencies of package-lock.json"
fi
printf '%s\n' "$WANT" > "$HASH_FILE"
