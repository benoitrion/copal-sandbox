# Align Copal (Lovable) with the reference implementation

Paste everything below the line into Lovable.

---

## Goal

Align the Copal site, console and backend with the reference implementation in **https://github.com/benoitrion/copal-sandbox** (public). That repository contains the clients that already exist and must keep working unchanged:

- the `copal` CLI and pre-commit hook;
- the Copal MCP server for coding agents;
- the GitHub / GitLab pull-request app;
- the VS Code extension and the JetBrains plugin.

All of them talk to the HTTP API described below. The API contract is the source of truth: do not rename fields, paths, status codes or error shapes.

A running reference backend (the mock in `apps/mock-server`) is available for comparison. Compare your responses with it field by field.

- Reference mock: the latest URL and API key are posted in https://github.com/benoitrion/copal-sandbox/issues/1.
- It is a temporary demo server, restarted through *Actions → demo-server*.

## 1. Reuse the rule engine, do not rewrite it

Copy `packages/core/src/*.ts` from the repository into `supabase/functions/_shared/copal-core/`. The files are `types.ts`, `yaml.ts`, `glob.ts`, `policy.ts`, `diff.ts`, `engine.ts` and `format.ts`.

- It is dependency-free TypeScript, and Deno supports the `node:path` import it uses.
- Do not use the functions that read the filesystem (`loadPolicy`, `readPolicyFile`, `findPolicyFile`). On the server, the policy always arrives as text: use `parsePolicy`, `resolvePolicy`, `validatePolicy`, `evaluate`, `fileAsChange`, `redact`, `applicableRules`, `rulesToGuidance`.
- The expected behaviour is pinned by `packages/core/test/engine.test.ts` and the scenarios in `examples/billing-api/scenarios/`.

## 2. Backend: public API

Implement a Supabase Edge Function `api` that routes on the path.

- **Base URL:** clients are configured with `COPAL_SERVER=https://<project>.supabase.co/functions/v1/api` and call `COPAL_SERVER + "/v1/..."`. Update the docs, which currently show `https://copal.dev/api/public/v1`, to the real base.
- **Auth:** header `x-api-key: <device key>` on every `/v1/*` route.
- **Health:** `GET /healthz` is unauthenticated and returns `{ ok: true }`.
- **Errors:** JSON `{ "error": "message" }` with 400 (bad body), 401 (missing or invalid key), 404 (unknown project or analysis), 422 (invalid policy) or 500.
- **Responses:** JSON with permissive CORS.

### Documented endpoints (keep them)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v1/status` | – | `{ workspace, plan, projects: string[], controls: number /* total effective rules */, serverTime }` |
| POST | `/v1/keys` | `{ name }` | `{ key }` (prefix `copal_`, store only a hash, show it once). In production, require a signed-in user (Supabase JWT). |
| POST | `/v1/plan` | `{ story, project? }` | `{ story, steps: string[], constraints: string[] /* "id: why" of enforce rules */ }` |
| GET | `/v1/suggestions?project=` | – | `{ project, suggestions: [{ ruleId, text }] }`: the 3 most triggered rules, mentioning false positives |
| POST | `/v1/mentor` | `{ snippet, project?, file? }` | `{ guidance, findings: Finding[], redactedSnippet, redactions: [{ name, count }] }` |
| POST | `/v1/sessions` | `{ agent, project?, durationMs?, tokens?, findings? }` | `{ ok: true }` |
| POST | `/v1/heartbeats` | `{ heartbeats: [{ file, ts, editor }] }` | `{ ok: true, total }` |

### Endpoints to add

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v1/projects` | – | `[{ name, version, updatedAt, rules /* count */ }]` |
| GET | `/v1/projects/:name/policy?file=&environment=` | – | `{ project, version, yaml, policy, applicable?: Rule[], resolvedYaml }` |
| PUT | `/v1/projects/:name/policy` | `{ yaml }` or raw text | `{ project, version, rules }`, or 422 when `validatePolicy` returns issues |
| POST | `/v1/analyze` | see below | `Report & { analysisId, project }` |
| GET | `/v1/analyses?project=&limit=50` | – | `Analysis[]`, newest first |
| GET | `/v1/analyses/:id` | – | `Analysis` |
| POST | `/v1/analyses/:id/feedback` | `{ ruleId, verdict: "false-positive" \| "accepted", note? }` | `{ ok: true }` |
| GET | `/v1/metrics?project=` | – | `Metrics` (below) |

### `POST /v1/analyze`

Request body:

```json
{
  "project": "billing-api",
  "environment": "local",
  "source": "precommit",
  "ref": "staged",
  "title": "...",
  "author": "...",
  "agent": "claude-code",
  "files": [
    {
      "path": "src/a.ts",
      "status": "modified",
      "addedLines": [{ "line": 8, "text": "..." }],
      "content": "..."
    }
  ],
  "policyText": "<raw .copalrules>"
}
```

- `source` is one of `precommit`, `pr`, `mcp`, `ide`, `branch`.
- `status` is one of `added`, `modified`, `deleted`, `renamed`.
- `project`, `title`, `author`, `agent`, `content` and `policyText` are optional.

Processing:

1. Project name: `body.project`, else `parsePolicy(policyText).project`, else `"default"`.
2. If `policyText` is present, the repository's policy wins:
   - run `parsePolicy`, then `resolvePolicy` (only `extends: builtin:*` is resolved), then `validatePolicy` (422 on error);
   - upsert the project and bump its version.
3. Otherwise use the stored policy (404 if the project is unknown).
4. Run `evaluate(files, policy, { environment })`, persist the analysis, and return the report plus `analysisId` and `project`.

### Exact shapes (see `packages/core/src/types.ts`)

```ts
Finding = {
  ruleId, category: "quality"|"architecture"|"security"|"dependency"|"testing",
  severity: "info"|"warning"|"error", mode: "audit"|"enforce"|"off", blocking: boolean,
  file, line, column?, endColumn?, message, why?,
  suggestion?: { original, replacement }, sources?: string[]
}

