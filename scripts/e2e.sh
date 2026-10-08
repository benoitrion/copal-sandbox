#!/usr/bin/env bash
# End-to-end demo: mock backend + git app + pre-commit + MCP + GitHub/GitLab PR checks on billing-api.
#   npm run e2e            (servers stopped at the end)
#   KEEP=1 npm run e2e     (servers keep running — open http://localhost:4010 to explore the console)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$(mktemp -d)}"
MOCK_PORT="${MOCK_PORT:-4010}"; APP_PORT="${APP_PORT:-4020}"
export HOME_COPAL="$WORK/home"; export HOME="$HOME_COPAL"   # isolate ~/.copal
export COPAL_SERVER="http://localhost:$MOCK_PORT" COPAL_API_KEY="copal_dev_local"
export GITHUB_API_URL="$COPAL_SERVER/github" GITHUB_TOKEN="mock-token" GITHUB_WEBHOOK_SECRET="e2e-secret"
export GITLAB_API_URL="$COPAL_SERVER/gitlab/api/v4" GITLAB_TOKEN="mock-token" GITLAB_WEBHOOK_SECRET="e2e-secret"
export COPAL_CONSOLE_URL="$COPAL_SERVER/" NO_COLOR="${NO_COLOR:-}"
COPAL="node $ROOT/packages/cli/dist/src/index.js"
GITAPP="node $ROOT/packages/git-app/dist/src/server.js"
SCEN="$ROOT/examples/billing-api/scenarios"
pass=0; fail=0
ok()   { echo "  ✔ $*"; pass=$((pass+1)); }
ko()   { echo "  ✖ $*"; fail=$((fail+1)); }
step() { echo; echo "━━ $*"; }

[ -f "$ROOT/packages/cli/dist/src/index.js" ] || (cd "$ROOT" && npm run build >/dev/null)

step "Starting mock backend (:$MOCK_PORT) and git app (:$APP_PORT)"
node "$ROOT/apps/mock-server/dist/src/index.js" --port "$MOCK_PORT" >"$WORK/mock.log" 2>&1 & MOCK_PID=$!
PORT="$APP_PORT" $GITAPP serve >"$WORK/app.log" 2>&1 & APP_PID=$!
cleanup() { [ -z "${KEEP:-}" ] && kill $MOCK_PID $APP_PID 2>/dev/null; }
trap cleanup EXIT
for i in $(seq 1 30); do curl -sf "$COPAL_SERVER/v1/status" -H "x-api-key: $COPAL_API_KEY" >/dev/null && curl -sf "localhost:$APP_PORT/healthz" >/dev/null && break; sleep 0.2; done
curl -s -X POST "$COPAL_SERVER/console/api/reset" >/dev/null
ok "servers up — console: $COPAL_SERVER/"

step "Creating a git copy of billing-api in $WORK/repo"
mkdir -p "$WORK/repo" && cp -r "$ROOT/examples/billing-api/." "$WORK/repo/" && rm -rf "$WORK/repo/scenarios" "$WORK/repo/.mcp.json"
cd "$WORK/repo"
git init -q -b main && git config user.name "e2e" && git config user.email "e2e@example.com"
git add -A && git commit -qm "chore: baseline" && ok "baseline committed"
$COPAL check --all --env ci >/dev/null && ok "baseline branch scan is clean in ci" || ko "baseline should be clean"
$COPAL hook install >/dev/null && ok "pre-commit hook installed"

for s in 01-invoice-rounding 02-ui-to-db 03-sql-and-deps; do
  step "Pre-commit — scenario $s ($(head -1 "$SCEN/$s/DESCRIPTION.md"))"
  git checkout -q main && git checkout -qb "feat/$s"
  cp -r "$SCEN/$s/." . && rm -f DESCRIPTION.md && git add -A
  if git commit -qm "$(head -1 "$SCEN/$s/DESCRIPTION.md")" >"$WORK/precommit-$s.log" 2>&1; then ko "commit should have been blocked"; else
    ok "commit blocked: $(grep -oE '\[[a-z-]+\]' "$WORK/precommit-$s.log" | sort -u | tr '\n' ' ')"; fi
  COPAL_SKIP=1 git commit -qm "$(head -1 "$SCEN/$s/DESCRIPTION.md")" && ok "bypassed locally with COPAL_SKIP=1 (PR check still applies)"
