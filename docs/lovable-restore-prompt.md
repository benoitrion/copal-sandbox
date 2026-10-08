# Copal: bring back the operational features inside the coaching app

## Why
The coaching pivot removed too much. Coaching pages (Growth, Katas, AI usage) are only credible if a lead can still
see **what actually happened in the code**: which checks ran, what was found, what blocks, which rules misfire.
Those features were the evidence layer — they come back, framed as coaching rather than policing.
Also: the app must not read like a scripted demo of one story. No feature, page or copy may depend on the
"Add VAT to invoices" example or on billing-api specifically.

## Non-negotiables (unchanged)
- Do not break /api/public/v1. scripts/api-test.mjs (github.com/benoitrion/copal-sandbox) must pass: 25 contract checks + 6 coaching checks.
- Engine: @copal/core core-v0.2.0 (https://cdn.jsdelivr.net/gh/benoitrion/copal-sandbox@core-v0.2.0/packages/core/esm/copal-core.mjs). No re-implemented rule evaluation.
- Growth data stays private by default (developer sees own; lead sees team trends; individual only with opt-in).
- No one-click auto-fix in the web app; "Show me" stays in the IDE/CLI.
- Never display or log API keys or secrets.

## Navigation (final)
**Coach** — Overview · Growth · Katas & learning hours · AI usage
**Code** — Checks · Findings · Rule health · Playground
**Setup** — Coaching rules · Integrations · Settings
"Activity" is replaced by **Checks** (below). Keep redirects from old routes (/analyses, /pre-commit, /pull-requests, /drift, /policy, /mentor) to their new homes.

## 1. Checks (brings back: analyses list, pre-commit page, PR checks page)
One list of every analysis from `GET /v1/analyses`, newest first, with filters: source (precommit · pr · ci · branch · mcp · ide), project, author, agent, outcome (blocked · coached · clean), date range.
Row: outcome pill, title/ref, source, author, agent (e.g. claude-code, cursor), blocking/coach counts, time.
Detail panel (`GET /v1/analyses/:id`):
- summary line and environment;
- every finding rendered as a **hint card** (rule, location, message, the rule's question, why/reference/example collapsed under "Explain", fix collapsed under "Show me", kata link);
- for PR sources: link to the PR, the status it set, the review it posted;
- actions per finding: **Mark false positive** / **Accepted** (`POST /v1/analyses/:id/feedback`) with an optional note.
Tabs above the list: All · Pre-commit · Pull requests · Agent self-checks (same data, preset filter) — so the former dedicated pages still exist as views.

## 2. Findings (brings back: findings/violations dashboard)
Aggregated across checks for the selected period: table of rule × count × blocking share × false-positive rate × developers affected (count only, no names unless opted in) × last seen. Click a rule → its occurrences (links into Checks) and its coaching content.
Top strip: open blocking findings on unmerged PRs (the "what blocks today" list a lead needs every morning).

## 3. Rule health (brings back: drift & evidence, suggestions)
Per rule, from `GET /v1/metrics` + feedback + `GET /v1/suggestions`:
- **Recurring** (drift): rules firing more over time → "suggest a learning hour" / link the kata.
- **Noisy**: false-positive rate ≥ 20% → "refine this rule" with the notes developers left.
- **Silent**: rules that never fired in 90 days → "still needed?".
- **Uncoached**: rules without `coach.question` → "add coaching" (opens the editor on that rule).
- Gates: PR checks passed/failed and governed changes over time (these KPIs return here, not on the Overview hero).
Show `GET /v1/suggestions` items as cards with a one-click "open in editor".

## 4. Playground (brings back: mentor / try-a-rule)
Paste or type code + pick a file path and project → `POST /v1/mentor` (server) or the engine in the browser (`evaluate` + `fileAsChange` from core). Show:
- the hint cards exactly as a developer would see them in the IDE;
- the redacted snippet (what an agent/model would receive) with redaction counts;
- the applicable rules for that path (`GET /v1/projects/:name/policy?file=`).
A second tab "Navigator" lets a lead type a task and see the questions `POST /v1/coach/reflect` would ask, and the brief produced from sample answers. This is how a lead tests rules and questions before rolling them out — it replaces the scripted demo stories.

## 5. Integrations (brings back: setup/onboarding pages)
Per surface, status + copy-paste setup, read from what the server has seen (analyses by source, sessions by agent, heartbeats):
- Pre-commit hook: `copal login` + `copal hook install` — last pre-commit check seen.
- PR check: GitHub Action / GitHub App / GitLab — last PR check seen per repo.
- MCP for agents (Claude Code, Cursor, Copilot, Codex): config snippet — last agent session seen.
- Claude Code navigator hook: `copal hook install --claude`.
- IDE plugins: VS Code, JetBrains — last heartbeat.
Each shows "connected · last seen …" or "not seen yet" with the setup snippet.

## 6. Settings (keep + restore)
Projects, API keys (create/revoke, never re-display), data controls (redaction patterns from the policy's `redact`, what leaves the machine), privacy (growth visibility, opt-in), self-hosting note.

## 7. Overview (rebalance)
Four tiles, each linking to its page: **Blocking now** (Findings) · **Hint level trend** (Growth) · **Recurring rules** (Rule health) · **AI tokens per merged change** (AI usage). Below: the latest 5 checks (Checks) and the top 3 kata/learning-hour suggestions. No narrative example cards on the Overview.

## 8. Sample data (generic, not the white paper)
Mock mode gets a realistic, varied workspace:
- 3 projects in different stacks: `billing-api` (TypeScript/Node), `orders-service` (Java/Spring, hexagonal pack), `web-shop` (Angular).
- 6 developers, 8 weeks, sources mixed (precommit, pr, ci, mcp), agents mixed (claude-code, cursor, copilot, none).
- Findings across security, architecture, testing, quality; some false positives with notes; one noisy rule; one silent rule; one uncoached rule.
- Hint levels trending down on some categories and flat on others (not a perfect story).
Remove the "Real-world examples" narrative cards from inside the app (they may stay on the marketing page, labelled illustrative). Every page must look meaningful with real data from a single project too.

## Acceptance criteria
- Every former capability is reachable again: analyses list + detail, pre-commit view, PR checks view, findings dashboard, drift/evidence + gates, suggestions, mentor/playground, policy editor, keys, data controls.
- Findings render as hint cards everywhere; false-positive feedback works and shows up in Rule health.
- api-test passes against the real backend (contract + coaching checks).
- No page, empty state or copy references the VAT example or assumes billing-api.
- Empty states explain which integration feeds the page, with the setup snippet.

Work page by page. After each, summarise what you restored and confirm the contract test still passes.
