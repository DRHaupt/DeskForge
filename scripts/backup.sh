#!/usr/bin/env bash
# Back up one DeskForge deployment. Run from the deployment folder (where
# docker-compose.yml and .env live).
#
#   scripts/backup.sh [--keep N] [--dir backups]
#
# Creates backups/<timestamp>/ with:
#   db.dump                 pg_dump custom format (restore with scripts/restore.sh)
#   uploads.tar.gz          attachments (local storage driver only)
#   business.config.yaml    copy of the config
#   env                     copy of .env (contains secrets — protect the backup folder!)
set -euo pipefail

KEEP=0
DIR=backups
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
done

[ -f docker-compose.yml ] && [ -f .env ] || { echo "✖ run this from a deployment folder (docker-compose.yml + .env)"; exit 1; }
set -a; . ./.env; set +a
PGUSER="${POSTGRES_USER:-deskforge}"
PGDB="${POSTGRES_DB:-deskforge}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DIR/$TS"
mkdir -p "$OUT"
chmod 700 "$DIR" "$OUT"

echo "→ Dumping database $PGDB"
docker compose exec -T postgres pg_dump -U "$PGUSER" -d "$PGDB" -Fc --no-owner > "$OUT/db.dump"

if [ "${STORAGE_DRIVER:-local}" = "local" ]; then
  echo "→ Archiving uploads"
  docker compose exec -T app tar czf - -C /app/storage . > "$OUT/uploads.tar.gz"
else
  echo "→ Skipping uploads (STORAGE_DRIVER=$STORAGE_DRIVER — back up your bucket with your provider's tools)"
fi

cp business.config.yaml "$OUT/business.config.yaml"
cp .env "$OUT/env"
chmod 600 "$OUT"/*

SIZE="$(du -sh "$OUT" | cut -f1)"
echo "✔ Backup written to $OUT ($SIZE)"

if [ "$KEEP" -gt 0 ]; then
  ls -1d "$DIR"/*/ 2>/dev/null | sort | head -n -"$KEEP" | while read -r old; do
    echo "  removing old backup $old"; rm -rf "$old"
  done
fi
