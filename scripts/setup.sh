#!/usr/bin/env bash
# Pure GitHub — bring up the database and wire n8n into its network.
#
# Idempotent: safe to run repeatedly.

set -euo pipefail

cd "$(dirname "$0")/.."

NET=puregh-net
N8N_CONTAINER=n8n

echo "==> starting puregh-db"
docker compose up -d

echo "==> waiting for the database to become healthy"
for i in $(seq 1 30); do
    state=$(docker inspect puregh-db --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
    [ "$state" = "healthy" ] && break
    sleep 2
done
if [ "$state" != "healthy" ]; then
    echo "!! puregh-db did not become healthy. Logs:" >&2
    docker compose logs --tail 40 db >&2
    exit 1
fi
echo "    healthy"

# n8n runs as a standalone container, not part of this compose project, so it
# has to be joined to the network explicitly. Without this it sits on the
# default bridge, where container-name DNS does not resolve.
echo "==> attaching $N8N_CONTAINER to $NET"
if docker inspect "$N8N_CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' \
     | grep -qw "$NET"; then
    echo "    already attached"
else
    docker network connect "$NET" "$N8N_CONTAINER"
    echo "    attached"
fi

echo "==> verifying n8n can resolve and reach puregh-db"
docker exec "$N8N_CONTAINER" sh -c 'nc -z -w5 puregh-db 5432' \
    && echo "    puregh-db:5432 reachable from n8n" \
    || { echo "!! n8n cannot reach puregh-db" >&2; exit 1; }

# Reaching puregh-db proves nothing about the internet: Docker's embedded
# resolver answers container names itself and only forwards the rest. When
# dockerd starts before NetworkManager has published a nameserver (a laptop boot
# race, seen 2026-09-05), the container gets a resolver with no upstream: DB
# lookups keep working while GitHub, Telegram and the LLM all fail with
# EAI_AGAIN. Check an external name explicitly so that mismatch cannot hide.
echo "==> verifying n8n can resolve external hosts"
if docker exec "$N8N_CONTAINER" node -e '
      require("dns").lookup("api.github.com", (e) => process.exit(e ? 1 : 0));
   ' 2>/dev/null; then
    echo "    external DNS works"
else
    echo "!! n8n cannot resolve external hostnames (container DNS has no upstream)." >&2
    docker exec "$N8N_CONTAINER" grep -E 'ExtServers|NO EXTERNAL' /etc/resolv.conf >&2 || true
    echo "   Fix it permanently with: ./scripts/recreate-n8n.sh" >&2
    exit 1
fi

echo "==> schema check"
# shellcheck disable=SC1091
set -a; . ./.env; set +a
docker exec puregh-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\dt'

echo
echo "Done. Postgres credential for n8n (IMPORTANT — use the container name, not 127.0.0.1):"
echo "  Host:     puregh-db      <-- must be 'puregh-db' (n8n runs in the same docker network)"
echo "  Port:     5432           <-- the container port, NOT 5433 (5433 is only for the host)"
echo "  Database: $POSTGRES_DB"
echo "  User:     $POSTGRES_USER"
echo "  Password: (see .env)"
echo "  SSL:      disable"
