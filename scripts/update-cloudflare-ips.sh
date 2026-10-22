#!/usr/bin/env bash
# Refresh deploy/cloudflare-ips.caddy from Cloudflare's published address list
# and reload Caddy. Run from the deployment folder. Safe to run from cron
# (e.g. weekly); it only reloads when the list changed.
set -euo pipefail
[ -f docker-compose.yml ] || { echo "✖ run this from a deployment folder"; exit 1; }
v4=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)
v6=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)
ranges=$(printf '%s\n%s\n' "$v4" "$v6" | grep -E '^[0-9a-fA-F:.]+/[0-9]+$' | tr '\n' ' ')
[ -n "$ranges" ] || { echo "✖ got an empty list from Cloudflare; leaving the current one"; exit 1; }
new=$(printf '# Cloudflare edge address ranges (https://www.cloudflare.com/ips/), fetched %s.\n# Regenerate with: scripts/update-cloudflare-ips.sh\ntrusted_proxies static %s\n' "$(date -u +%Y-%m-%d)" "${ranges% }")
if [ -f deploy/cloudflare-ips.caddy ] && [ "$(grep -v '^#' deploy/cloudflare-ips.caddy)" = "$(printf '%s\n' "$new" | grep -v '^#')" ]; then
  echo "✔ Cloudflare ranges unchanged"; exit 0
fi
printf '%s\n' "$new" > deploy/cloudflare-ips.caddy
echo "✔ Updated deploy/cloudflare-ips.caddy"
CADDYFILE=$(grep -E '^CADDYFILE=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true)
if docker compose ps --status running caddy 2>/dev/null | grep -q caddy; then
  docker compose exec -T caddy caddy reload --config "/etc/caddy/deploy/${CADDYFILE:-Caddyfile}" --adapter caddyfile && echo "✔ Caddy reloaded"
fi
