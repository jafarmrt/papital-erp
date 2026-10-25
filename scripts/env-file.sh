#!/usr/bin/env bash
# scripts/env-file.sh — v11 (phase 3.3, O5): the one reader of the application's .env for every shell script.
#
# Sourced by update.sh, scripts/update-steps.sh, backup.sh, restore.sh, monitor.sh, nightly-verify.sh, go-live-verify.sh,
# the off-server copy scripts, setup-domain.sh and install.sh. Each script used to read .env with its own
# `grep "^KEY=" | head -1`, which differs from the service (`node --env-file`): the service lets a later line win, reads
# `export KEY=` and indented lines and drops an inline ` # comment`; the scripts took the first line literally. A
# duplicate PORT or a commented BACKUP_DIR then sent the startup check to the wrong port or the backup to a folder named
# «x # note».
#
# env_file_get <file> <key> prints the value the service reads. It asks Node's own parser (util.parseEnv, the parser
# behind --env-file) whenever a node that has it is found (cron gives a short PATH, so /usr/bin and /usr/local/bin are
# tried too); without one it falls back to env_file_get_plain, which follows the same rules for the lines an .env
# holds in practice (one value per line). Nothing is ever run as shell code. A missing file or key prints nothing.

env_file_node() {
  local candidate
  for candidate in "$(command -v node 2>/dev/null || true)" /usr/bin/node /usr/local/bin/node; do
    [ -n "$candidate" ] && [ -x "$candidate" ] && { echo "$candidate"; return 0; }
  done
  return 1
}

# The fallback reader: comment and blank lines skipped, «export » and leading spaces dropped, spaces around the key
# and the value trimmed, a value in matching "…", '…' or `…` quotes taken between them (\n inside "…" is a new line),
# an unquoted value cut at its first #, and the last line of a key wins.
env_file_get_plain() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  awk -v want="$key" '
    {
      sub(/\r$/, "")
      line = $0
      sub(/^[ \t]+/, "", line)
      if (line == "" || substr(line, 1, 1) == "#") next
      if (line ~ /^export[ \t]+/) sub(/^export[ \t]+/, "", line)
      eq = index(line, "=")
      if (eq == 0) next
      k = substr(line, 1, eq - 1)
      sub(/[ \t]+$/, "", k)
      if (k != want) next
      v = substr(line, eq + 1)
      sub(/^[ \t]+/, "", v)
      q = substr(v, 1, 1)
      if ((q == "\"" || q == "\047" || q == "`") && index(substr(v, 2), q) > 0) {
        v = substr(v, 2, index(substr(v, 2), q) - 1)
        if (q == "\"") gsub(/\\n/, "\n", v)
      } else {
        h = index(v, "#")
        if (h > 0) v = substr(v, 1, h - 1)
        sub(/[ \t]+$/, "", v)
      }
      found = 1
      value = v
    }
    END { if (found) printf "%s", value }
  ' "$file"
}

env_file_get() {
  local file="$1" key="$2" node value
  [ -f "$file" ] || return 0
  if [ -z "${ENV_FILE_PLAIN:-}" ] && node="$(env_file_node)" \
    && value="$(ENV_FILE_PATH="$file" ENV_FILE_KEY="$key" "$node" -e '
      const util = require("util");
      if (typeof util.parseEnv !== "function") process.exit(3);
      const parsed = util.parseEnv(require("fs").readFileSync(process.env.ENV_FILE_PATH, "utf8"));
      const v = parsed[process.env.ENV_FILE_KEY];
      process.stdout.write(v === undefined ? "" : String(v));' 2>/dev/null)"; then
    printf '%s' "$value"
    return 0
  fi
  env_file_get_plain "$file" "$key"
}
