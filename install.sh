#!/usr/bin/env bash
# ============================================================
#  Papital ERP — Linux Installer (Ubuntu/Debian)
#  Installs dependencies, clones the repo, generates .env,
#  builds the app and registers a systemd service.
#  Migrations run automatically at startup (NEVER db:push).
# ============================================================
set -euo pipefail
# v11 (phase 5.3): what the installer makes is not writable for other users (the service user among them)
umask 022

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

# v11 (O9): an install that already runs is updated by update.sh, which takes a backup first, builds beside the running
# version and checks the start; running install.sh again built in place without any of that. Stopped before anything
# changes. A folder without .env (a reinstall over a kept database) or without a build still goes on.
if [ -f "$APP_DIR/.env" ] && [ -f "$APP_DIR/dist/server.cjs" ] && [ "${INSTALL_AGAIN:-0}" != "1" ]; then
  die "Papital ERP is already installed in ${APP_DIR}. Update it with: cd ${APP_DIR} && sudo ./update.sh (it takes a backup first). Nothing was changed. Only to rebuild a broken install in place, without a backup: INSTALL_AGAIN=1 bash install.sh"
fi
[ "${INSTALL_AGAIN:-0}" != "1" ] || warn "INSTALL_AGAIN=1: installing again over ${APP_DIR} without a backup."

# ---------- 2) System dependencies ----------
log "[1/7] Installing system dependencies (curl, git, OpenSSL, PostgreSQL, Node.js 24)..."

$SUDO apt-get update -y
# v10.0.4 (TD-957): rclone copies the daily backup off the server (scripts/backup-offsite.sh)
# v10.2.23 (OBS-R1-22): rsync syncs a manual update's source (update.sh --source / --zip)
$SUDO apt-get install -y curl git ca-certificates openssl gnupg rclone rsync

# PostgreSQL 16, the version CI tests: from the distribution when it has it (Ubuntu 24.04), else from PGDG.
# v11 (phase 5.3): the earlier check of `psql --version` never matched, so every install added PGDG and also its
# postgresql-contrib, which pulls in PGDG's newest major; that major's client tools write dumps version 16 cannot read
# (scripts/backup.sh checks every dump). The contrib modules are part of postgresql-16.
if [ -x /usr/lib/postgresql/16/bin/postgres ]; then
  log "PostgreSQL 16 is already installed."
elif apt-cache policy postgresql-16 2>/dev/null | grep -qE 'Candidate: [0-9]'; then
  $SUDO apt-get install -y postgresql-16
else
  log "Installing PostgreSQL 16 from PGDG repository..."
  . /etc/os-release
  curl -fsSL "https://www.postgresql.org/media/keys/ACCC4CF8.asc" | $SUDO gpg --batch --yes --dearmor -o /usr/share/keyrings/pgdg.gpg
  echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    | $SUDO tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y postgresql-16
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

# ---------- 3b) Service user (v11, phase 5.3, TD-1354) ----------
# A new install runs the service as its own system user, not as root. That user owns only what the app writes (logs,
# uploads, media library, backups) and reads .env through its group; the code stays with the installing user, so the app
# cannot change the scripts root runs at night. SERVICE_USER=root keeps the earlier layout (everything as root).
SERVICE_USER="${SERVICE_USER:-papital}"
as_service_user() { if [ -n "$SUDO" ]; then $SUDO -u "$SERVICE_USER" "$@"; else runuser -u "$SERVICE_USER" -- "$@"; fi; }
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  # a home of its own holds the user's rclone configuration of the off-server copy (docs/OFFSITE_BACKUP.md)
  $SUDO useradd --system --user-group --home-dir "/var/lib/${SERVICE_USER}" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  success "System user $SERVICE_USER created for the service."
fi
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
if [ "$SERVICE_USER" != root ] && [ -n "$SERVICE_HOME" ] && [ "$SERVICE_HOME" != /nonexistent ] && [ ! -e "$SERVICE_HOME" ]; then
  $SUDO install -d -m 750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$SERVICE_HOME"
