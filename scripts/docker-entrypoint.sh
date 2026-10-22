#!/bin/sh
# Container entrypoint.
#   web     — apply migrations, sync business config, (optionally) seed demo data, start Next.js
#   worker  — start the BullMQ worker
#   migrate — apply migrations + sync config, then exit
#   seed    — seed demo data, then exit
#   <cmd>   — anything else is executed as-is (e.g. `sh`)
set -e

if [ ! -f "$BUSINESS_CONFIG_PATH" ]; then
  echo "✖ Business config not found at $BUSINESS_CONFIG_PATH"
  echo "  Mount your business.config.yaml there (see docker-compose.yml)."
  exit 1
fi

# Fall back to the bundled placeholder logo when no branding folder is mounted.
if [ ! -d "$BRANDING_DIR" ]; then
  export BRANDING_DIR=/app/default-branding
fi

migrate() {
  echo "→ Validating business config"
  npx tsx scripts/check-config.ts "$BUSINESS_CONFIG_PATH"
  echo "→ Applying database migrations"
  npx prisma migrate deploy
  echo "→ Syncing business config into the database"
  npx tsx scripts/sync-config.ts
}

case "$1" in
  web)
    migrate
    if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
      echo "→ Seeding demo data (SEED_DEMO_DATA=true)"
      npx tsx prisma/seed.ts
    fi
    echo "→ Starting web server on :${PORT:-3000}"
    exec npx next start -p "${PORT:-3000}"
    ;;
  worker)
    echo "→ Starting worker"
    exec npx tsx src/worker/index.ts
    ;;
  migrate)
    migrate
    ;;
  seed)
    exec npx tsx prisma/seed.ts "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
