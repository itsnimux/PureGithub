#!/usr/bin/env bash
# Pure GitHub — backup the database and the n8n credential encryption key.
#
# The n8n volume holds the config file containing the auto-generated encryption
# key. If that volume is lost, every credential stored in n8n becomes unreadable
# (even the bot tokens). So the backup must include that file too.
#
# Usage: ./scripts/backup.sh [destination-dir]   (default: ./backups)

set -euo pipefail

cd "$(dirname "$0")/.."
DEST="${1:-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
N8N_VOL="n8n_data"
DB_NAME="puregh"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

mkdir -p "$DEST"

echo "==> backing up Postgres (puregh) -> $DEST/db-$STAMP.dump"
docker exec puregh-db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "/tmp/db.dump"
docker cp "puregh-db:/tmp/db.dump" "$DEST/db-$STAMP.dump"
docker exec puregh-db rm -f /tmp/db.dump

echo "==> backing up n8n credential encryption key (config) -> $DEST/n8n-config-$STAMP"
docker run --rm -v "${N8N_VOL}:/data:ro" alpine sh -c 'tar -C /data -cf - .n8n/config 2>/dev/null || true' > "$DEST/n8n-config-$STAMP.tar" \
  || echo "   (config file not present; nothing to back up)"

echo "==> done. Restore with: pg_restore -U ${POSTGRES_USER} -d ${DB_NAME} --clean <file>"
echo "    Backups kept in: $DEST"