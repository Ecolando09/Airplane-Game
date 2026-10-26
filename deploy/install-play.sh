#!/usr/bin/env bash
# Installs or updates play.latlas.lol on this server (Ubuntu/Debian, run as root):
#   - games homepage at https://play.latlas.lol/
#   - Lego Sky at https://play.latlas.lol/legoplane/
#   - phone-controller relay as a systemd service, served at /ws
#
# Works with the web server already on the machine: if nginx is serving ports
# 80/443 it adds a separate nginx site for the domain (other sites untouched)
# and gets its HTTPS certificate with certbot; otherwise it uses Caddy.
#
# First time:  curl -fsSL https://raw.githubusercontent.com/Ecolando09/Airplane-Game/claude/lego-airplane-game-ttd82x/deploy/install-play.sh | sudo bash
# Updates:     run the same command again.
# No GitHub?   copy lego-sky-bundle.tar.gz to the server, then:
#              tar xzf lego-sky-bundle.tar.gz && sudo bash lego-sky/deploy/install-play.sh --bundle
set -euo pipefail

REPO=${REPO:-https://github.com/Ecolando09/Airplane-Game.git}
BRANCH=${BRANCH:-claude/lego-airplane-game-ttd82x}
APP=/opt/latlas-play/Airplane-Game
WEB=/var/www/play
DOMAIN=${DOMAIN:-play.latlas.lol}

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Please run as root (sudo)."; exit 1; }

say "Checking which web server is running"
PORTS=$(ss -tlnp | grep -E ':(80|443)\s' || true)
if echo "$PORTS" | grep -q nginx; then
  SERVER=nginx
elif [ -z "$PORTS" ] || ! echo "$PORTS" | grep -vq caddy; then
  SERVER=caddy
else
  echo "Something other than nginx or Caddy is using port 80 or 443:"
  echo "$PORTS"
  echo "Send this output to Claude for a version that works with it."
  exit 1
fi
echo "Using $SERVER"

say "Installing packages (git, rsync, Node.js) if needed"
apt-get update -qq
apt-get install -y -qq git rsync curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
if [ "$SERVER" = caddy ] && ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

# --bundle: install from an unpacked lego-sky-bundle.tar.gz (prebuilt site, no GitHub needed).
if [ "${1:-}" = "--bundle" ]; then
  SRC=$(cd "$(dirname "$0")/.." && pwd)
  say "Installing from bundle at $SRC"
  mkdir -p "$APP"
  rsync -a --delete --exclude node_modules "$SRC/" "$APP/"
  cd "$APP"
  npm ci --omit=dev --no-audit --no-fund
else
  say "Getting the code ($BRANCH)"
  if [ -d "$APP/.git" ]; then
    git -C "$APP" fetch --depth 1 origin "$BRANCH"
    git -C "$APP" reset --hard FETCH_HEAD
  else
    mkdir -p "$(dirname "$APP")"
    git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP"
  fi
  say "Building the site"
  cd "$APP"
  npm ci --no-audit --no-fund
  npm run build:play
fi
mkdir -p "$WEB"
rsync -a --delete play-dist/ "$WEB/"

# Google Maps API key for the "Google 3D" look: pass GOOGLE_MAPS_KEY=... once and it
# is kept in /etc/latlas-play/google-maps-key (never in the repository).
KEY_FILE=/etc/latlas-play/google-maps-key
if [ -n "${GOOGLE_MAPS_KEY:-}" ]; then
  mkdir -p /etc/latlas-play
  printf '%s' "$GOOGLE_MAPS_KEY" > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi
if [ -s "$KEY_FILE" ]; then
  say "Adding the Google Maps key to the game"
  printf "window.LEGOSKY_CONFIG = { googleMapsKey: '%s' };\n" "$(tr -dc 'A-Za-z0-9_-' < "$KEY_FILE")" > "$WEB/legoplane/config.js"
fi

say "Starting the relay (phone controller + multiplayer)"
# Use whichever Node.js is installed (nvm installs it under /root, which the
# www-data user can't read, so the relay runs as root in that case).
NODE_BIN=$(command -v node)
RELAY_USER=www-data
case "$NODE_BIN" in /root/*) RELAY_USER=root ;; esac
sed -e "s#^WorkingDirectory=.*#WorkingDirectory=$APP#" -e "s#^ExecStart=.*#ExecStart=$NODE_BIN server/relay.js#" \
  -e "s#^User=.*#User=$RELAY_USER#" deploy/lego-sky-relay.service > /etc/systemd/system/lego-sky-relay.service
systemctl daemon-reload
systemctl enable --now lego-sky-relay
systemctl restart lego-sky-relay
sleep 2
# Check the relay answers a WebSocket handshake (101 = OK).
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  'http://127.0.0.1:8787/ws?role=mp&room=TEST' || true)
if [ "$CODE" = "101" ]; then
  echo "Relay OK"
else
  echo "!! The relay isn't answering (got: ${CODE:-nothing}). Recent log:"
  journalctl -u lego-sky-relay -n 20 --no-pager || true
fi

IP=$(curl -fsS https://api.ipify.org || echo "")

if [ "$SERVER" = nginx ]; then
  say "Configuring nginx for $DOMAIN"
  if [ -d /etc/nginx/sites-available ]; then
    CONF=/etc/nginx/sites-available/$DOMAIN
    LINK=/etc/nginx/sites-enabled/$DOMAIN
  else
    CONF=/etc/nginx/conf.d/$DOMAIN.conf
    LINK=
  fi
  # Write the site once; on later runs keep it, since certbot adds its HTTPS lines to it.
  if [ ! -f "$CONF" ]; then
    sed -e "s#play.latlas.lol#$DOMAIN#g" -e "s#/var/www/play#$WEB#g" deploy/nginx.conf > "$CONF"
  fi
  [ -n "$LINK" ] && ln -sf "$CONF" "$LINK"
  nginx -t
  systemctl reload nginx

  say "Getting the HTTPS certificate for $DOMAIN"
  if ! command -v certbot >/dev/null; then
    apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  fi
  DNS_IP=$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)
  if [ -z "$DNS_IP" ] || { [ -n "$IP" ] && [ "$DNS_IP" != "$IP" ]; }; then
    echo "DNS for $DOMAIN doesn't point to this server yet (found: ${DNS_IP:-nothing}, this server: ${IP:-unknown})."
    echo "Add the A record in Porkbun, wait a few minutes, then run this script again for HTTPS."
  elif grep -q "ssl_certificate" "$CONF"; then
    echo "Already set up."
  else
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect \
      ${CERTBOT_EMAIL:+-m "$CERTBOT_EMAIL"} ${CERTBOT_EMAIL:---register-unsafely-without-email}
  fi
else
  say "Configuring Caddy for $DOMAIN"
  if ! grep -q "^$DOMAIN" /etc/caddy/Caddyfile 2>/dev/null; then
    # A fresh Caddy install ships a placeholder ":80" site; leave other sites alone.
    if grep -q '^:80' /etc/caddy/Caddyfile 2>/dev/null; then
      cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak
      : > /etc/caddy/Caddyfile
    fi
    { echo; sed "s#^play.latlas.lol#$DOMAIN#" deploy/Caddyfile; } >> /etc/caddy/Caddyfile
  fi
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  systemctl enable --now caddy
  systemctl reload caddy
fi

THRU=$(curl -s -o /dev/null -w '%{http_code}' -m 8 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "https://$DOMAIN/ws?role=mp&room=TEST" || true)
if [ "$THRU" = "101" ]; then
  echo "Multiplayer/phone relay reachable at https://$DOMAIN/ws: OK"
else
  echo "!! https://$DOMAIN/ws didn't answer the handshake (got: ${THRU:-nothing}); multiplayer won't connect."
fi

say "Done!"
echo "Homepage:  https://$DOMAIN/"
echo "Game:      https://$DOMAIN/legoplane/"
echo
echo "If the site doesn't load yet, check DNS: Porkbun needs an A record for"
echo "'${DOMAIN%%.latlas.lol}' pointing to ${IP:-this server}."
