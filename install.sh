#!/usr/bin/env bash
# ============================================================
#  Papital ERP — Linux Installer (Ubuntu/Debian)
#  Installs dependencies, clones the repo, generates .env,
#  builds the app and registers a systemd service.
#  Migrations run automatically at startup (NEVER db:push).
# ============================================================
set -euo pipefail

LOG_FILE="install-$(date +%Y%m%d-%H%M%S).log"
( umask 077; : >> "$LOG_FILE" )
exec > >(tee -a "$LOG_FILE") 2>&1

log()      { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
success()  { log "OK: $*"; }
warn()     { log "WARN: $*"; }
die()      { log "ERROR: $*"; exit 1; }

APP_DIR="${APP_DIR:-/opt/papital-erp}"
SERVICE_NAME="papital-erp"
APP_PORT="${APP_PORT:-3000}"
REPO_URL="${REPO_URL:-}"

log "=== Papital ERP Installer — log file: $LOG_FILE ==="

# ---------- 0) Privileges ----------
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
    log "Running as non-root; using sudo."
  else
    die "Run as root or install sudo first."
  fi
else
  # Root: still use sudo (it always exists for the postgres -u steps and works as root).
  # Fallback to empty SUDO only if sudo is somehow missing.
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    SUDO=""
  fi
  log "Running as root."
fi

# ---------- 1) Source mode: git clone OR current directory (uploaded zip) ----------
# If the script is run from a directory that already contains package.json (e.g. extracted
# from papital-erp-source-vX.zip), installation continues from the current directory
# and no git clone is performed.
LOCAL_MODE=0
if [ -f "$(pwd)/package.json" ] && [ -f "$(pwd)/server.ts" ]; then
  LOCAL_MODE=1
  APP_DIR="$(pwd)"
  log "Source mode: LOCAL (package.json found in $(pwd)) — skipping git clone."
  if [ -n "$REPO_URL" ]; then warn "REPO_URL ignored in local mode."; fi
fi

if [ "$LOCAL_MODE" -eq 0 ]; then
  if [ -z "$REPO_URL" ]; then
    read -r -p "Git repository URL (e.g. https://github.com/user/papital-erp.git): " REPO_URL
    [ -n "$REPO_URL" ] || die "Repository URL is required."
  fi
fi

# ---------- 2) System dependencies ----------
log "[1/7] Installing system dependencies (curl, git, OpenSSL, PostgreSQL, Node.js 24)..."

$SUDO apt-get update -y
# v10.0.4 (TD-957): rclone copies the daily backup off the server (scripts/backup-offsite.sh)
# v10.2.23 (OBS-R1-22): rsync syncs a manual update's source (update.sh --source / --zip)
$SUDO apt-get install -y curl git ca-certificates openssl gnupg rclone rsync

# PostgreSQL (>=14 required; add PGDG repo when distro version is older)
PG_MAJOR="$(psql --version 2>/dev/null | grep -oE '^[0-9]+' | head -1 || true)"
if [ -z "$PG_MAJOR" ] || [ "$PG_MAJOR" -lt 14 ]; then
  log "Installing PostgreSQL 16 from PGDG repository..."
  . /etc/os-release
  curl -fsSL "https://www.postgresql.org/media/keys/ACCC4CF8.asc" | $SUDO gpg --batch --yes --dearmor -o /usr/share/keyrings/pgdg.gpg
  echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    | $SUDO tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y postgresql-16 postgresql-contrib
else
  $SUDO apt-get install -y postgresql postgresql-contrib
fi
$SUDO systemctl enable --now postgresql

# Node.js 24 LTS via NodeSource (v10.1.28: an older Node is upgraded too)
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  log "Installing Node.js 24 LTS..."
  # NOTE: no `-E` here — with empty $SUDO (root) bash would try to run a command named "-E"
  curl -fsSL https://deb.nodesource.com/setup_24.x | $SUDO bash -
  $SUDO apt-get install -y nodejs
fi
success "System dependencies installed (node $(node -v), $(psql --version | head -1))"

# ---------- 3) Clone / update source ----------
log "[2/7] Fetching source code into $APP_DIR ..."
if [ "$LOCAL_MODE" -eq 1 ]; then
  success "Using current directory as source root."
elif [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git pull --ff-only || warn "git pull failed — continuing with existing source."
else
  $SUDO mkdir -p "$(dirname "$APP_DIR")"
  $SUDO git clone "$REPO_URL" "$APP_DIR"
  $SUDO chown -R "$(id -un)":"$(id -gn)" "$APP_DIR"
  cd "$APP_DIR"
  # v10.2.24 (OBS-R1-16): a token in the clone URL (https://user:token@host/...) is not kept in .git/config
  CLEAN_URL="$(printf '%s' "$REPO_URL" | sed -E 's#^(https?://)[^/@]+@#\1#')"
  if [ "$CLEAN_URL" != "$REPO_URL" ]; then
    git remote set-url origin "$CLEAN_URL"
    warn "The access token in the repository URL was removed from .git/config. For a private repository, git pull in update.sh asks for it again; an SSH deploy key avoids that."
  fi
fi
if git -C "$APP_DIR" remote get-url origin 2>/dev/null | grep -qE '^https?://[^/@]+@'; then
  warn "The git remote of $APP_DIR holds an access token in .git/config; remove it with: git remote set-url origin <URL without the token>"
fi
# v11 (O3): the scripts of a source unpacked from a zip without unix modes are made executable again, as git keeps them
chmod a+x ./*.sh scripts/*.sh 2>/dev/null || true
success "Source ready at $APP_DIR"

# ---------- 4) Database & .env ----------
log "[3/7] Preparing database and .env ..."
if [ ! -f .env ]; then
  DB_NAME="papital_erp"
  DB_USER="papital"
  DB_PASS="$(openssl rand -hex 24)"

  # v10.2.28 (#344 review L1): a database that already holds tables belongs to an earlier install; a new .env has new
  # ERP_SECRETS_KEY and JWT_SECRET, so the stored third-party passwords could no longer be read. Stop unless asked.
  if $SUDO -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    TABLES="$($SUDO -u postgres psql -d "$DB_NAME" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" || echo 0)"
    if [ "${TABLES:-0}" -gt 0 ] && [ "${INSTALL_REUSE_DB:-0}" != "1" ]; then
      die "Database ${DB_NAME} already holds ${TABLES} tables from an earlier install, but ${APP_DIR}/.env is missing. Put the old .env back (its ERP_SECRETS_KEY reads the stored passwords) and run again; or run again with INSTALL_REUSE_DB=1 to keep the data with new keys (stored third-party passwords must then be entered again)."
    fi
    [ "${TABLES:-0}" -eq 0 ] || warn "INSTALL_REUSE_DB=1: reusing database ${DB_NAME} (${TABLES} tables) with new keys; enter the stored third-party passwords again."
  fi
  # v10.2.24 (OBS-R1-16): a role left by an earlier install gets the new password too, or the new .env could not log in
  # (the password goes through stdin, never the command line)
  if $SUDO -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
    warn "Database role ${DB_USER} already exists; its password is replaced by the one written to the new .env."
  fi
  # v10.2.28 (#344 review L2): this session writes no statement to the server log, which would hold the password
  $SUDO -u postgres psql -v ON_ERROR_STOP=1 <<SQL
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_error_statement = 'panic';
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL
  if ! $SUDO -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    $SUDO -u postgres createdb -O "$DB_USER" "$DB_NAME"
  fi

  cat > .env <<ENV
NODE_ENV=production
PORT=${APP_PORT}
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
JWT_SECRET=$(openssl rand -hex 48)
ERP_SETUP_TOKEN=$(openssl rand -hex 24)
ALLOWED_ORIGINS=http://localhost:${APP_PORT}
LOG_LEVEL=info
LOG_DIR=logs
DB_POOL_MAX=20
ENV
  chmod 600 .env
  success ".env generated (secrets created with openssl)."
else
  warn ".env already exists — keeping its values."
fi
# v9.0.187 (TD-609): the encryption key of stored third-party passwords and the webhook signing token; only added
# when missing, never changed. Keep ERP_SECRETS_KEY with the backups: encrypted values cannot be read without it.
bash scripts/ensure-env-secrets.sh .env || die "Could not add the generated secrets to .env"

# ---------- 5) Install & build ----------
log "[4/7] Installing npm dependencies (npm ci)..."
npm ci
log "[5/7] Building application..."
npm run build
success "Build completed (dist/server.cjs)."

# ---------- 6) systemd service ----------
log "[6/7] Registering systemd service ${SERVICE_NAME} ..."
$SUDO tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<UNIT
[Unit]
Description=Papital ERP (Node.js)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=$(command -v node) --env-file=${APP_DIR}/.env ${APP_DIR}/dist/server.cjs
Environment=NODE_ENV=production
Restart=always
RestartSec=5
# v10.2.24 (OBS-R1-16): the service runs as the installing user (root under plain sudo); a separate service user needs
# update.sh to keep .env, logs and uploads owned by it, which is open in TD-1354
User=$(id -un)
# MemoryLimit=2G
[Install]
WantedBy=multi-user.target
UNIT

$SUDO systemctl daemon-reload
$SUDO systemctl enable "$SERVICE_NAME"
$SUDO systemctl restart "$SERVICE_NAME"
success "systemd service ${SERVICE_NAME} enabled and started."

# v10.0.3 (TD-1020): the daily backup and the five-minute monitor run from one cron file; the backup directory
# belongs to the service user and only it can read it (scripts/backup.sh, TD-585)
# v11 (O5): .env read as the service reads it (scripts/env-file.sh)
# shellcheck source=scripts/env-file.sh
source scripts/env-file.sh
BACKUP_DIR_ENV="$(env_file_get .env BACKUP_DIR)"
$SUDO install -d -m 700 -o "$(id -un)" "${BACKUP_DIR_ENV:-/var/backups/erp}"
$SUDO env APP_DIR="$APP_DIR" bash scripts/install-ops-cron.sh "$(id -un)" || die "Could not install the backup and monitor schedule"
success "Daily backup and monitor schedule installed (/etc/cron.d/papital-erp)."

# ---------- 7) Health probe ----------
# v10.2.24 (OBS-R1-16): /health/ready, not /health/live: ready means the database answers and the startup migrations
# finished (a first start runs all of them), so a wrong database password or a failed migration stops the install here
log "[7/7] Waiting for the readiness probe (the first start runs every database migration)..."
HEALTH_OK=0
for _ in $(seq 1 150); do
  if curl -fsS "http://localhost:${APP_PORT}/health/ready" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done

if [ "$HEALTH_OK" -ne 1 ]; then
  if curl -fsS "http://localhost:${APP_PORT}/health/live" >/dev/null 2>&1; then
    warn "The app runs but is not ready after 300s (database unreachable or migrations still running)."
  else
    warn "The app does not answer on port ${APP_PORT} after 300s."
  fi
  warn "Check: journalctl -u ${SERVICE_NAME} -n 100"
  exit 2
fi
success "Application is UP and ready."

echo ""
log "============================== INSTALLATION COMPLETE =============================="
log "  App URL      : http://localhost:${APP_PORT}"
log "  Setup wizard : http://localhost:${APP_PORT}/setup (type ERP_SETUP_TOKEN from .env into the form)"
log "  Service      : systemctl status ${SERVICE_NAME}"
log "  Logs         : journalctl -u ${SERVICE_NAME} -f   |   installer log: $LOG_FILE"
log "  Update later : ./update.sh   (never run db:push — migrations are automatic)"
log "  Port         : ${APP_PORT} answers on every address until setup-domain.sh puts Nginx in front (it then listens on 127.0.0.1 only)"
log "  Backups      : daily at 02:30 to /var/backups/erp; set up the encrypted Google Drive copy and alerts: docs/OFFSITE_BACKUP.md"
log "==================================================================================="
exit 0