done

step "MCP — agent asks for rules and self-checks a draft"
node "$ROOT/scripts/mcp-smoke.mjs" "$WORK/repo" >"$WORK/mcp.log" 2>&1
grep -q "ui-no-persistence" "$WORK/mcp.log" && ok "copal_get_rules returns the boundary rule for src/web/**" || ko "mcp rules"
grep -q "BLOCK src/web/x.ts" "$WORK/mcp.log" && ok "copal_check_code flags a forbidden import in a draft" || ko "mcp check"

step "Pull requests — GitHub #248 and GitLab !12 from feat/01-invoice-rounding"
git checkout -q feat/01-invoice-rounding
$GITAPP simulate --provider github --dir . --base main --head HEAD --repo acme/billing-api --number 248 --app "http://localhost:$APP_PORT" --mock "$COPAL_SERVER" | sed 's/^/  /'
$GITAPP simulate --provider gitlab --dir . --base main --head HEAD --repo acme/billing-api --number 12 --app "http://localhost:$APP_PORT" --mock "$COPAL_SERVER" | sed 's/^/  /'
$GITAPP simulate --provider github --dir . --base main --head feat/02-ui-to-db --repo acme/billing-api --number 249 --app "http://localhost:$APP_PORT" --mock "$COPAL_SERVER" | sed 's/^/  /'
$GITAPP simulate --provider github --dir . --base main --head feat/03-sql-and-deps --repo acme/billing-api --number 250 --app "http://localhost:$APP_PORT" --mock "$COPAL_SERVER" | sed 's/^/  /'
state() { curl -s "$COPAL_SERVER/console/api/state" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).pulls.find(x=>x.provider==='$1'&&x.number===$2);console.log(p?p.statuses.at(-1).state:'none')})"; }
[ "$(state github 248)" = failure ] && ok "GitHub #248 status = failure, review REQUEST_CHANGES with inline findings" || ko "github 248 status"
[ "$(state gitlab 12)" = failed ] && ok "GitLab !12 status = failed, inline discussions posted" || ko "gitlab 12 status"
[ "$(state github 249)" = failure ] && ok "GitHub #249 (UI→DB) blocked" || ko "github 249"
[ "$(state github 250)" = failure ] && ok "GitHub #250 (SQL + deps) blocked" || ko "github 250"

step "Feedback from a PR comment"
$GITAPP simulate --provider github --dir . --base main --head HEAD --repo acme/billing-api --number 248 --comment "/copal false-positive invoice-contract-test covered by the ledger e2e suite" --app "http://localhost:$APP_PORT" --mock "$COPAL_SERVER" | sed 's/^/  /'

step "Developer applies the corrections and pushes"
cp -r "$SCEN/04-fixed/." . && rm -f DESCRIPTION.md && git add -A
git commit -qm "fix: apply Copal corrections" && ok "pre-commit passes on the fix"
$GITAPP simulate --provider github --dir . --base main --head HEAD --repo acme/billing-api --number 248 --action synchronize --app "http://localhost:$APP_PORT" --mock "$COPAL_SERVER" | sed 's/^/  /'
$GITAPP simulate --provider gitlab --dir . --base main --head HEAD --repo acme/billing-api --number 12 --action synchronize --app "http://localhost:$APP_PORT" --mock "$COPAL_SERVER" | sed 's/^/  /'
[ "$(state github 248)" = success ] && ok "GitHub #248 re-checked → success" || ko "github 248 should pass"
[ "$(state gitlab 12)" = success ] && ok "GitLab !12 re-checked → success" || ko "gitlab 12 should pass"

step "Console evidence"
curl -s "$COPAL_SERVER/v1/metrics" -H "x-api-key: $COPAL_API_KEY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s);console.log('  analyses',m.analyses,'·',JSON.stringify(m.bySource),'· gates',JSON.stringify(m.gates));m.drift.slice(0,6).forEach(d=>console.log('   ',d.ruleId.padEnd(24),d.count,d.falsePositives?'('+d.falsePositives+' FP)':''))})"

echo; echo "Result: $pass passed, $fail failed  (logs in $WORK)"
[ -n "${KEEP:-}" ] && echo "Servers still running — console: $COPAL_SERVER/  (kill $MOCK_PID $APP_PID to stop)"
exit $((fail > 0))
