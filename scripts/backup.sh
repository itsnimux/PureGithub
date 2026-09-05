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
# The volume is mounted at /home/node/.n8n, so the volume root IS the .n8n
# directory: the key lives at 'config', not '.n8n/config'. An earlier version
# used the wrong path and, because the error was swallowed, produced empty
# archives without complaining. Never make this failure silent again.
docker run --rm -v "${N8N_VOL}:/data:ro" alpine tar -C /data -cf - config > "$DEST/n8n-config-$STAMP.tar"

# An empty tar is 1024 bytes of padding and extracts without error, so size
# alone proves nothing: verify the member is actually in there.
if ! tar -tf "$DEST/n8n-config-$STAMP.tar" | grep -qx 'config'; then
    echo "!! the encryption key was NOT captured. Refusing to report success." >&2
    echo "   Check: docker run --rm -v ${N8N_VOL}:/data:ro alpine ls -la /data" >&2
    exit 1
fi
echo "    encryption key captured ($(tar -tvf "$DEST/n8n-config-$STAMP.tar" | awk '{print $3}') bytes)"

echo "==> done. Restore with: pg_restore -U ${POSTGRES_USER} -d ${DB_NAME} --clean <file>"
echo "    Backups kept in: $DEST"
