#!/usr/bin/env bash
# Pure GitHub — run the whole stack on this machine (the dev laptop).
#
# Brings up, in order:
#   1. puregh-db        (Postgres, from docker-compose.yml)
#   2. n8n container    (standalone; created only if missing)
#   3. mini-app backend (Express on :3001, serves frontend/dist statically)
#   4. frontend build   (only rebuilt when the sources changed)
#   5. public quick tunnels (default): one to :5678 for the Telegram webhook
#                    (N8N_WEBHOOK_URL), one to :3001 for the web_app MINIAPP_URL
#                    button. Fresh tunnel URLs are written back into
#                    .env / backend/.env, the n8n container is recreated so the
#                    env applies, and the backend is restarted to pick up the
#                    new MINIAPP_URL. Pass --local to skip this step.
#
# Idempotent and non-destructive: anything already running is left alone.
# Secrets live in .env / backend/.env (both gitignored), this script never asks
# for them.
#
# Usage:
#   ./scripts/up.sh        # whole stack + public quick tunnels (default)
#   ./scripts/up.sh --local  # whole stack, local-only (no tunnels)
#
set -euo pipefail
cd "$(dirname "$0")/.."

WANT_TUNNELS=1
[ "${1:-}" = "--local" ] && WANT_TUNNELS=0