Report = {
  environment, findings: Finding[], blocking: boolean,
  summary: { total, blocking, audit, byCategory: Record<string, number> },
  filesChecked, rulesEvaluated
}

Analysis = Report & {
  id /* "an_" + hex */, project, source, ref?, title?, author?, agent?, createdAt,
  feedback: [{ ruleId, verdict, note?, at }]
}

Metrics = {
  analyses,
  bySource: Record<source, number>,
  drift: [{ ruleId, count, falsePositives }] /* sorted by count, descending */,
  gates: { passed, failed } /* source=pr analyses: blocking ? failed : passed */,
  governedChanges /* distinct refs among source=pr analyses */,
  sessions,
  tokens /* sum of session tokens */
}
```

### Supabase tables (row-level security per workspace)

| Table | Contents |
|---|---|
| `workspaces` | – |
| `device_keys` | hash, name, user_id, created_at, revoked_at |
| `projects` | name, workspace_id |
| `policy_versions` | project_id, version, yaml, resolved jsonb |
| `analyses` | fields above; findings, summary and feedback as jsonb |
| `analysis_feedback` | – |
| `agent_sessions` | – |
| `heartbeats` | aggregated |

## 3. `.copalrules` format (version 3)

The current docs example (`id`, `mode`, `deny`, `why`) stays valid. The full format is defined by the parser:

- **Rule fields:** `id`, `category`, `mode` (`enforce` blocks, `audit` reports, `off`), `severity`, `message`, `why`, `paths`, `exclude`, `sources`.
- **Exactly one check per rule:**
  - `deny: "a/** -> b/**"`
  - `pattern` (with optional `flags`, and `fix: { with }` supporting `$1` back-references)
  - `secrets: true`
  - `dependencies: { allow, deny }`
  - `requireTest: { test: "{dir}/{name}.test.ts" }`
- **Top level:** `project`, `extends: [builtin:security, builtin:quality]`, `redact: [{ name, pattern }]`, `environments: { ci: { rules: { <id>: { mode } } } }`.
- **Built-in packs:**
  - `builtin:security`: `hardcoded-credentials`, `sql-injection`, `path-traversal`
  - `builtin:quality`: `no-console`, `no-explicit-any`
- **In-code suppression:** `// copal-ignore <rule-id>` on the line or the line above.

Reference policy: `examples/billing-api/.copalrules`.

## 4. Console (`/console`)

Replace the illustrative data with live API data, keeping the existing `?view=` routes.

**`view=policy`**
- Project list and a YAML editor for `.copalrules`.
- Save through `PUT /v1/projects/:name/policy` and show 422 messages inline.
- Effective rules with an `enforce`/`audit` badge, the category and `why`.
- An environment selector.

**`view=precommit`**
- Analyses with `source in (precommit, mcp, ide)`, showing agent, author and findings.

**`view=prs`**
- Analyses with `source=pr`, grouped by `ref` (`owner/repo#n` or `group/repo!n`).
- Re-check history per ref and the latest status.

**`view=branch`**
- Analyses with `source=branch`.

**Engineering evidence panel**, fed by `/v1/metrics`:
- Drift = `drift`
- Gates = `gates`
- Cost = session `tokens`
- Rework: show "coming soon" while the data is missing.

**Finding card**
- Message, `file:line`, `why`, `sources`.
- A `- original` / `+ replacement` diff when `suggestion` exists.
- "Preview correction" opens that diff.
- "False positive" calls `POST /v1/analyses/:id/feedback` with `verdict: "false-positive"`.

**Settings**
- Device keys: create, show once, revoke.

**Refresh**
- Every 5 s, or use Supabase realtime.

## 5. Documentation pages

