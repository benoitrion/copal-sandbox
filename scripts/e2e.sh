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

step "Review my change (local, no server) on scenario 01"
PREV=$(git rev-parse --abbrev-ref HEAD); git checkout -q main
cp -r "$SCEN/01-invoice-rounding/." . && rm -f DESCRIPTION.md
RV=$(COPAL_SERVER= $COPAL review --base main --json)
echo "$RV" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);const ids=r.cards.map(c=>c.ruleId).sort().join(',');const ok=ids==='hardcoded-credentials,invoice-contract-test,ledger-rounding'&&r.cards.every(c=>c.actions.join('|')==='Ask me|Explain|Show me');if(!ok)console.error(ids);process.exit(ok?0:1)})" && ok "3 hint cards with Ask me / Explain / Show me" || ko "review cards wrong"
git checkout -q -- . && git clean -qfd src && git checkout -q "$PREV"

step "Tests first: commit order on the branch (copal check --base)"
PREV=$(git rev-parse --abbrev-ref HEAD)
order() { $COPAL check --base main --json --local --env ci 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log((r.findings||[]).filter(f=>/written after the code/.test(f.message)&&!f.blocking).length)})"; }
git checkout -q main && git checkout -q -b tests-first
printf 'export const vatRate = 0.21;\n' > src/invoice/vat.test.ts; git add -A; git commit -qm "test: vat" --no-verify
printf 'export const vatRate = 0.21;\n' > src/invoice/vat.ts; git add -A; git commit -qm "feat: vat" --no-verify
[ "$(order)" = 0 ] && ok "test committed before code → clean" || ko "test-first branch should be clean"
git checkout -q main && git checkout -q -b code-first
printf 'export const vatRate = 0.21;\n' > src/invoice/vat.ts; git add -A; git commit -qm "feat: vat" --no-verify
printf 'export const vatRate = 0.21;\n' > src/invoice/vat.test.ts; git add -A; git commit -qm "test: vat" --no-verify
[ "$(order)" = 1 ] && ok "code committed before test → one audit question" || ko "code-first branch should give one audit finding (got $(order))"
git checkout -q "$PREV" && git branch -q -D tests-first code-first

step "Scope check against the brief (.copal/brief.md)"
PREV=$(git rev-parse --abbrev-ref HEAD); git checkout -q main && git checkout -q -b scope-demo
mkdir -p .copal src/web && cat > .copal/brief.md <<'BRIEF'
# Task: Add VAT to invoice totals

Scope in: the total calculation in src/invoice
Scope out: the PDF and the database

## Examples
- [ ] 100 EUR net (BE) → 121 EUR gross
- [ ] negative amount → error
BRIEF
printf 'export function vatFor(country: string, net: number) { return net * 0.21; }\n' > src/invoice/vat.ts
SC=$($COPAL scope-check --base main --json)
echo "$SC" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.exit(JSON.parse(s).items.length===0?0:1))" && ok "VAT-only change: nothing beyond the brief" || ko "VAT-only should list nothing: $SC"
printf 'export function renderSettingsPage() {}\n' > src/web/settings-page.ts
SC=$($COPAL scope-check --base main --json); rc=$?
echo "$SC" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const i=JSON.parse(s).items;process.exit(i.length===1&&i[0].file==='src/web/settings-page.ts'?0:1)})" && [ $rc = 0 ] && ok "settings page listed as 'Not in the brief — keep it?' (exit 0)" || ko "settings page should be listed: $SC"
rm -rf .copal src/web src/invoice/vat.ts && git checkout -q "$PREV" && git branch -q -D scope-demo

step "Hint data for the dashboard (JetBrains events, Claude Code request check)"
$COPAL event no-float-money 1 shown --category quality --source ide --json >/dev/null
$COPAL event no-float-money 1 answered --category quality --source ide --json >/dev/null
echo '{"prompt":"Add VAT to invoice totals."}' | $COPAL claude-hook >/dev/null
G=$(curl -s "$COPAL_SERVER/v1/growth?project=billing-api&developer=e2e" -H "x-api-key: $COPAL_API_KEY")
echo "$G" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const g=JSON.parse(s);const c=g.categories.find(x=>x.category==='quality');process.exit(c&&c.answerRate===1?0:1)})" && ok "IDE events land in growth with their category and developer" || ko "quality events missing from growth: $G"
echo "$G" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const g=JSON.parse(s);process.exit(g.categories.some(x=>x.category==='requests'&&x.recurrence['request-scope']===1)?0:1)})" && ok "Claude Code request check lands in growth as 'requests'" || ko "request check event missing: $G"

step "Every dashboard page has real data from the plugins"
TR="$WORK/transcript.jsonl"
printf '%s\n' '{"type":"user","message":{"role":"user","content":"Add VAT"}}' \
  '{"type":"assistant","message":{"model":"claude-opus","usage":{"input_tokens":1200,"output_tokens":300}}}' \
  '{"type":"attachment","content":"Copal request check: before doing anything"}' \
  '{"type":"assistant","message":{"model":"claude-opus","usage":{"input_tokens":800,"output_tokens":200}}}' > "$TR"
echo "{\"hook_event_name\":\"SessionEnd\",\"transcript_path\":\"$TR\",\"cwd\":\"$PWD\"}" | $COPAL claude-hook >/dev/null
$COPAL heartbeat src/invoice/total.ts --editor jetbrains >/dev/null
$COPAL kata done https://sammancoaching.org/kata_descriptions/string_calculator.html --rule invoice-contract-test >/dev/null
api() { curl -s "$COPAL_SERVER$1" -H "x-api-key: $COPAL_API_KEY"; }
has() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);process.exit(($1)?0:1)})"; }
api "/v1/usage?project=billing-api" | has "x.sessions>0 && x.withNavigator.sessions>0" && ok "AI usage: Claude Code session with tokens, counted 'with request check'" || ko "usage missing: $(api /v1/usage?project=billing-api)"
api "/v1/reach?project=billing-api" | has "x.ide.heartbeats>0 && x.agents['claude-code']" && ok "Adoption: IDE heartbeats and Claude Code seen" || ko "reach missing: $(api /v1/reach?project=billing-api)"
api "/v1/katas?project=billing-api" | has "x.katas.some(k=>k.completions.length>0)" && ok "Katas: completion recorded from the CLI/IDE" || ko "kata completion missing"
api "/v1/growth?project=billing-api&developer=e2e" | has "x.events>0 && x.categories.length>1" && ok "Growth: personal hint history across categories" || ko "growth empty"
api "/v1/rules/health?project=billing-api" | has "Array.isArray(x.rules)?x.rules.length>0:Object.keys(x).length>0" && ok "Rules: health computed" || ko "rule health empty"
api "/v1/metrics?project=billing-api" | has "x.analyses>0" && ok "Analytics: reviews recorded" || ko "metrics empty"

step "Console evidence"
curl -s "$COPAL_SERVER/v1/metrics" -H "x-api-key: $COPAL_API_KEY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s);console.log('  analyses',m.analyses,'·',JSON.stringify(m.bySource),'· gates',JSON.stringify(m.gates));m.drift.slice(0,6).forEach(d=>console.log('   ',d.ruleId.padEnd(24),d.count,d.falsePositives?'('+d.falsePositives+' FP)':''))})"

echo; echo "Result: $pass passed, $fail failed  (logs in $WORK)"
[ -n "${KEEP:-}" ] && echo "Servers still running — console: $COPAL_SERVER/  (kill $MOCK_PID $APP_PID to stop)"
exit $((fail > 0))
