#!/bin/bash
# scripts/verify-startup.sh — v8.0.83 (TD-365): was the update really started?
#
# The server binds its port at once and runs migrations and seeding in the background (AGENTS.md §8), so
# /health/live answers 200 even while migrations are running — or right before they fail and the process exits.
# Only /health/startup (200 after migrations, seed and engines are ready) proves the new version is up. This script
# waits for it, then checks that the running version is the one just built.
#
# Usage: scripts/verify-startup.sh [port] [timeout-seconds] [expected-version]
#   exit 0 → /health/startup answered 200 (and /health reports expected-version, when given)
#   exit 1 → not started within the timeout, or another version is running
set -uo pipefail

PORT="${1:-${APP_PORT:-3000}}"
TIMEOUT="${2:-${STARTUP_TIMEOUT:-600}}"
EXPECTED="${3:-}"
INTERVAL="${STARTUP_POLL_INTERVAL:-2}"
BASE="http://localhost:${PORT}"

deadline=$(( $(date +%s) + TIMEOUT ))
started=0
while :; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/health/startup" || true)"
  if [ "$code" = "200" ]; then started=1; break; fi
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep "$INTERVAL"
done

if [ "$started" -ne 1 ]; then
  echo "Startup NOT completed within ${TIMEOUT}s (/health/startup last answered ${code:-nothing}): migrations or seeding are still running or failed."
  exit 1
fi

if [ -n "$EXPECTED" ]; then
  running="$(curl -fsS --max-time 5 "$BASE/health" | grep -oE '"version":"[^"]+"' | head -1 | cut -d'"' -f4 || true)"
  if [ "$running" != "$EXPECTED" ]; then
    echo "Startup completed, but the running version is v${running:-unknown}, not the freshly built v${EXPECTED}."
    exit 1
  fi
fi
echo "Startup completed${EXPECTED:+ (v$EXPECTED)}."
exit 0