Update each page so it describes exactly what exists.

### API reference

- All endpoints above, with request and response examples.

### Policy Engine

- Full v3 reference with one example per rule kind.
- The built-in packs.

### Editors & agents

**MCP server `copal` (stdio)**
- Tools: `copal_get_rules`, `copal_check_code`, `copal_check_staged`, `copal_redact`, `copal_plan`, `copal_report_session`.
- Resources: `copal://policy`, `copal://policy/resolved`.
- Prompt: `copal-review`.
- Environment variables: `COPAL_PROJECT_DIR`, `COPAL_ENV`, `COPAL_SERVER`, `COPAL_API_KEY`.
- Config snippets (copy them from `integrations/mcp/README.md`):
  - Claude Code: `claude mcp add copal -e … -- node …/index.js`, or `.mcp.json`
  - Cursor: `.cursor/mcp.json`
  - VS Code / Copilot: `.vscode/mcp.json` with a `servers` key
  - Codex: `~/.codex/config.toml` with a `[mcp_servers.copal]` section

**VS Code**
- Live diagnostics: enforce rules show as errors, audit rules as warnings.
- Quick fixes: "apply correction" and "mark as false positive".
- Commands: Check file, Check workspace, Set API key, Show rules.
- Settings: `copal.serverUrl`, `copal.environment`, `copal.checkOnSave`.

**JetBrains** (keep the existing wording "Settings → Plugins → Marketplace → Copal.dev"; local build `./gradlew buildPlugin` from `plugins/jetbrains`)
- Highlights findings while typing, using the same engine through `copal check --stdin-file <path> --json`.
- Quick fixes: apply correction, mark as false positive.
- *Tools → Copal.dev*: Check Staged Changes, Show Rules for Current File, Re-check Current File, Set API Key…, Open Copal Console.
- *Settings → Tools → Copal.dev*: Node.js path, CLI path, policy environment, server URL. The API key is stored in the IDE password safe.

### Quickstart / pre-commit

**Commands of the `copal` CLI**
- `login --server URL --key KEY` (or `--create-key`)
- `status`
- `check [--staged | --base REF | --all | --diff FILE] [--env ENV] [--json] [--fix] [--local]`
- `check --stdin-file PATH --json` (editor mode)
- `hook install` / `hook uninstall`
- `rules [PATH]`
- `redact [FILE]`
- `feedback ANALYSIS_ID RULE_ID`

**Behaviour**
- Exit codes: 0 ok, 1 blocking finding, 2 error.
- Local bypass: `COPAL_SKIP=1` (the PR check still runs).

### Native PR checks

- Status context `copal/check`; make it required in branch protection.
- The review is `REQUEST_CHANGES` when a finding is blocking, `COMMENT` otherwise, with inline comments carrying a `suggestion` block.
- PR comment commands: `/copal false-positive <rule> [note]` and `/copal accept <rule>`.
- GitHub App permissions: pull requests, statuses and issues write; contents read. Events: `pull_request`, `issue_comment`.
- GitLab: Merge request and Comments webhooks, a token with the `api` scope.
- Webhook endpoints: `POST /webhooks/github` (HMAC `x-hub-signature-256`) and `POST /webhooks/gitlab` (`x-gitlab-token`).
- See `packages/git-app` and `integrations/github-app-manifest.json`.

## 6. Do not change

- The landing page, pricing and positioning.
- Exception: a "governed change" must match `governedChanges` above (one PR, re-checks included).

## Acceptance criteria

Run these against the deployed function, and compare with the reference mock:

1. `curl $COPAL_SERVER/v1/status -H "x-api-key: <key>"` returns 200 with the shape above. Without a key it returns 401 with `{ "error": ... }`.
2. Send the policy `examples/billing-api/.copalrules` and the file `examples/billing-api/scenarios/01-invoice-rounding/src/invoice/total.ts`, sent as `status: "added"` with all its lines in `addedLines` (`environment: "local"`), to `POST /v1/analyze`. The response contains exactly:
   - `ledger-rounding`: blocking, with `suggestion.replacement` equal to `"  const total = LedgerPort.round(sum, Currency.EUR);"`;
   - `hardcoded-credentials`: blocking, with the secret masked as `AKIA…7Z2M` and never in clear;
   - `invoice-contract-test`: audit.

   With `environment: "ci"`, `invoice-contract-test` becomes blocking.
3. A `PUT` of an invalid policy (a rule with no check kind) returns 422.
4. After a feedback call, `/v1/metrics` reflects `falsePositives` for that rule.
5. Set up a test repo from the clone: copy `examples/billing-api` to its own git repo, move its `scenarios/` folder out, and commit. Inside it, `COPAL_SERVER=<url> COPAL_API_KEY=<key> node <clone>/packages/cli/dist/src/index.js check --all --env ci` reports no findings, and the analysis appears in the console within 5 s.
