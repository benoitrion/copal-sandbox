#!/usr/bin/env bash
# Starts the Copal mock backend (API + console + fake GitHub/GitLab + PR webhooks) on one port, in the background.
# Used by Codespaces (postStartCommand); works on any Linux box with Node 20+.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-4010}"
mkdir -p .data
[ -f apps/mock-server/dist/src/index.js ] || npm run build >/dev/null

# The port may be public: never run with the well-known dev key. Reuse or create a random one.
if [ -z "${COPAL_MOCK_DEV_KEY:-}" ]; then
  [ -s .data/dev-key ] || node -e "process.stdout.write('copal_' + require('crypto').randomBytes(18).toString('base64url'))" > .data/dev-key
  export COPAL_MOCK_DEV_KEY="$(cat .data/dev-key)"
fi

if curl -sf "localhost:$PORT/healthz" >/dev/null 2>&1; then
  echo "Copal mock already running on :$PORT"
else
  PORT="$PORT" setsid nohup node apps/mock-server/dist/src/index.js --persist .data/state.json > .data/server.log 2>&1 < /dev/null &
  for i in $(seq 1 40); do curl -sf "localhost:$PORT/healthz" >/dev/null 2>&1 && break; sleep 0.25; done
fi

# Target app (billing-api) on :3000, when its dependencies are installed.
APP_PORT="${APP_PORT:-3000}"
if [ -d examples/billing-api/node_modules ] && ! curl -sf "localhost:$APP_PORT/health" >/dev/null 2>&1; then
  (cd examples/billing-api && PORT="$APP_PORT" setsid nohup npm start > ../../.data/billing-api.log 2>&1 < /dev/null &)
fi

URL="http://localhost:$PORT"
APP_URL="http://localhost:$APP_PORT"
if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  APP_URL="https://${CODESPACE_NAME}-${APP_PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  # Best effort: make the port reachable by the CLI, plugins and Lovable (otherwise: Ports tab → right-click → Port Visibility → Public).
  gh codespace ports visibility "$PORT:public" "$APP_PORT:public" -c "$CODESPACE_NAME" >/dev/null 2>&1 || echo "(could not make ports public automatically — Ports tab → right-click → Port Visibility → Public)"
fi
cat <<MSG

  Copal mock backend: $URL
  Console:            $URL/   (asks once for the key)
  API key:            $COPAL_MOCK_DEV_KEY   (also in .data/dev-key)
  PR webhooks:        $URL/webhooks/github  ·  $URL/webhooks/gitlab
  billing-api:        $APP_URL/health   ·  $APP_URL/customers/c-42/invoices
  Logs:               .data/server.log, .data/billing-api.log

  export COPAL_SERVER=$URL COPAL_API_KEY=$COPAL_MOCK_DEV_KEY
MSG
