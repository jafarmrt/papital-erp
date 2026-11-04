#!/usr/bin/env bash
# ============================================================
#  Papital storefront — the nginx site and https of the site's domain (v11 phase 8.6)
#
#  Writes one nginx site (sites-available/papital-storefront.conf) that sends the domain to the storefront service
#  (storefront.sh, 127.0.0.1:3100), redirects www. and http to https://DOMAIN, keeps product images and build files
#  in an nginx cache and limits the page requests of one visitor address. It never changes the ERP's own site.
#  Running it again rewrites the same site (for example with the real domain after a test address).
#
#  Usage (as root):
#    sudo DOMAIN=papitalgallery.com EMAIL=me@example.com bash storefront-nginx.sh
#
#  Environment:
#    DOMAIN         the site's host, without www. (required)
#    WWW            1 = www.DOMAIN is served too and redirected to DOMAIN (default: 1 for a two-label domain
#                   such as papitalgallery.com, 0 for a sub-domain such as new.papitalgallery.com)
#    TLS            certbot (default): use the Let's Encrypt certificate of DOMAIN if there is one (also one made
#                   earlier with a DNS challenge), else get one through http (the DNS of DOMAIN must point here);
#                   existing: use CERT_FILE and KEY_FILE as given; none: http only (a local test, never the real site)
#    EMAIL          the Let's Encrypt account e-mail (only needed when this server has no Let's Encrypt account yet)
#    FORCE_RENEW    1 = get a new certificate through http even when one exists (moves a certificate made with a
#                   manual DNS challenge to automatic renewal)
#    HSTS_MAX_AGE   seconds browsers must keep using https (default 300; raise it to 31536000 once the site is stable)
#    RATE, BURST    page requests per visitor address (default 10r/s, burst 60)
#    SITE_PORT      the storefront service's port (default: STOREFRONT_PORT of /etc/papital-storefront/storefront.env,
#                   else 3100)
#    NGINX_DIR      default /etc/nginx; DRY_RUN=1 only writes the files (no packages, firewall, certbot or reload)
# ============================================================
set -euo pipefail

log()     { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2; }
success() { log "OK: $*"; }
warn()    { log "WARN: $*"; }
die()     { log "ERROR: $*"; exit 1; }

DOMAIN="${DOMAIN:-}"
TLS="${TLS:-certbot}"
EMAIL="${EMAIL:-}"
FORCE_RENEW="${FORCE_RENEW:-0}"
HSTS_MAX_AGE="${HSTS_MAX_AGE:-300}"
RATE="${RATE:-10r/s}"
BURST="${BURST:-60}"
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"
DRY_RUN="${DRY_RUN:-0}"
ENV_FILE="${ENV_FILE:-/etc/papital-storefront/storefront.env}"
ACME_ROOT="${ACME_ROOT:-/var/www/papital-storefront-acme}"
CACHE_DIR="${CACHE_DIR:-/var/cache/nginx/papital-storefront}"
SITE_FILE="${NGINX_DIR}/sites-available/papital-storefront.conf"
SITE_LINK="${NGINX_DIR}/sites-enabled/papital-storefront.conf"
SNIPPET="${NGINX_DIR}/snippets/papital-storefront-proxy.conf"

[ "$DRY_RUN" = 1 ] || [ "$(id -u)" -eq 0 ] || die "Please run as root (sudo)."
[ -n "$DOMAIN" ] || die "DOMAIN is required, e.g. sudo DOMAIN=papitalgallery.com bash $0"
DOMAIN="${DOMAIN#www.}"
printf '%s' "$DOMAIN" | grep -qE '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' \
  || die "DOMAIN must be a lower-case host name such as papitalgallery.com (got: $DOMAIN)"
if [ -z "${WWW:-}" ]; then
  if [ "$(printf '%s' "$DOMAIN" | tr -cd '.' | wc -c)" -eq 1 ]; then WWW=1; else WWW=0; fi
fi
case "$TLS" in certbot|existing|none) ;; *) die "TLS must be certbot, existing or none (got: $TLS)" ;; esac
printf '%s' "$HSTS_MAX_AGE" | grep -qE '^[0-9]+$' || die "HSTS_MAX_AGE must be a number of seconds"
printf '%s' "$RATE" | grep -qE '^[0-9]+r/[sm]$' || die "RATE must look like 10r/s"
printf '%s' "$BURST" | grep -qE '^[0-9]+$' || die "BURST must be a number"