fi
as_service_user test -r "$APP_DIR/package.json" \
  || die "The service user $SERVICE_USER cannot read ${APP_DIR} (a folder inside a home folder?). Put the source in /opt/papital-erp and run install.sh there, or run with SERVICE_USER=$(id -un). Nothing was installed yet."

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
# v11 (phase 5.3): the service reads .env through its group; nobody else reads it
if [ "$SERVICE_USER" != "$(id -un)" ]; then
  $SUDO chown "$(id -un):${SERVICE_GROUP}" .env
  chmod 640 .env
fi
# shellcheck source=scripts/env-file.sh
source scripts/env-file.sh
# what the app writes belongs to the service user: logs, uploads with their attachments, the media library
state_dir() { case "$1" in /*) echo "$1" ;; *) echo "$APP_DIR/$1" ;; esac; }
UPLOADS_STATE="$APP_DIR/public/uploads"
STATE_DIRS=()
for dir in "$(state_dir "$(env_file_get .env LOG_DIR)")" "$UPLOADS_STATE" \
  "$(state_dir "$(env_file_get .env ATTACHMENTS_DIR)")" "$UPLOADS_STATE/.attachments" \
  "$(state_dir "$(env_file_get .env MEDIA_DIR)")" "$APP_DIR/media-library" "$APP_DIR/logs"; do
  [ "$dir" != "$APP_DIR/" ] || continue
  STATE_DIRS+=("$dir")
  case "$dir" in
    "$APP_DIR"/*) ;;
    # a folder of .env outside the app that is already there may be shared with others: it is not taken over
    *) if [ -d "$dir" ] && [ "$(stat -c %U "$dir")" != "$SERVICE_USER" ]; then
         warn "$dir is not owned by ${SERVICE_USER}; give it to the service: sudo chown -R ${SERVICE_USER}:${SERVICE_GROUP} $dir"
         continue
       fi ;;
  esac
  # the service user may have put a link there (uploads/.attachments is inside its uploads folder): never followed
  if [ -L "$dir" ]; then
    warn "$dir is a link; it is left as it is (make it a folder of ${SERVICE_USER} by hand)"
    continue
  fi
  # files an earlier install left there (INSTALL_AGAIN=1) go to the service user too; links are not followed
  if [ -d "$dir" ] && [ "$(stat -c %U "$dir")" != "$SERVICE_USER" ]; then $SUDO chown -R -h "$SERVICE_USER:$SERVICE_GROUP" "$dir"; fi
  # in a folder of the service user the folder is made by that user (it could swap the name for a link between a test
  # and root's install -d); elsewhere only root writes beside it
  if [ "$(stat -c %U "$(dirname "$dir")" 2>/dev/null)" = "$SERVICE_USER" ]; then
    as_service_user install -d -m 750 "$dir"
  else
    $SUDO install -d -m 750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$dir"
  fi
done

# ---------- 5) Install & build ----------
log "[4/7] Installing npm dependencies (npm ci)..."
npm ci
log "[5/7] Building application..."
npm run build
success "Build completed (dist/server.cjs)."
# v11 (phase 5.3): the code stays out of reach of the service user whatever modes a zip or an odd umask gave it; the
# folders of that user are left alone
STATE_PRUNE=()
for dir in "${STATE_DIRS[@]}"; do STATE_PRUNE+=(-path "$dir" -o); done
find "$APP_DIR" -xdev \( "${STATE_PRUNE[@]}" -false \) -prune -o ! -type l -perm /o=w -exec chmod o-w {} + 2>/dev/null || true

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
# v11 (phase 5.3, TD-1354): its own system user (SERVICE_USER, default papital), files private to it (UMask), and no
# way to gain rights or to change the system
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
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
# v11 (O5): .env read as the service reads it (scripts/env-file.sh); v11 (phase 5.3): the jobs run as the service user
BACKUP_DIR_ENV="$(env_file_get .env BACKUP_DIR)"
$SUDO install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "${BACKUP_DIR_ENV:-/var/backups/erp}"
$SUDO env APP_DIR="$APP_DIR" bash scripts/install-ops-cron.sh "$SERVICE_USER" || die "Could not install the backup and monitor schedule"
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
