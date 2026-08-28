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
exec > >(tee -a "$LOG_FILE") 2>&1

log()      { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
success()  { log "OK: $*"; }
die()      { log "ERROR: $*"; exit 1; }

APP_DIR="${APP_DIR:-/opt/papital-erp}"
SERVICE_NAME="papital-erp"
APP_PORT="${APP_PORT:-3000}"
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
rm -f /etc/nginx/sites-enabled/default
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

# ---------- 7) Update .env ALLOWED_ORIGINS ----------
log "[5/5] Updating ALLOWED_ORIGINS in $APP_DIR/.env ..."
if grep -q '^ALLOWED_ORIGINS=' "$APP_DIR/.env"; then
  sed -i "s#^ALLOWED_ORIGINS=.*#ALLOWED_ORIGINS=https://${DOMAIN},http://${DOMAIN},http://localhost:${APP_PORT}#" "$APP_DIR/.env"
else
  echo "ALLOWED_ORIGINS=https://${DOMAIN},http://${DOMAIN},http://localhost:${APP_PORT}" >> "$APP_DIR/.env"
fi
chmod 600 "$APP_DIR/.env"

systemctl restart "$SERVICE_NAME"
sleep 3
if curl -fsS "http://localhost:${APP_PORT}/health/live" >/dev/null 2>&1; then
  success "Application restarted and healthy."
else
  log "WARN: Health probe did not pass immediately — check: journalctl -u ${SERVICE_NAME} -n 50"
fi

echo ""
log "================================= DOMAIN SETUP COMPLETE ================================="
log "  App URL   : https://${DOMAIN}"
log "  SSL       : Let's Encrypt (auto-renews via certbot.timer)"
log "  Renew test: sudo certbot renew --dry-run"
log "  Logs      : journalctl -u ${SERVICE_NAME} -f   |  nginx: /var/log/nginx/"
log "=========================================================================================="