if [ -z "${SITE_PORT:-}" ] && [ -f "$ENV_FILE" ]; then
  SITE_PORT="$(sed -n 's/^[[:space:]]*STOREFRONT_PORT[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | tail -n 1 | tr -d "\"'")"
fi
SITE_PORT="${SITE_PORT:-3100}"
printf '%s' "$SITE_PORT" | grep -qE '^[0-9]+$' || die "SITE_PORT must be a number"

NAMES="$DOMAIN"
[ "$WWW" = 1 ] && NAMES="$DOMAIN www.$DOMAIN"
CERT_NAME="$DOMAIN"
LE_LIVE="/etc/letsencrypt/live/${CERT_NAME}"

# ---------- packages and firewall ----------
if [ "$DRY_RUN" != 1 ]; then
  command -v apt-get >/dev/null 2>&1 || die "This script supports apt-based systems (Ubuntu/Debian) only."
  pkgs=()
  command -v nginx >/dev/null 2>&1 || pkgs+=(nginx)
  if [ "$TLS" = certbot ] && ! command -v certbot >/dev/null 2>&1; then pkgs+=(certbot); fi
  if [ "${#pkgs[@]}" -gt 0 ]; then
    log "Installing ${pkgs[*]} ..."
    apt-get update -y >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y "${pkgs[@]}" >/dev/null
  fi
  systemctl enable --now nginx >/dev/null 2>&1 || true
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null || true
    ufw allow 443/tcp >/dev/null || true
    log "Firewall: 80 and 443 open."
  fi
  install -d -m 755 "$ACME_ROOT"
  # nginx makes the cache folder itself (for its worker user), but not its parent
  install -d -m 755 "$(dirname "$CACHE_DIR")"
fi
install -d "${NGINX_DIR}/sites-available" "${NGINX_DIR}/sites-enabled" "${NGINX_DIR}/snippets"

# ---------- what nginx can do here ----------
NGINX_VERSION="0.0.0"
if command -v nginx >/dev/null 2>&1; then NGINX_VERSION="$(nginx -v 2>&1 | sed -n 's#.*nginx/\([0-9.]*\).*#\1#p')"; fi
# nginx 1.25.1 moved http2 from «listen … http2» to «http2 on»
if [ "$(printf '%s\n%s\n' 1.25.1 "$NGINX_VERSION" | sort -V | head -n 1)" = 1.25.1 ]; then
  LISTEN_TLS="listen 443 ssl;"; HTTP2_LINE="http2 on;"
else
  LISTEN_TLS="listen 443 ssl http2;"; HTTP2_LINE=""
fi
IPV6=0
[ -f /proc/net/if_inet6 ] && IPV6=1
[ -n "${FORCE_IPV6:-}" ] && IPV6="$FORCE_IPV6"
listen_lines() { # $1 = http | https
  if [ "$1" = http ]; then
    echo "    listen 80;"
    [ "$IPV6" = 1 ] && echo "    listen [::]:80;"
  else
    echo "    ${LISTEN_TLS}"
    [ "$IPV6" = 1 ] && echo "    ${LISTEN_TLS/443/[::]:443}"
    [ -n "$HTTP2_LINE" ] && echo "    ${HTTP2_LINE}"
  fi
  return 0
}

tls_lines() {
  echo "    ssl_certificate ${CERT_FILE};"
  echo "    ssl_certificate_key ${KEY_FILE};"
  if [ -f /etc/letsencrypt/options-ssl-nginx.conf ]; then
    echo "    include /etc/letsencrypt/options-ssl-nginx.conf;"
  else
    echo "    ssl_protocols TLSv1.2 TLSv1.3;"
    echo "    ssl_session_timeout 1d;"
  fi
  [ -f /etc/letsencrypt/ssl-dhparams.pem ] && echo "    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
  return 0
}

acme_location() {
  cat <<NGINX
    # Let's Encrypt's http check (renewals too)
    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
        default_type text/plain;
    }
NGINX
}

