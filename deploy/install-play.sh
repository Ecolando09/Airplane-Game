#!/usr/bin/env bash
# Installs or updates play.latlas.lol on this server (Ubuntu/Debian, run as root):
#   - games homepage at https://play.latlas.lol/
#   - Lego Sky at https://play.latlas.lol/legoplane/
#   - phone-controller relay as a systemd service, behind Caddy at /ws
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

say "Checking ports 80/443"
if ss -tlnp | grep -E ':(80|443)\s' | grep -vq caddy; then
  echo "Something other than Caddy is using port 80 or 443:"
  ss -tlnp | grep -E ':(80|443)\s'
  echo "Stop it (or ask Claude for a version that works alongside it) and run this again."
  exit 1
fi

say "Installing packages (git, rsync, Node.js, Caddy) if needed"
apt-get update -qq
apt-get install -y -qq git rsync curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
if ! command -v caddy >/dev/null; then
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

say "Starting the phone-controller relay"
sed "s#^WorkingDirectory=.*#WorkingDirectory=$APP#" deploy/lego-sky-relay.service > /etc/systemd/system/lego-sky-relay.service
systemctl daemon-reload
systemctl enable --now lego-sky-relay
systemctl restart lego-sky-relay

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

IP=$(curl -fsS https://api.ipify.org || echo "this server's IP")
say "Done!"
echo "Homepage:  https://$DOMAIN/"
echo "Game:      https://$DOMAIN/legoplane/"
echo
echo "If the site doesn't load yet, check DNS: Porkbun needs an A record for"
echo "'${DOMAIN%%.latlas.lol}' pointing to $IP. HTTPS starts working a minute after DNS does."
