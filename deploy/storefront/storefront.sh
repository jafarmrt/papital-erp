#!/usr/bin/env bash
# ============================================================
#  Papital storefront (papitalgallery.com) — install, update, roll back and package (v11 phase 8.6)
#
#  The site is a second service next to the ERP: its own systemd unit (papital-storefront), its own settings file
#  (/etc/papital-storefront/storefront.env, root only) and its own releases. It never touches the ERP's service,
#  .env, database, backups or monitor.
#
#  Usage (as root):
#    bash storefront.sh install  [--bundle FILE]   first install: settings file, unit, first release, start
#    bash storefront.sh update   [--bundle FILE]   build a new release (or unpack a bundle), switch, check, keep 3
#    bash storefront.sh rollback                   go back to the release before the current one
#    bash storefront.sh status                     the current release, the service and both probes
#    bash storefront.sh package  [--with-node] [--out DIR]
#                                                  build a release into a .tar.gz for a server without the
#                                                  repository or npm (for example a server in Iran)
#
#  A release is built from the repository at SOURCE_DIR (default /opt/papital-erp, the ERP's own checkout, so run
#  the ERP's update.sh first and this script after it), or comes from a bundle made by «package».
#
#  Environment: SOURCE_DIR, SITE_ROOT (default /opt/papital-storefront), ENV_FILE (default
#  /etc/papital-storefront/storefront.env), NODE_BIN (default: the release's own bin/node, else `node` on PATH),
#  KEEP_RELEASES (default 3), HEALTH_TIMEOUT (seconds, default 60).
#  On the first install only, STOREFRONT_API_URL, STOREFRONT_API_KEY, STOREFRONT_SITE_URL and STOREFRONT_NOINDEX given
#  in the environment are written into the new settings file (prefer editing the file: a key on the command line stays
#  in the shell history).
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-/opt/papital-erp}"
SITE_ROOT="${SITE_ROOT:-/opt/papital-storefront}"
ENV_FILE="${ENV_FILE:-/etc/papital-storefront/storefront.env}"
SERVICE_NAME="papital-storefront"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
RELEASES="${SITE_ROOT}/releases"
CURRENT="${SITE_ROOT}/current"
MIN_NODE_MAJOR=22
WORK_DIR=""
cleanup() { if [ -n "$WORK_DIR" ]; then rm -rf "$WORK_DIR"; fi; }
trap cleanup EXIT

# every message goes to stderr: stdout carries only the values functions return
log()     { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2; }
success() { log "OK: $*"; }
warn()    { log "WARN: $*"; }
die()     { log "ERROR: $*"; exit 1; }

