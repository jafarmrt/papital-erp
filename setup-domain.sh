#!/usr/bin/env bash
# ============================================================
#  Papital ERP — Domain & HTTPS Setup (Ubuntu/Debian)
#  Installs Nginx + Certbot, configures a reverse proxy to the
#  local app port, issues a free Let's Encrypt certificate and
#  updates ALLOWED_ORIGINS in .env.
#
#  Usage:
#    sudo bash setup-domain.sh                       (interactive)
#    sudo DOMAIN=erp.example.com EMAIL=me@x.com bash setup-domain.sh
#  Requirements: the domain's DNS A record must already point
#  to this server's public IP and ports 80/443 must be open.
# ============================================================
set -euo pipefail

LOG_FILE="domain-setup-$(date +%Y%m%d-%H%M%S).log"
( umask 077; : >> "$LOG_FILE" )
exec > >(tee -a "$LOG_FILE") 2>&1

log()      { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
success()  { log "OK: $*"; }
die()      { log "ERROR: $*"; exit 1; }

APP_DIR="${APP_DIR:-/opt/papital-erp}"
# v11 (O5): the one .env reader of every script, next to this one
# shellcheck source=scripts/env-file.sh
source "$(dirname "${BASH_SOURCE[0]}")/scripts/env-file.sh"
SERVICE_NAME="papital-erp"
APP_PORT="${APP_PORT:-}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"

[ "$(id -u)" -eq 0 ] || die "Please run as root (sudo)."

log "=== Papital ERP Domain Setup — log: $LOG_FILE ==="

# ---------- 1) Inputs ----------
if [ -z "$DOMAIN" ]; then
  read -r -p "Domain name (e.g. erp.mycompany.ir): " DOMAIN
  [ -n "$DOMAIN" ] || die "Domain is required."
fi
if [ -z "$EMAIL" ]; then
  read -r -p "Email for Let's Encrypt renewal notices: " EMAIL
  [ -n "$EMAIL" ] || die "Email is required."
fi
[ -f "$APP_DIR/.env" ] || die ".env not found in $APP_DIR — run install.sh first."
# v9.0.124 (TD-587): the app listens on PORT from .env (install.sh writes it); Nginx must proxy to that port
if [ -z "$APP_PORT" ]; then
  # v11 (O5): read as the service reads it (scripts/env-file.sh: the last line wins, «export», inline comments)
  APP_PORT="$(env_file_get "$APP_DIR/.env" PORT)"
fi
APP_PORT="${APP_PORT:-3000}"

# ---------- 2) DNS sanity check ----------
SERVER_IP="$(curl -fsS4 https://api.ipify.org 2>/dev/null || echo '')"
DOMAIN_IP="$(getent hosts "$DOMAIN" | awk '{print $1; exit}' || true)"
if [ -n "$SERVER_IP" ] && [ -n "$DOMAIN_IP" ]; then
  if [ "$SERVER_IP" != "$DOMAIN_IP" ]; then
    log "WARN: '$DOMAIN' resolves to $DOMAIN_IP but this server's public IP is $SERVER_IP."
    log "      Let's Encrypt will FAIL until the DNS A record points here. Continuing anyway..."
  else
    success "DNS check passed: $DOMAIN -> $SERVER_IP"
  fi
else
  log "WARN: Could not verify DNS automatically. Continuing..."
fi

# ---------- 3) Nginx + Certbot ----------
log "[1/5] Installing Nginx and Certbot..."
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nginx certbot python3-certbot-nginx
else
  die "This script supports apt-based distros (Ubuntu/Debian) only."
fi
systemctl enable --now nginx
success "Nginx + Certbot installed."

# ---------- 4) Reverse proxy site ----------
log "[2/5] Configuring reverse proxy for $DOMAIN -> http://localhost:${APP_PORT} ..."

NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
cat > "$NGINX_SITE" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 64m;   # uploads (product images, excel imports)

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX

ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/${DOMAIN}"
# v10.2.24 (OBS-R1-16): the default site is disabled only while it is the unchanged page of the nginx package;
# a default site someone edited may serve another site of this server, so it stays
DEFAULT_SITE="/etc/nginx/sites-available/default"
if [ -e /etc/nginx/sites-enabled/default ]; then
  STOCK_MD5="$(dpkg-query -W -f='${Conffiles}\n' nginx-common 2>/dev/null | awk -v f="$DEFAULT_SITE" '$1 == f {print $2; exit}' || true)"
  if [ -L /etc/nginx/sites-enabled/default ] && [ "$(readlink -f /etc/nginx/sites-enabled/default)" = "$DEFAULT_SITE" ] \
     && [ -n "$STOCK_MD5" ] && [ "$(md5sum "$DEFAULT_SITE" | awk '{print $1}')" = "$STOCK_MD5" ]; then
    rm -f /etc/nginx/sites-enabled/default
    log "Disabled the unchanged nginx welcome site (sites-enabled/default)."
  else
    log "WARN: /etc/nginx/sites-enabled/default was changed on this server and is kept; requests for ${DOMAIN} still go to the new site."
  fi
fi
nginx -t || die "Nginx config test failed."
systemctl reload nginx
success "Reverse proxy configured."

# ---------- 5) Firewall (if ufw active) ----------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  log "[3/5] Opening firewall ports 80/443..."
  ufw allow 80/tcp  >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
  success "Firewall ports opened."
else
  log "[3/5] ufw not active — skipping firewall step."
fi

# ---------- 6) Let's Encrypt certificate ----------
log "[4/5] Issuing Let's Encrypt certificate for $DOMAIN ..."
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect \
  || die "Certbot failed. Check DNS A record and port 80 reachability, then re-run this script."
success "HTTPS enabled with auto-renewal (systemd timer)."

# ---------- 7) Update .env ALLOWED_ORIGINS + APP_URL ----------
log "[5/5] Updating ALLOWED_ORIGINS and APP_URL in $APP_DIR/.env ..."
# v10.2.28 (#344 review L3): a .env without a final newline would join its last line with the first one added below
if [ -s "$APP_DIR/.env" ] && [ -n "$(tail -c1 "$APP_DIR/.env")" ]; then echo >> "$APP_DIR/.env"; fi
if grep -q '^ALLOWED_ORIGINS=' "$APP_DIR/.env"; then
  sed -i "s#^ALLOWED_ORIGINS=.*#ALLOWED_ORIGINS=https://${DOMAIN},http://${DOMAIN},http://localhost:${APP_PORT}#" "$APP_DIR/.env"
else
  echo "ALLOWED_ORIGINS=https://${DOMAIN},http://${DOMAIN},http://localhost:${APP_PORT}" >> "$APP_DIR/.env"
fi
if grep -q '^APP_URL=' "$APP_DIR/.env"; then
  sed -i "s#^APP_URL=.*#APP_URL=https://${DOMAIN}#" "$APP_DIR/.env"
else
  echo "APP_URL=https://${DOMAIN}" >> "$APP_DIR/.env"
fi
# v10.2.24 (OBS-R1-16): with Nginx in front, the app port answers on this server only; a value already in .env is kept
# (v11, O5: in any form the service reads, «export» and leading spaces included, or the appended line would win)
if ! grep -qE '^[[:space:]]*(export[[:space:]]+)?ERP_LISTEN_HOST[[:space:]]*=' "$APP_DIR/.env"; then
  echo "ERP_LISTEN_HOST=127.0.0.1" >> "$APP_DIR/.env"
  log "The app now listens on 127.0.0.1:${APP_PORT} only (ERP_LISTEN_HOST in .env); open it through https://${DOMAIN}."
fi
chmod 600 "$APP_DIR/.env"

systemctl restart "$SERVICE_NAME"
# v11 (O12): healthy means started (migrations, seed and engines done), as update.sh checks it; /health/live answers
# even right before a failed migration ends the process
if bash "$APP_DIR/scripts/verify-startup.sh" "$APP_PORT" "${STARTUP_TIMEOUT:-300}"; then
  success "Application restarted and healthy."
else
  log "WARN: the application did not finish starting — check: journalctl -u ${SERVICE_NAME} -n 50"
fi

echo ""
log "================================= DOMAIN SETUP COMPLETE ================================="
log "  App URL   : https://${DOMAIN}"
log "  SSL       : Let's Encrypt (auto-renews via certbot.timer)"
log "  Renew test: sudo certbot renew --dry-run"
log "  Logs      : journalctl -u ${SERVICE_NAME} -f   |  nginx: /var/log/nginx/"
log "=========================================================================================="
