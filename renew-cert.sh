#!/usr/bin/env bash
set -euo pipefail

# Renew (or obtain) a LetsEncrypt certificate and ensure nginx serves FULLCHAIN (leaf + intermediate).
# The cert/key are copied into a host-mounted directory used by the www3 (nginx) container:
#   ./nginx/ssl -> /etc/nginx/ssl (inside container)
# Nginx config expects:
#   ssl_certificate     /etc/nginx/ssl/cert.pem;
#   ssl_certificate_key /etc/nginx/ssl/privkey.pem;
#
# This script is based on the approach used in:
#   https://github.com/khvilon/unkaos/blob/master/renew-cert.sh

if [ "${EUID:-0}" -ne 0 ]; then
  echo "Please run as root (certbot + /etc/letsencrypt access required)" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$APP_DIR/.env"
COMPOSE_FILE="$APP_DIR/docker-compose.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE (needed for DOMAIN and optional LETSENCRYPT_EMAIL)" >&2
  exit 1
fi
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Missing $COMPOSE_FILE" >&2
  exit 1
fi

# Load env
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DOMAIN="${DOMAIN:-}"
EMAIL="${LETSENCRYPT_EMAIL:-}"
NGINX_SERVICE="${NGINX_SERVICE:-www3}"

if [ -z "$DOMAIN" ]; then
  echo "DOMAIN is empty in $ENV_FILE" >&2
  exit 1
fi

install_certbot() {
  if command -v certbot >/dev/null 2>&1; then
    return 0
  fi

  echo "[renew-cert] certbot not found; attempting to install automatically..."

  # Debian / Ubuntu / Proxmox
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y certbot
  # Alpine
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache certbot
  # Fedora / RHEL / CentOS
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y certbot
  elif command -v yum >/dev/null 2>&1; then
    yum install -y certbot
  else
    echo "certbot not found and no supported package manager detected." >&2
    echo "Install certbot manually, then rerun: sudo ./renew-cert.sh" >&2
    exit 1
  fi

  if ! command -v certbot >/dev/null 2>&1; then
    echo "Failed to install certbot automatically. Install it manually and rerun." >&2
    exit 1
  fi
}

install_certbot

LE_DIR="/etc/letsencrypt/live/$DOMAIN"
SSL_DIR="$APP_DIR/nginx/ssl"

sync_ssl_files() {
  mkdir -p "$SSL_DIR"

  local tmp_cert tmp_key changed=0
  tmp_cert="$(mktemp)"
  tmp_key="$(mktemp)"

  cp -fL "$LE_DIR/fullchain.pem" "$tmp_cert"
  cp -fL "$LE_DIR/privkey.pem" "$tmp_key"

  if [ ! -f "$SSL_DIR/cert.pem" ] || ! cmp -s "$tmp_cert" "$SSL_DIR/cert.pem"; then
    cp -f "$tmp_cert" "$SSL_DIR/cert.pem"
    changed=1
  fi
  if [ ! -f "$SSL_DIR/privkey.pem" ] || ! cmp -s "$tmp_key" "$SSL_DIR/privkey.pem"; then
    cp -f "$tmp_key" "$SSL_DIR/privkey.pem"
    changed=1
  fi

  rm -f "$tmp_cert" "$tmp_key"

  chmod 600 "$SSL_DIR/privkey.pem" || true
  chmod 644 "$SSL_DIR/cert.pem" || true

  # Sanity: cert.pem should contain at least 2 cert blocks (leaf + intermediate)
  local blocks
  blocks="$(grep -c "BEGIN CERTIFICATE" "$SSL_DIR/cert.pem" 2>/dev/null || true)"
  echo "[renew-cert] cert.pem cert-blocks=$blocks (expected >= 2 for LetsEncrypt fullchain)"

  return $changed
}

compose_cmd() {
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi
  return 1
}

COMPOSE="$(compose_cmd || true)"
if [ -z "${COMPOSE}" ]; then
  echo "docker compose not found (need docker-compose or docker compose plugin)" >&2
  exit 1
fi

mkdir -p "$SSL_DIR"

obtain_if_missing() {
  if [ -d "$LE_DIR" ]; then
    return 0
  fi

  echo "[renew-cert] LetsEncrypt directory not found: $LE_DIR"
  echo "[renew-cert] Requesting initial certificate for DOMAIN=$DOMAIN (standalone http-01, needs port 80)..."

  # Stop nginx (www3) to free port 80 (standalone challenge).
  $COMPOSE -f "$COMPOSE_FILE" stop "$NGINX_SERVICE" || true

  local email_args=()
  if [ -n "$EMAIL" ]; then
    email_args+=(--email "$EMAIL" --no-eff-email)
  else
    email_args+=(--register-unsafely-without-email)
  fi

  certbot certonly --non-interactive --agree-tos --standalone \
    --preferred-challenges http \
    -d "$DOMAIN" \
    "${email_args[@]}"

  # Bring nginx back
  $COMPOSE -f "$COMPOSE_FILE" start "$NGINX_SERVICE" || true
}

obtain_if_missing

echo "[renew-cert] Syncing fullchain -> nginx/ssl/cert.pem"
if sync_ssl_files; then
  echo "[renew-cert] SSL files updated; restarting $NGINX_SERVICE"
  $COMPOSE -f "$COMPOSE_FILE" restart "$NGINX_SERVICE"
else
  echo "[renew-cert] SSL files already up to date"
fi

# Certbot standalone http-01 needs port 80 -> stop nginx ONLY if a renewal is attempted.
PRE_HOOK="$COMPOSE -f $COMPOSE_FILE stop $NGINX_SERVICE"
DEPLOY_HOOK="cp -fL $LE_DIR/fullchain.pem $SSL_DIR/cert.pem && cp -fL $LE_DIR/privkey.pem $SSL_DIR/privkey.pem && chmod 600 $SSL_DIR/privkey.pem || true"
POST_HOOK="$COMPOSE -f $COMPOSE_FILE start $NGINX_SERVICE && $COMPOSE -f $COMPOSE_FILE restart $NGINX_SERVICE"

echo "[renew-cert] Running certbot renew for DOMAIN=$DOMAIN"
certbot renew --quiet --pre-hook "$PRE_HOOK" --deploy-hook "$DEPLOY_HOOK" --post-hook "$POST_HOOK"

echo "[renew-cert] Syncing fullchain after certbot (safety)"
sync_ssl_files || true

echo "[renew-cert] Done"