# ---------- the shared part: proxy rules, caches and limits ----------
write_snippet() {
  cat > "${SNIPPET}.new" <<'NGINX'
# Papital storefront: the proxy rules of every server block of the site (written by storefront-nginx.sh)
server_tokens off;
# a card-to-card receipt photo is at most 3 MB; the app refuses a larger Content-Length too
client_max_body_size 5m;

# HTML too: the site's cookies are SameSite=Lax, so another site cannot make a browser send them along with
# requests it can measure (the BREACH conditions)
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml application/xml application/rss+xml application/json application/javascript text/javascript application/manifest+json image/svg+xml;

proxy_http_version 1.1;
proxy_set_header Connection "";
# the app accepts forms only from the host of STOREFRONT_SITE_URL: Host goes on exactly as the browser sent it
proxy_set_header Host $host;
# written here, never passed on from the browser (STOREFRONT_TRUST_PROXY=1 reads them)
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 5s;
proxy_read_timeout 60s;

# product images: named after their content, never stale
location /media/ {
    proxy_pass http://papital_storefront;
    proxy_cache papital_storefront;
    proxy_cache_key $uri;
    proxy_cache_valid 200 30d;
    proxy_cache_lock on;
    proxy_cache_use_stale error timeout updating http_502 http_503 http_504;
    add_header X-Cache-Status $upstream_cache_status always;
}

# build files: hashed names; kept after an update so a page opened before it still finds its files
location /assets/ {
    proxy_pass http://papital_storefront;
    proxy_cache papital_storefront;
    proxy_cache_key $uri;
    proxy_cache_valid 200 30d;
    proxy_cache_lock on;
    proxy_cache_use_stale error timeout updating http_502 http_503 http_504;
    add_header X-Cache-Status $upstream_cache_status always;
}

# pages, forms, feeds: never kept here
location / {
    limit_req zone=papital_storefront_pages burst=__BURST__ nodelay;
    limit_req_status 429;
    proxy_pass http://papital_storefront;
}
NGINX
  sed -i "s/__BURST__/${BURST}/" "${SNIPPET}.new"
}

# ---------- the site ----------
write_site() { # $1 = http | https
  local mode="$1"
  {
    cat <<NGINX
# Papital storefront: the site of ${DOMAIN} (written by storefront-nginx.sh on $(date -u '+%Y-%m-%d %H:%M UTC');
# run the script again instead of editing this file). Mode: ${mode}.

# product images and build files are kept here; pages never are
proxy_cache_path ${CACHE_DIR} levels=1:2 keys_zone=papital_storefront:10m max_size=2g inactive=30d use_temp_path=off;
# page requests of one visitor address: every page may ask the ERP, whose Storefront API limit all visitors share;
# mobile operators put many phones behind one address, so it is generous
limit_req_zone \$binary_remote_addr zone=papital_storefront_pages:10m rate=${RATE};

upstream papital_storefront {
    server 127.0.0.1:${SITE_PORT};
    keepalive 16;
}

NGINX
    if [ "$mode" = https ]; then
      cat <<NGINX
# http: only Let's Encrypt's check, everything else to https://${DOMAIN}
server {
$(listen_lines http)
    server_name ${NAMES};
$(acme_location)
    location / {
        return 301 https://${DOMAIN}\$request_uri;
    }
}

NGINX
      if [ "$WWW" = 1 ]; then
        cat <<NGINX
# www. never reaches the app (its forms would be refused): one redirect to the site's own host
server {
$(listen_lines https)
    server_name www.${DOMAIN};
$(tls_lines)
    location / {
        return 301 https://${DOMAIN}\$request_uri;
    }
}

NGINX
      fi
      cat <<NGINX
server {
$(listen_lines https)
    server_name ${DOMAIN};
$(tls_lines)
    # browsers keep to https for this long (raise to 31536000 once the site is stable; no sub-domains: the ERP has its own)
    add_header Strict-Transport-Security "max-age=${HSTS_MAX_AGE}" always;
    include ${SNIPPET};
}
NGINX
    else
      if [ "$WWW" = 1 ]; then
        cat <<NGINX
# www. never reaches the app (its forms would be refused)
server {
$(listen_lines http)
    server_name www.${DOMAIN};
$(acme_location)
    location / {
        return 301 http://${DOMAIN}\$request_uri;
    }
}

NGINX
      fi
      cat <<NGINX
# http only: before the certificate, or a local test (TLS=none). Never the real site for long.
server {
$(listen_lines http)
    server_name ${DOMAIN};
$(acme_location)
    include ${SNIPPET};
}
NGINX
    fi
  } > "${SITE_FILE}.new"
}

