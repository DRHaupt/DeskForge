#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh. Run from the deployment folder.
#
#   scripts/restore.sh backups/<timestamp> [--yes]
#
# This REPLACES the current database (and uploads, if present in the backup).
set -euo pipefail

SRC="${1:-}"
[ -n "$SRC" ] && [ -f "$SRC/db.dump" ] || { echo "usage: scripts/restore.sh backups/<timestamp> [--yes]"; exit 1; }
[ -f docker-compose.yml ] && [ -f .env ] || { echo "✖ run this from a deployment folder"; exit 1; }
set -a; . ./.env; set +a
PGUSER="${POSTGRES_USER:-deskforge}"
PGDB="${POSTGRES_DB:-deskforge}"

if [ "${2:-}" != "--yes" ]; then
  read -r -p "This replaces database '$PGDB' with $SRC. Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || { echo "aborted"; exit 1; }
fi

echo "→ Stopping app and worker"
docker compose stop app worker
docker compose up -d postgres redis

echo "→ Restoring database"
docker compose exec -T postgres psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PGDB' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS \"$PGDB\";" -c "CREATE DATABASE \"$PGDB\" OWNER \"$PGUSER\";" > /dev/null
docker compose exec -T postgres pg_restore -U "$PGUSER" -d "$PGDB" --no-owner --exit-on-error < "$SRC/db.dump"

if [ -f "$SRC/uploads.tar.gz" ]; then
  echo "→ Restoring uploads"
  docker compose run --rm --no-deps --entrypoint sh app -c "rm -rf /app/storage/* && tar xzf - -C /app/storage" < "$SRC/uploads.tar.gz"
fi

echo "→ Starting app and worker (migrations run automatically)"
docker compose up -d app worker
echo "✔ Restored from $SRC"