usage() { sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

need_root() { [ "$(id -u)" -eq 0 ] || die "Please run as root (sudo)."; }

# The value of one key of the settings file as systemd reads it (KEY=value, optional quotes; the last line wins)
env_value() {
  local key="$1" file="${2:-$ENV_FILE}"
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$file" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

site_port() { local p; p="$(env_value STOREFRONT_PORT)"; echo "${p:-3100}"; }

node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# The node the service runs: NODE_BIN, else the release's own bin/node (a bundle made with --with-node), else PATH
node_for() {
  local release="$1" candidate
  if [ -n "${NODE_BIN:-}" ]; then candidate="$NODE_BIN"
  elif [ -x "${release}/bin/node" ]; then candidate="${release}/bin/node"
  else candidate="$(command -v node || true)"
  fi
  [ -n "$candidate" ] && [ -x "$candidate" ] || die "Node.js was not found. Install Node.js ${MIN_NODE_MAJOR}+ (the runbook says how on a server in Iran) or set NODE_BIN."
  [ "$(node_major "$candidate")" -ge "$MIN_NODE_MAJOR" ] || die "$candidate is Node $(node_major "$candidate"); the site needs ${MIN_NODE_MAJOR}+."
  echo "$candidate"
}

release_ok() {
  local dir="$1" f
  for f in server.mjs package.json build/server/index.js build/client node_modules/express node_modules/react-router; do
    [ -e "${dir}/${f}" ] || { log "missing in the release: ${f}"; return 1; }
  done
}

# ---------- building a release ----------
# The app reads the ERP's contracts from src/lib (the @erp alias), so a release is built from a copy of storefront/
# and src/lib; the ERP checkout itself is never written to.
build_release() {
  local dest="$1"
  [ -f "${SOURCE_DIR}/storefront/package-lock.json" ] && [ -d "${SOURCE_DIR}/src/lib/storefront" ] \
    || die "${SOURCE_DIR} has no storefront/ and src/lib/storefront: set SOURCE_DIR to the papital-erp checkout, or use --bundle."
  command -v npm >/dev/null 2>&1 || die "npm was not found; building a release needs Node.js with npm (or use --bundle)."
  local build_node; build_node="$(node_for "$SOURCE_DIR")"
  WORK_DIR="$(mktemp -d "${SITE_ROOT}/.build.XXXXXX")"
  local work="$WORK_DIR"
  log "Copying the storefront source to ${work} ..."
  mkdir -p "${work}/storefront" "${work}/src"
  (cd "${SOURCE_DIR}/storefront" && tar --exclude=./node_modules --exclude=./build --exclude=./.react-router -cf - .) | tar -xf - -C "${work}/storefront"
  cp -a "${SOURCE_DIR}/src/lib" "${work}/src/lib"
  log "Installing packages (npm ci) and building (react-router build) with node $("$build_node" -v) ..."
  (cd "${work}/storefront" && npm ci --no-audit --no-fund --loglevel=error && npx --no-install react-router build) \
    || die "The storefront build failed; nothing was changed."
  log "Keeping only the packages the server needs (npm prune --omit=dev) ..."
  (cd "${work}/storefront" && npm prune --omit=dev --no-audit --no-fund --loglevel=error) || die "npm prune failed; nothing was changed."
  mkdir -p "$dest"
  cp -a "${work}/storefront/build" "${work}/storefront/node_modules" "${work}/storefront/server.mjs" \
    "${work}/storefront/package.json" "${work}/storefront/package-lock.json" "$dest/"
  rm -rf "$work"
  WORK_DIR=""
  # the deploy files travel with every release, so a bundle carries what a server without the repository needs
  mkdir -p "${dest}/deploy"
  cp -a "${SCRIPT_DIR}/." "${dest}/deploy/"
  {
    echo "built_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "erp_version=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "${SOURCE_DIR}/package.json" | head -n 1)"
    echo "commit=$(git -C "$SOURCE_DIR" rev-parse --short=10 HEAD 2>/dev/null || echo unknown)"
  } > "${dest}/RELEASE"
}

new_release_name() {
  echo "$(date -u '+%Y%m%d-%H%M%S')-$(git -C "$SOURCE_DIR" rev-parse --short=10 HEAD 2>/dev/null || echo nogit)"
}

unpack_bundle() {
  local bundle="$1" dest="$2"
  [ -f "$bundle" ] || die "Bundle not found: $bundle"
  mkdir -p "$dest"
  tar -xzf "$bundle" -C "$dest" --no-same-owner || die "Could not unpack $bundle"
}

# ---------- the service ----------
write_unit() {
  local node="$1"
  # node is the release's own when it brought one: then the unit names it through the current link
  case "$node" in "${RELEASES}"/*/bin/node) node="${CURRENT}/bin/node" ;; esac
  cat > "${UNIT_FILE}.new" <<UNIT
[Unit]
Description=Papital storefront (papitalgallery.com, Node.js)
Documentation=file://${CURRENT}/deploy/RUNBOOK_FA.md
After=network-online.target papital-erp.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${CURRENT}
# read by systemd before the start: the service itself never reads or changes the settings file
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
ExecStart=${node} ${CURRENT}/server.mjs
Restart=always
RestartSec=3
# its own throwaway user every start, nothing on disk it can write, no way to gain rights
DynamicUser=yes
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictNamespaces=true
RestrictRealtime=true
LockPersonality=true
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native
# the site shares the server with the ERP: it may never take the ERP's memory
MemoryMax=1G

[Install]
WantedBy=multi-user.target
UNIT
  if ! cmp -s "${UNIT_FILE}.new" "$UNIT_FILE" 2>/dev/null; then
    mv "${UNIT_FILE}.new" "$UNIT_FILE"
    systemctl daemon-reload
    log "systemd unit written: $UNIT_FILE"
  else
    rm -f "${UNIT_FILE}.new"
  fi
}

wait_healthy() {
  local port; port="$(site_port)"
  local tries=$(( HEALTH_TIMEOUT / 2 )) i
  for i in $(seq 1 "$tries"); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then return 0; fi
    if [ "$i" -lt "$tries" ]; then sleep 2; fi
  done
  return 1
}

# The home page needs the ERP: 200 means the key and the ERP answer. Never fatal (the ERP may be updating).
report_erp_link() {
  local port code; port="$(site_port)"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/" || true)"
  case "$code" in
    200) success "The home page answers 200: the site reads the ERP." ;;
    *) warn "The home page answers ${code:-nothing}. The site runs but cannot read the ERP (STOREFRONT_API_URL or STOREFRONT_API_KEY in ${ENV_FILE}, the site switch in the ERP's storefront settings, or the ERP is down). See: journalctl -u ${SERVICE_NAME} -n 50" ;;
  esac
}

api_key_set() { [ -n "$(env_value STOREFRONT_API_KEY)" ]; }

switch_to() {
  local target="$1"
  ln -sfn "$target" "${SITE_ROOT}/.current.new"
  mv -T "${SITE_ROOT}/.current.new" "$CURRENT"
}

prune_releases() {
  local keep="$KEEP_RELEASES" live old
  live="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  # oldest first; the live release is never removed
  mapfile -t old < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | head -n "-${keep}")
  for r in "${old[@]}"; do
    [ "${RELEASES}/${r}" = "$live" ] && continue
    rm -rf "${RELEASES:?}/${r}"
    log "Removed an old release: $r"
  done
}

# Put a release live: unit, link, restart, probe; back to the previous release when the probe fails
activate() {
  local release="$1" previous node
  previous="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  release_ok "$release" || { rm -rf "$release"; die "The new release is incomplete; nothing was changed."; }
  node="$(node_for "$release")"
  switch_to "$release"
  write_unit "$node"
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
  if ! api_key_set; then
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    warn "STOREFRONT_API_KEY is empty in ${ENV_FILE}: the release is in place but the service is not started."
    warn "Make the site app key in the ERP (storefront settings, site app key card; RUNBOOK_FA.md step 2), write it into ${ENV_FILE}, then: systemctl restart ${SERVICE_NAME}"
    return 0
  fi
  systemctl restart "$SERVICE_NAME"
  if wait_healthy; then
    success "Release $(basename "$release") is live on 127.0.0.1:$(site_port)."
    report_erp_link
    return 0
  fi
  warn "The new release did not answer /healthz within ${HEALTH_TIMEOUT}s."
  journalctl -u "$SERVICE_NAME" -n 30 --no-pager 2>/dev/null || true
  if [ -n "$previous" ] && [ -d "$previous" ] && [ "$previous" != "$release" ]; then
    log "Going back to $(basename "$previous") ..."
    switch_to "$previous"
    node="$(node_for "$previous")"
    write_unit "$node"
    systemctl restart "$SERVICE_NAME"
    if wait_healthy; then warn "Back on $(basename "$previous"); the failed release stays in ${RELEASES} for a look."; else warn "The previous release does not answer either."; fi
  fi
  die "Update failed."
}

make_release() {
  local bundle="$1" dest
  mkdir -p "$RELEASES"
  if [ -n "$bundle" ]; then
    local unpack commit
    unpack="$(mktemp -d "${RELEASES}/.unpack.XXXXXX")"
    WORK_DIR="$unpack"
    log "Unpacking bundle $bundle ..."
    unpack_bundle "$bundle" "$unpack"
    commit="$(sed -n 's/^commit=//p' "${unpack}/RELEASE" 2>/dev/null | head -n 1)"
    dest="${RELEASES}/$(date -u '+%Y%m%d-%H%M%S')-${commit:-bundle}"
    # names sort by time; two releases in one second wait for the next one
    while [ -e "$dest" ]; do sleep 1; dest="${RELEASES}/$(date -u '+%Y%m%d-%H%M%S')-${commit:-bundle}"; done
    mv -T "$unpack" "$dest"
    WORK_DIR=""
  else
    dest="${RELEASES}/$(new_release_name)"
    while [ -e "$dest" ]; do sleep 1; dest="${RELEASES}/$(new_release_name)"; done
    log "Building a release from ${SOURCE_DIR} into ${dest} ..."
    # npm and the build print to stdout; only the release folder may reach the caller's stdout
    build_release "$dest" >&2
  fi
  # code and packages are root's; the service only reads them
  chown -R root:root "$dest"
  chmod -R go-w "$dest"
  echo "$dest"
}

# ---------- commands ----------
cmd_install() {
  local bundle="$1"
  need_root
  command -v systemctl >/dev/null 2>&1 || die "systemd is required."
  command -v curl >/dev/null 2>&1 || die "curl is required (apt-get install -y curl)."
  if [ -L "$CURRENT" ] && [ -f "$UNIT_FILE" ]; then
    die "The storefront is already installed (${CURRENT}). Use: bash $0 update"
  fi
  install -d -m 755 "$SITE_ROOT" "$RELEASES"
  install -d -m 700 "$(dirname "$ENV_FILE")"
  if [ ! -f "$ENV_FILE" ]; then
    ( umask 077; cp "${SCRIPT_DIR}/storefront.env.example" "$ENV_FILE" )
    local key
    for key in STOREFRONT_API_URL STOREFRONT_API_KEY STOREFRONT_SITE_URL STOREFRONT_NOINDEX; do
      if [ -n "${!key:-}" ]; then
        local tmp; tmp="$(mktemp "$(dirname "$ENV_FILE")/.env.XXXXXX")"
        awk -v k="$key" -v v="${!key}" 'BEGIN { done = 0 } $0 ~ "^" k "=" { print k "=" v; done = 1; next } { print } END { if (!done) print k "=" v }' "$ENV_FILE" > "$tmp"
        mv "$tmp" "$ENV_FILE"
      fi
    done
    success "Settings file made: ${ENV_FILE} (root only)."
  else
    log "Settings file kept: ${ENV_FILE}"
  fi
  chown root:root "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  local release; release="$(make_release "$bundle")"
  activate "$release"
  log "=============================== STOREFRONT INSTALLED ==============================="
  log "  Service  : systemctl status ${SERVICE_NAME}   |   logs: journalctl -u ${SERVICE_NAME} -f"
  log "  Settings : ${ENV_FILE}   (after a change: systemctl restart ${SERVICE_NAME})"
  log "  Local    : http://127.0.0.1:$(site_port)/healthz"
  log "  Next     : bash ${CURRENT}/deploy/storefront-nginx.sh   (nginx, the domain and https)"
  log "===================================================================================="
}

cmd_update() {
  local bundle="$1"
  need_root
  [ -f "$UNIT_FILE" ] || die "The storefront is not installed yet. Use: bash $0 install"
  local release; release="$(make_release "$bundle")"
  activate "$release"
  prune_releases
}

cmd_rollback() {
  need_root
  local live previous
  live="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  [ -n "$live" ] || die "No current release."
  previous="$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | awk -v live="$(basename "$live")" '$0 < live' | tail -n 1)"
  [ -n "$previous" ] || die "No release older than $(basename "$live") to go back to."
  log "Rolling back from $(basename "$live") to ${previous} ..."
  # activate goes back to $live if the older release does not start
  activate "${RELEASES}/${previous}"
}

cmd_status() {
  local live port
  live="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  port="$(site_port)"
  echo "Release  : ${live:-none}"
  [ -n "$live" ] && [ -f "${live}/RELEASE" ] && sed 's/^/           /' "${live}/RELEASE"
  echo "Releases : $(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f ' 2>/dev/null | tr ' ' '\n' | sort | tr '\n' ' ')"
  echo "Service  : $(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
  echo "Settings : ${ENV_FILE} (API key $(api_key_set && echo set || echo EMPTY), site $(env_value STOREFRONT_SITE_URL), noindex $(env_value STOREFRONT_NOINDEX))"
  echo "Liveness : $(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:${port}/healthz" || true) (GET /healthz)"
  echo "ERP link : $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/" || true) (GET /, 200 = the site reads the ERP)"
}

cmd_package() {
  local with_node="$1" out="$2" name dest file
  mkdir -p "$out"
  out="$(cd "$out" && pwd)"
  local saved_root="$SITE_ROOT"
  SITE_ROOT="$(mktemp -d)"
  name="$(new_release_name)"
  dest="${SITE_ROOT}/papital-storefront-${name}"
  build_release "$dest" >&2
  if [ "$with_node" = 1 ]; then
    local node; node="$(node_for "$SOURCE_DIR")"
    mkdir -p "${dest}/bin"
    cp "$(readlink -f "$node")" "${dest}/bin/node"
    log "Node $("$node" -v) copied into the bundle (bin/node). It needs a Linux of the same family (glibc) as this server."
  fi
  file="${out}/papital-storefront-${name}.tar.gz"
  tar -czf "$file" -C "$dest" .
  rm -rf "$SITE_ROOT"
  SITE_ROOT="$saved_root"
  success "Bundle: ${file} ($(du -h "$file" | cut -f1))"
  log "On the other server: mkdir -p /tmp/sf && tar -xzf $(basename "$file") -C /tmp/sf && sudo bash /tmp/sf/deploy/storefront.sh install --bundle $(basename "$file")"
}

main() {
  local cmd="${1:-}" bundle="" with_node=0 out="."
  [ $# -gt 0 ] && shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --bundle) [ $# -ge 2 ] || die "--bundle needs a file"; bundle="$(readlink -f "$2")"; shift 2 ;;
      --with-node) with_node=1; shift ;;
      --out) [ $# -ge 2 ] || die "--out needs a folder"; out="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1 (see: bash $0 --help)" ;;
    esac
  done
  case "$cmd" in
    install) cmd_install "$bundle" ;;
    update) cmd_update "$bundle" ;;
    rollback) cmd_rollback ;;
    status) cmd_status ;;
    package) cmd_package "$with_node" "$out" ;;
    -h|--help|help|'') usage ;;
    *) die "Unknown command: $cmd (see: bash $0 --help)" ;;
  esac
}

main "$@"
