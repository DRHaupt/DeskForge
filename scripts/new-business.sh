#!/usr/bin/env bash
# Scaffold a deployment folder for a new business.
#
#   scripts/new-business.sh <name> <example> [target-dir]
#
#   <name>     short name, e.g. acme  (used for the folder and compose project)
#   <example>  msp-it-support | internal-it | ecommerce-support
#   target-dir defaults to ./deployments/<name>
#
# The folder gets its own .env (with generated secrets), business.config.yaml,
# branding/ and docker-compose.yml. Nothing in it is overwritten by upgrades.
set -euo pipefail

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[ $# -ge 2 ] || usage

NAME="$1"
EXAMPLE="${2%.yaml}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${3:-$REPO_DIR/deployments/$NAME}"
SRC_CONFIG="$REPO_DIR/examples/$EXAMPLE.yaml"

if ! [[ "$NAME" =~ ^[a-z][a-z0-9-]{1,40}$ ]]; then
  echo "✖ name must be lowercase letters, digits and dashes (e.g. acme-dental)"; exit 1
fi
if [ ! -f "$SRC_CONFIG" ]; then
  echo "✖ unknown example '$EXAMPLE'. Choose one of:"; ls "$REPO_DIR/examples" | sed 's/\.yaml$//; s/^/    /'; exit 1
fi
if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  echo "✖ $TARGET already exists and is not empty — refusing to overwrite"; exit 1
fi

rand() { openssl rand -base64 "$1" 2>/dev/null | tr -d '\n/+=' | cut -c1-"$2" || head -c 200 /dev/urandom | tr -dc 'A-Za-z0-9' | cut -c1-"$2"; }

mkdir -p "$TARGET/branding"
cp "$SRC_CONFIG" "$TARGET/business.config.yaml"
cp "$REPO_DIR/branding/"*.svg "$TARGET/branding/"
cp "$REPO_DIR/docker-compose.yml" "$TARGET/docker-compose.yml"
mkdir -p "$TARGET/deploy/certs" "$TARGET/scripts"
cp "$REPO_DIR/deploy/Caddyfile" "$REPO_DIR/deploy/Caddyfile.cloudflare" "$REPO_DIR/deploy/cloudflare-ips.caddy" "$TARGET/deploy/"
cp "$REPO_DIR/scripts/update-cloudflare-ips.sh" "$TARGET/scripts/"
chmod 700 "$TARGET/deploy/certs"

AUTH_SECRET="$(rand 64 64)"
PG_PASSWORD="$(rand 32 32)"
ADMIN_PASSWORD="Df-$(rand 24 16)-9a"
SUPPORT_DOMAIN="$(grep -m1 'supportEmail:' "$TARGET/business.config.yaml" | sed 's/.*@//; s/[[:space:]]*$//')"

sed -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$AUTH_SECRET|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG_PASSWORD|" \
    -e "s|^COMPOSE_PROJECT_NAME=.*|COMPOSE_PROJECT_NAME=deskforge-$NAME|" \
    -e "s|^DESKFORGE_SRC=.*|DESKFORGE_SRC=$REPO_DIR|" \
    -e "s|^SEED_ADMIN_EMAIL=.*|SEED_ADMIN_EMAIL=admin@${SUPPORT_DOMAIN:-example.com}|" \
    -e "s|^SEED_ADMIN_PASSWORD=.*|SEED_ADMIN_PASSWORD=$ADMIN_PASSWORD|" \
    "$REPO_DIR/.env.example" > "$TARGET/.env"
chmod 600 "$TARGET/.env"

cat > "$TARGET/README.md" <<README
# DeskForge deployment: $NAME

Created from \`examples/$EXAMPLE.yaml\` on $(date +%Y-%m-%d).

1. Edit \`business.config.yaml\` (name, colors, teams, workflows…) and put your logo in \`branding/\`.
2. Edit \`.env\`: set \`APP_BASE_URL\`, SMTP, and any SSO secrets. Secrets were generated for you.
3. Validate: \`(cd $REPO_DIR && npm run config:check -- $TARGET/business.config.yaml)\`
4. Start: \`docker compose up -d\` (add \`--profile caddy\` for built-in HTTPS)
5. Sign in as \`admin@${SUPPORT_DOMAIN:-example.com}\` with the SEED_ADMIN_PASSWORD from \`.env\`
   (the first start creates this account; set SEED_DEMO_DATA=true first if you want demo data).

See $REPO_DIR/docs/DEPLOYING-A-NEW-BUSINESS.md for DNS, reverse proxy, email and SSO setup.
README

cat <<DONE
✔ Created $TARGET
    business.config.yaml   ← from examples/$EXAMPLE.yaml
    .env                   ← secrets generated (AUTH_SECRET, POSTGRES_PASSWORD, admin password)
    branding/              ← replace logo.svg / favicon.svg
    docker-compose.yml

Next:
  cd $TARGET
  \$EDITOR business.config.yaml .env
  docker compose up -d
DONE