BACKUP_SITE=""
BACKUP_SNIPPET=""
apply() {
  if [ -f "$SITE_FILE" ]; then BACKUP_SITE="$(mktemp)"; cp -a "$SITE_FILE" "$BACKUP_SITE"; fi
  if [ -f "$SNIPPET" ]; then BACKUP_SNIPPET="$(mktemp)"; cp -a "$SNIPPET" "$BACKUP_SNIPPET"; fi
  mv "${SNIPPET}.new" "$SNIPPET"
  mv "${SITE_FILE}.new" "$SITE_FILE"
  ln -sfn "$SITE_FILE" "$SITE_LINK"
  [ "$DRY_RUN" = 1 ] && return 0
  if ! nginx -t >/dev/null 2>&1; then
    nginx -t || true
    if [ -n "$BACKUP_SITE" ]; then cp -a "$BACKUP_SITE" "$SITE_FILE"; else rm -f "$SITE_LINK" "$SITE_FILE"; fi
    if [ -n "$BACKUP_SNIPPET" ]; then cp -a "$BACKUP_SNIPPET" "$SNIPPET"; fi
    die "nginx refused the new site; the previous one was put back."
  fi
  systemctl reload nginx
}

# ---------- certificate ----------
case "$TLS" in
  none)
    write_snippet; write_site http; apply
    warn "http only (TLS=none): fine for a local test, never for the real site."
    ;;
  existing)
    [ -n "${CERT_FILE:-}" ] && [ -n "${KEY_FILE:-}" ] || die "TLS=existing needs CERT_FILE and KEY_FILE."
    [ "$DRY_RUN" = 1 ] || { [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; } || die "CERT_FILE or KEY_FILE does not exist."
    write_snippet; write_site https; apply
    ;;
  certbot)
    CERT_FILE="${LE_LIVE}/fullchain.pem"
    KEY_FILE="${LE_LIVE}/privkey.pem"
    if [ "$DRY_RUN" = 1 ]; then
      write_snippet; write_site https; apply
    elif [ -f "$CERT_FILE" ] && [ "$FORCE_RENEW" != 1 ]; then
      log "Using the certificate already in ${LE_LIVE}."
      if ! openssl x509 -in "$CERT_FILE" -noout -checkend 0 >/dev/null 2>&1; then warn "That certificate has expired: run again with FORCE_RENEW=1."; fi
      for name in $NAMES; do
        openssl x509 -in "$CERT_FILE" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:${name}\b" \
          || warn "The certificate does not name ${name}: run again with FORCE_RENEW=1 once the DNS of ${name} points here."
      done
      write_snippet; write_site https; apply
    else
      # first the http site (it answers Let's Encrypt's check), then the certificate, then https
      write_snippet; write_site http; apply
      args=(certonly --webroot -w "$ACME_ROOT" --cert-name "$CERT_NAME" --non-interactive --agree-tos
            --deploy-hook "systemctl reload nginx")
      for name in $NAMES; do args+=(-d "$name"); done
      if [ -n "$EMAIL" ]; then args+=(-m "$EMAIL"); fi
      if [ "$FORCE_RENEW" = 1 ]; then args+=(--force-renewal); else args+=(--keep-until-expiring); fi
      log "Asking Let's Encrypt for ${NAMES} ..."
      certbot "${args[@]}" || die "certbot failed: the DNS of ${NAMES} must point to this server and port 80 must be open. The site answers on http meanwhile; run this script again once the DNS is right."
      write_site https; write_snippet; apply
    fi
    ;;
esac

if [ "$DRY_RUN" != 1 ]; then
  scheme=https; [ "$TLS" = none ] && scheme=http
  success "nginx serves ${NAMES} → 127.0.0.1:${SITE_PORT} (${scheme})."
  if [ -f "$ENV_FILE" ]; then
    site_url="$(sed -n 's/^[[:space:]]*STOREFRONT_SITE_URL[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | tail -n 1 | tr -d "\"'")"
    if [ "$site_url" != "${scheme}://${DOMAIN}" ]; then
      warn "STOREFRONT_SITE_URL in ${ENV_FILE} is '${site_url}', not ${scheme}://${DOMAIN}: the site's forms are refused until it is. Fix it, then: systemctl restart papital-storefront"
    fi
  fi
  log "Check: curl -sI ${scheme}://${DOMAIN}/healthz"
fi
