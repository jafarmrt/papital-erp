#!/usr/bin/env bash
# ============================================================
#  Papital ERP — Linux Installer (Ubuntu/Debian)
#  Installs dependencies, clones the repo, generates .env,
#  builds the app and registers a systemd service.
#  Migrations run automatically at startup (NEVER db:push).
# ============================================================
set -euo pipefail

LOG_FILE="install-$(date +%Y%m%d-%H%M%S).log"
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
  SUDO=""
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
log "[1/7] Installing system dependencies (curl, git, OpenSSL, PostgreSQL, Node.js 22)..."

$SUDO apt-get update -y
$SUDO apt-get install -y curl git ca-certificates openssl gnupg

# PostgreSQL (>=14 required; add PGDG repo when distro version is older)
PG_MAJOR="$(psql --version 2>/dev/null | grep -oE '^[0-9]+' | head -1 || true)"
if [ -z "$PG_MAJOR" ] || [ "$PG_MAJOR" -lt 14 ]; then
  log "Installing PostgreSQL 16 from PGDG repository..."
  . /etc/os-release
  curl -fsSL "https://www.postgresql.org/media/keys/ACCC4CF8.asc" | $SUDO gpg --dearmor -o /usr/share/keyrings/pgdg.gpg
  echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    | $SUDO tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y postgresql-16 postgresql-contrib
else
  $SUDO apt-get install -y postgresql postgresql-contrib
fi
$SUDO systemctl enable --now postgresql

# Node.js 22 LTS via NodeSource
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  log "Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
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
fi
success "Source ready at $APP_DIR"

# ---------- 4) Database & .env ----------
log "[3/7] Preparing database and .env ..."
if [ ! -f .env ]; then
  DB_NAME="papital_erp"
  DB_USER="papital"
  DB_PASS="$(openssl rand -hex 24)"

  $SUDO -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
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
ALLOW_SEED_IN_PRODUCTION=false
ENV
  chmod 600 .env
  success ".env generated (secrets created with openssl)."
else
  warn ".env already exists — keeping it untouched."
fi

# ---------- 5) Install & build ----------
log "[4/7] Installing npm dependencies (npm ci)..."
npm ci --omit=dev=false
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
User=$(id -un)
# MemoryLimit=2G
[Install]
WantedBy=multi-user.target
UNIT

$SUDO systemctl daemon-reload
$SUDO systemctl enable "$SERVICE_NAME"
$SUDO systemctl restart "$SERVICE_NAME"
success "systemd service ${SERVICE_NAME} enabled and started."

# ---------- 7) Health probe ----------
log "[7/7] Waiting for health probe..."
HEALTH_OK=0
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:${APP_PORT}/health/live" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done

if [ "$HEALTH_OK" -ne 1 ]; then
  warn "Health probe did not pass within 60s. Check: journalctl -u ${SERVICE_NAME} -n 100"
  exit 2
fi
success "Application is UP."

echo ""
log "============================== INSTALLATION COMPLETE =============================="
log "  App URL      : http://localhost:${APP_PORT}"
log "  Setup wizard : http://localhost:${APP_PORT}/setup?token=<ERP_SETUP_TOKEN from .env>"
log "  Service      : systemctl status ${SERVICE_NAME}"
log "  Logs         : journalctl -u ${SERVICE_NAME} -f   |   installer log: $LOG_FILE"
log "  Update later : ./update.sh   (never run db:push — migrations are automatic)"
log "==================================================================================="
exit 0
