#!/usr/bin/env bash
# Pure GitHub — recreate the standalone n8n container with fixed DNS servers.
#
# WHY THIS EXISTS
# ---------------
# n8n is not part of docker-compose.yml, so its run arguments lived nowhere but
# inside the container's own HostConfig. Removing the container would have
# erased the only record of how to start it. This script is that record.
#
# THE BUG IT FIXES
# ----------------
# Docker writes a container's /etc/resolv.conf once, at start, from the host's
# /etc/resolv.conf as it looks at that instant. On a laptop boot, dockerd can
# start before NetworkManager has published the real nameserver, so the
# container inherits a localhost-only resolver and Docker's embedded resolver
# (127.0.0.11) ends up with no upstream at all. Symptom seen on 2026-09-05:
#
#   dockerd: warning "DNS resolver has no external nameservers" cid=f20df218...
#   container: "# NO EXTERNAL NAMESERVERS DEFINED"
#   every hostname -> EAI_AGAIN, while raw IPs and TLS worked fine
#
# `docker restart` fixes it for the current boot only, because the race repeats
# on the next boot. Passing --dns pins the upstream into the container config,
# so it no longer depends on host timing at all.
#
# Container-name lookups (puregh-db) keep working: the embedded resolver answers
# those itself and only forwards what it cannot resolve.
#
# WHAT SURVIVES / WHAT DOES NOT
# -----------------------------
# The volume n8n_data holds every workflow, execution and credential, plus the
# credential encryption key. It is never touched here. Still, run
# ./scripts/backup.sh first: this script does `docker rm`, and a mistake at that
# point is unrecoverable without a backup.
#
# Idempotent: safe to run repeatedly.

set -euo pipefail

cd "$(dirname "$0")/.."

# Secrets live in .env (gitignored), never in this tracked file. The bot token
# must survive future re-runs of this script, so it is passed as a container env
# the same way as the four vars below.
if [ -f .env ]; then
    # shellcheck disable=SC1091
    set -a; . ./.env; set +a
fi
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is not set. Add it to .env first.}"

CONTAINER=n8n
VOLUME=n8n_data
NET=puregh-net
# The tag currently resolves to n8n 2.34.6 locally. `docker run` does not pull
# when the tag is already present, so this reuses the exact running image.
# Override to upgrade deliberately: N8N_IMAGE=... ./scripts/recreate-n8n.sh
IMAGE="${N8N_IMAGE:-docker.n8n.io/n8nio/n8n}"
# Public resolvers, not the router's address: the router IP changes with the
# network, which would reintroduce the very fragility this fixes. Both were
# verified reachable from inside the container over the active VPN.
DNS1=1.1.1.1
DNS2=8.8.8.8
# Host port for the n8n UI. Kept on all interfaces to match the previous
# container. Set N8N_BIND=127.0.0.1 to reach it only from this machine.
N8N_BIND="${N8N_BIND:-}"
PORT=5678

if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    echo "!! volume $VOLUME does not exist. Refusing to continue: recreating" >&2
    echo "   without it would silently produce an empty n8n." >&2
    exit 1
fi

echo "==> volume $VOLUME present (workflows and credentials are in here)"

if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "==> removing the old container (the volume is untouched)"
    docker rm -f "$CONTAINER" >/dev/null
else
    echo "==> no existing container named $CONTAINER"
fi

echo "==> creating $CONTAINER with --dns $DNS1 --dns $DNS2"
docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    --dns "$DNS1" \
    --dns "$DNS2" \
    -p "${N8N_BIND:+$N8N_BIND:}${PORT}:${PORT}" \
    -v "${VOLUME}:/home/node/.n8n" \
    -e TZ=Asia/Tehran \
    -e GENERIC_TIMEZONE=Asia/Tehran \
    -e N8N_MCP_ACCESS_ENABLED=true \
    -e N8N_MCP_MANAGED_BY_ENV=true \
    -e TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
    -e N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
    ${N8N_WEBHOOK_URL:+-e N8N_WEBHOOK_URL="$N8N_WEBHOOK_URL"} \
    "$IMAGE" >/dev/null

# n8n is standalone, so joining the project network is a separate step; the same
# logic lives in setup.sh.
echo "==> attaching to $NET"
if docker inspect "$CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' \
     | grep -qw "$NET"; then
    echo "    already attached"
else
    docker network connect "$NET" "$CONTAINER"
    echo "    attached"
fi

echo "==> waiting for n8n to answer /healthz"
for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" node -e '
        require("http").get({host:"127.0.0.1",port:'"$PORT"',path:"/healthz",timeout:3000},
          r=>process.exit(r.statusCode===200?0:1)).on("error",()=>process.exit(1));
    ' 2>/dev/null; then
        echo "    healthy"
        break
    fi
    sleep 2
done

echo "==> verifying DNS actually has an upstream now"
if docker exec "$CONTAINER" grep -q 'NO EXTERNAL NAMESERVERS' /etc/resolv.conf 2>/dev/null; then
    echo "!! still no external nameservers. --dns did not take effect." >&2
    exit 1
fi
docker exec "$CONTAINER" grep -E 'ExtServers|nameserver' /etc/resolv.conf | sed 's/^/    /'

echo "==> resolving the hosts the workflows depend on"
docker exec "$CONTAINER" node -e '
const dns = require("dns");
const hosts = ["api.github.com", "raw.githubusercontent.com", "api.telegram.org",
               "openrouter.ai", "puregh-db"];
let left = hosts.length, bad = 0;
for (const h of hosts) {
    dns.lookup(h, (e, a) => {
        console.log("    " + (e ? "FAIL " : "OK   ") + h.padEnd(28) + (e ? e.code : a));
        if (e) bad++;
        if (--left === 0) process.exit(bad ? 1 : 0);
    });
}
'

echo
echo "Done. n8n is on http://localhost:${PORT}"
if [ -z "$N8N_BIND" ]; then
    echo "Note: port ${PORT} is published on every interface, so anyone on this"
    echo "      network can reach the n8n UI. Re-run with N8N_BIND=127.0.0.1 to"
    echo "      restrict it to this machine."
fi