say()   { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()    { printf '    \033[1;32m%s\033[0m\n' "$*"; }
warn()  { printf '    \033[1;33mWARN: %s\033[0m\n' "$*"; }
die()   { printf '\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

# Start (or reuse) a cloudflared quick tunnel to 127.0.0.1:$port, printing the
# fresh URL to stdout. One tunnel per port. NOTE: only the URL goes to stdout —
# every status line goes to stderr, otherwise stale "already running" chatter
# would pollute the captured URL when this function is used in $().
start_tunnel() {
    local port="$1" log="$2" url="" pid=""
    if pid=$(pgrep -af "cloudflared tunnel --url http://127.0.0.1:$port" 2>/dev/null | grep -v pgrep | awk '{print $1}' | head -1); then
        ok "tunnel for :$port already running (pid $pid)" >&2
    else
        ok "starting cloudflared -> 127.0.0.1:$port (log $log)" >&2
        setsid nohup cloudflared tunnel --url "http://127.0.0.1:$port" --protocol http2 --no-autoupdate \
            >>"$log" 2>&1 < /dev/null &
        disown 2>/dev/null || true
    fi
    for _ in $(seq 1 30); do
        url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" 2>/dev/null | tail -1 || true)
        [ -n "$url" ] && break
        sleep 2
    done
    printf '%s\n' "$url"
}

# set_env KEY=value FILE — create/replace the KEY line inside FILE.
# Regex runs only on the KEY, never on the value (tunnel URLs contain
# characters like '/' and '&' that would break sed's separator/backrefs).
set_env() {
    local keyval="$1" file="$2"
    local key="${keyval%%=*}"
    if grep -qE "^${key}=" "$file" 2>/dev/null; then
        grep -vE "^${key}=" "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    fi
    printf '\n%s\n' "$keyval" >> "$file"
}

# --- 1. Postgres -----------------------------------------------------------
say "1/5 database (puregh-db)"
docker compose up -d
for _ in $(seq 1 30); do
    [ "$(docker inspect puregh-db --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)" = "healthy" ] && break
    sleep 2
done
[ "$(docker inspect puregh-db --format '{{.State.Health.Status}}' 2>/dev/null)" = "healthy" ] \
    || die "puregh-db is not healthy"
ok "puregh-db healthy (127.0.0.1:5433 from the host)"

# --- 2. n8n ----------------------------------------------------------------
say "2/5 n8n"
if docker inspect n8n >/dev/null 2>&1; then
    ok "container already present — leaving it untouched"
else
    ok "container missing — creating it (env comes from .env)"
    bash scripts/recreate-n8n.sh
fi
bash scripts/setup.sh >/dev/null 2>&1 || bash scripts/setup.sh
ok "n8n reachable at http://localhost:5678"

# --- 3. mini-app backend ---------------------------------------------------
say "3/5 mini-app backend"
[ -d puregh-miniapp/backend/node_modules ] || npm --prefix puregh-miniapp/backend install --no-audit --no-fund
if curl -sf "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
    ok "already listening on :3001 (health OK)"
else
    ok "starting Express server on :3001 (detached, log at /tmp/puregh-backend.log)"
    # Must start from the backend dir so `import 'dotenv/config'` finds .env.
    ( cd puregh-miniapp/backend && setsid nohup node src/server.js >>/tmp/puregh-backend.log 2>&1 < /dev/null & disown 2>/dev/null || true )
    for _ in $(seq 1 20); do
        curl -sf "http://127.0.0.1:3001/health" >/dev/null 2>&1 && break
        sleep 1
    done
    curl -sf "http://127.0.0.1:3001/health" >/dev/null 2>&1 \
        || { echo '--- last backend log lines ---'; tail -20 /tmp/puregh-backend.log; die "backend did not come up"; }
fi
ok "miniapp backend up: http://localhost:3001"

# --- 4. frontend build -----------------------------------------------------
say "4/5 frontend build"
[ -d puregh-miniapp/frontend/node_modules ] || npm --prefix puregh-miniapp/frontend install --no-audit --no-fund
NEED_BUILD=0
if [ ! -f puregh-miniapp/frontend/dist/index.html ]; then
    NEED_BUILD=1
else
    while IFS= read -r f; do
        [ -f "$f" ] && [ "$f" -nt puregh-miniapp/frontend/dist/index.html ] && { NEED_BUILD=1; break; }
    done < <(find puregh-miniapp/frontend/src puregh-miniapp/frontend/index.html -type f 2>/dev/null || true)
fi
if [ "$NEED_BUILD" = "1" ]; then
    ok "sources newer than dist — rebuilding"
    npm --prefix puregh-miniapp/frontend run build
else
    ok "dist is current — not rebuilding"
fi

# --- 5. tunnels ------------------------------------------------------------
TUN_N8N_URL=""
TUN_MINI_URL=""
if [ "$WANT_TUNNELS" = "1" ]; then
    say "5/5 public quick tunnels"
    TUN_N8N_URL="$(start_tunnel 5678 /tmp/cloudflared-n8n.log)"
    TUN_MINI_URL="$(start_tunnel 3001 /tmp/cloudflared-miniapp.log)"

    if [ -z "$TUN_N8N_URL" ] && [ -z "$TUN_MINI_URL" ]; then
        warn "no tunnel URLs appeared in the logs; see /tmp/cloudflared-*.log"
    else
        # N8N_WEBHOOK_URL: n8n only reads it at container creation, so a changed
        # URL means recreating the container (env comes from .env).
        if [ -n "$TUN_N8N_URL" ]; then
            OLD="$(grep -E '^N8N_WEBHOOK_URL=' .env | cut -d= -f2- || true)"
            if [ "$OLD" != "$TUN_N8N_URL" ]; then
                ok "N8N_WEBHOOK_URL changed -> updating .env and recreating n8n"
                set_env "N8N_WEBHOOK_URL=$TUN_N8N_URL" .env
                bash scripts/recreate-n8n.sh
            else
                ok "N8N_WEBHOOK_URL unchanged"
            fi
        fi
        # MINIAPP_URL: read by the backend at startup, so a changed URL means
        # restarting the Express server too.
        if [ -n "$TUN_MINI_URL" ]; then
            OLD="$(grep -E '^MINIAPP_URL=' puregh-miniapp/backend/.env | cut -d= -f2- || true)"
            if [ "$OLD" != "$TUN_MINI_URL" ]; then
                ok "MINIAPP_URL changed -> updating backend/.env and restarting backend"
                set_env "MINIAPP_URL=$TUN_MINI_URL" puregh-miniapp/backend/.env
                pkill -f 'puregh-miniapp/backend/src/server.js' 2>/dev/null || true
                sleep 1
                ( cd puregh-miniapp/backend && setsid nohup node src/server.js >>/tmp/puregh-backend.log 2>&1 < /dev/null & disown 2>/dev/null || true )
                sleep 3
                curl -sf "http://127.0.0.1:3001/health" >/dev/null 2>&1 \
                    && ok "backend restarted with new MINIAPP_URL" \
                    || warn "backend did not restart cleanly; check /tmp/puregh-backend.log"
            else
                ok "MINIAPP_URL unchanged"
            fi
        fi
    fi
else
    say "5/5 tunnels skipped (--local selected; Telegram/web_app won't be public)"
fi

# --- final report ----------------------------------------------------------
say "done"
echo "    n8n UI        : http://localhost:5678"
echo "    miniapp       : http://localhost:3001"
if [ "$WANT_TUNNELS" = "1" ] && { [ -n "$TUN_N8N_URL" ] || [ -n "$TUN_MINI_URL" ]; }; then
    [ -n "$TUN_N8N_URL" ]  && echo "    tunnel n8n    : $TUN_N8N_URL"
    [ -n "$TUN_MINI_URL" ] && echo "    tunnel miniapp: $TUN_MINI_URL"
fi
echo
if [ "$WANT_TUNNELS" = "1" ]; then
    echo "    Tunnels are active; Telegram webhook and web_app buttons work."
    echo "    Next run: ./scripts/up.sh   (or --local to skip tunnels)"
else
    echo "    Local only. To expose Telegram/web_app: ./scripts/up.sh"
fi