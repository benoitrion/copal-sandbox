# Align the Lovable app with the reference implementation, using mocks

Paste everything below the line into Lovable. Unlike `lovable-alignment-prompt.md`, this version builds no backend: the app keeps running on mock data. That data, its types and the screens are aligned with the reference implementation, and a switch lets the app talk to the live reference mock server.

---

## Goal

Keep Copal a frontend-only app that runs on mock data. Do **not** create Supabase tables, Edge Functions or any backend.

Make every type, mock record and screen match the reference implementation in **https://github.com/benoitrion/copal-sandbox** (public). That repository contains the CLI, the MCP server, the GitHub/GitLab app, the VS Code extension, the JetBrains plugin, and a mock backend whose HTTP API is the contract.

The app must be able to switch, at runtime, between:

- **Mock data** (the default): realistic fixtures captured from that backend, bundled in the app.
- **Live server**: the reference mock backend over HTTP. The current URL and API key are posted in https://github.com/benoitrion/copal-sandbox/issues/1.

## 1. Fixtures and types

Copy the folder https://github.com/benoitrion/copal-sandbox/tree/main/docs/lovable/mocks into `src/mocks/copal/`, unchanged.

- `types.ts` holds the exact API types (also reproduced below).
- Each other file is a real API response captured from the reference backend, written as `export const <name> = {...} satisfies <Type>`. The TypeScript compiler therefore guarantees that the mock data matches the contract.
- Do not edit the data by hand. To regenerate it, use `docs/lovable/fixtures/*.json` in the repository.

| Export | Type | Endpoint it mirrors |
|---|---|---|
| `status` | `Status` | `GET /v1/status` |
| `projects` | `ProjectSummary[]` | `GET /v1/projects` |
| `policy` | `PolicyResponse` | `GET /v1/projects/billing-api/policy?file=src/web/invoice-controller.ts` |
| `analyses` | `Analysis[]` | `GET /v1/analyses` (11 analyses from pre-commit, PR and branch checks) |
| `analysis_pr` | `Analysis` | `GET /v1/analyses/:id` (PR `acme/billing-api#250`, 4 blocking findings) |
| `metrics` | `Metrics` | `GET /v1/metrics` |
| `suggestions` | `Suggestions` | `GET /v1/suggestions?project=billing-api` |
| `mentor` | `MentorResponse` | `POST /v1/mentor` |
| `plan` | `PlanResponse` | `POST /v1/plan` |
| `analyze_request` / `analyze_response` | – / `Report & { analysisId, project }` | `POST /v1/analyze` (scenario 01) |
| `error_401` / `error_422` | `ApiErrorBody` | Error bodies: missing or invalid key, invalid policy |

Delete the current illustrative data (hard-coded findings, made-up metrics). After this change, no component may contain inline data: everything comes from the data layer below.

## 2. Types — `src/mocks/copal/types.ts` (re-export it from `src/lib/copal/types.ts`)

These shapes are exact. Do not rename or drop fields.

```ts
export type Mode = "audit" | "enforce" | "off";
export type Severity = "info" | "warning" | "error";
export type Category = "quality" | "architecture" | "security" | "dependency" | "testing";
export type Source = "precommit" | "pr" | "mcp" | "ide" | "branch";

export interface Suggestion { original: string; replacement: string }

export interface Finding {
  ruleId: string; category: Category; severity: Severity; mode: Mode; blocking: boolean;
  file: string; line: number; column?: number; endColumn?: number;
  message: string; why?: string; suggestion?: Suggestion; sources?: string[];
}

export interface Report {
  environment: string; findings: Finding[]; blocking: boolean;
  summary: { total: number; blocking: number; audit: number; byCategory: Partial<Record<Category, number>> };
  filesChecked: number; rulesEvaluated: number;
}

export interface Analysis extends Report {
  id: string; project: string; source: Source; ref?: string; title?: string; author?: string; agent?: string;
  createdAt: string; feedback: { ruleId: string; verdict: "false-positive" | "accepted"; note?: string; at: string }[];
}

export interface Rule {
  id: string; category?: Category; mode?: Mode; severity?: Severity; why?: string; message?: string;
  paths?: string[]; exclude?: string[]; sources?: string[];
  deny?: string; pattern?: string; flags?: string; fix?: { replace?: string; with: string };
  secrets?: boolean; dependencies?: { allow?: string[]; deny?: string[] }; requireTest?: { test: string };
}

export interface Policy {
  version: number; project?: string; rules: Rule[];
  redact?: { name: string; pattern: string; flags?: string }[];
  environments?: Record<string, { rules?: Record<string, { mode?: Mode; severity?: Severity }> }>;
}

export interface Status { workspace: string; plan: string; projects: string[]; controls: number; serverTime: string }
export interface ProjectSummary { name: string; version: number; updatedAt: string; rules: number }
export interface PolicyResponse { project: string; version: number; yaml: string; policy: Policy; applicable?: Rule[]; resolvedYaml: string }

export interface Metrics {
  analyses: number; bySource: Partial<Record<Source, number>>;
  drift: { ruleId: string; count: number; falsePositives: number }[];
  gates: { passed: number; failed: number }; governedChanges: number; sessions: number; tokens: number;
}

export interface Suggestions { project: string; suggestions: { ruleId: string; text: string }[] }
export interface MentorResponse { guidance: string; findings: Finding[]; redactedSnippet: string; redactions: { name: string; count: number }[] }
export interface PlanResponse { story: string; steps: string[]; constraints: string[] }
export interface ApiErrorBody { error: string }
```

## 3. Data layer — `src/lib/copal/`

Define one interface with two implementations, and expose it through React Query hooks only.

```ts
export interface CopalApi {
  status(): Promise<Status>;
  projects(): Promise<ProjectSummary[]>;
  getPolicy(project: string, opts?: { file?: string; environment?: string }): Promise<PolicyResponse>;
  putPolicy(project: string, yaml: string): Promise<{ project: string; version: number; rules: number }>;
  analyses(opts?: { project?: string; limit?: number }): Promise<Analysis[]>;
  analysis(id: string): Promise<Analysis>;
  feedback(id: string, body: { ruleId: string; verdict: "false-positive" | "accepted"; note?: string }): Promise<{ ok: true }>;
  metrics(project?: string): Promise<Metrics>;
  suggestions(project: string): Promise<Suggestions>;
  mentor(body: { snippet: string; project?: string; file?: string }): Promise<MentorResponse>;
  plan(body: { story: string; project?: string }): Promise<PlanResponse>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
```

### `MockCopalApi`

- Imports from `src/mocks/copal` and returns deep copies after 150–300 ms of simulated latency.
- **`analyses()`**:
  - sorts newest first by `createdAt`;
  - filters by `project`;
  - applies `limit` (default 50).
- **`analysis(id)`**:
  - returns the record from `analyses.json` with that `id`;
  - for an unknown id, throws `ApiError(404, 'unknown analysis')`.
- **`feedback()`** keeps state in memory for the session:
  - appends `{ ruleId, verdict, note, at: new Date().toISOString() }` to that analysis's `feedback`;
  - for a `false-positive`, increments `falsePositives` of that rule in `metrics.drift`.
- **`putPolicy()`** checks, for each rule in the YAML, that exactly one of `deny`, `pattern`, `secrets`, `dependencies`, `requireTest` is present:
  - on failure, throws `ApiError(422, "invalid policy: <id> expected exactly one of deny, pattern, secrets, dependencies, requireTest; got none")`, the same wording as `error_422`;
  - otherwise, stores the YAML, bumps `version`, and returns `{ project, version, rules }`.
- **`getPolicy()`**:
  - returns `policy.json`, with the stored YAML when it has been edited;
  - when `file` is given, `applicable` comes from the fixture for `src/web/invoice-controller.ts`;
  - for other paths, use the full rule list.
- **`mentor()`** and **`plan()`** return their fixtures.
- **`status()`**, **`projects()`**, **`metrics()`** and **`suggestions()`** return their fixtures.

### `HttpCopalApi`

- **Requests:** call `baseUrl + "/v1/..."` with the header `x-api-key`. The reference server already sends permissive CORS headers.
- **Errors:** non-2xx responses carry `{ "error": string }`; throw `ApiError(status, body.error)`.
- **401 handling:** clear the stored key and open the connection settings with the message "API key rejected".

### Mode selection

- **Default:** mock.
- **Build-time:** `VITE_COPAL_MODE=mock|live`, `VITE_COPAL_SERVER`.
- **Runtime:** a **Data source** section in Settings, saved to `localStorage`:
  - "Mock data" or "Live server";
  - when live: a server URL, an API key (password field), and a **Test connection** button that calls `status()` and shows `workspace`, `projects` and `controls`.
- **Visibility:** show the current mode in the console header, as a badge "Mock data" or "Live · <host>".
- **Refresh:** in live mode, refresh queries every 5 s.

## 4. Console screens

Keep the existing `?view=` routes.

### Header KPIs (from `metrics()`)
- `analyses`
- `governedChanges` ("governed changes")
- `gates.passed / (passed + failed)` ("PR gates passed")
- `bySource` as "pre-commit / PR / branch"
- the sum of `summary.blocking` across analyses ("blocking findings")

### `view=policy`
- Project picker from `projects()`.
- The YAML editor shows `yaml`. **Save** calls `putPolicy`; show a 422 message inline under the editor and keep the user's text.
- Effective rules from `policy.rules`: id, `enforce`/`audit` badge, category, `why`, and the check:
  - `deny` → "imports: a → b"
  - `pattern` → "pattern" (plus the `fix.with` preview)
  - `secrets` → "credentials"
  - `dependencies` → "allow / deny lists"
  - `requireTest` → "test required: …"
- An environment selector (`local`, `ci`, taken from `policy.environments`). Apply its overrides to the displayed modes.
- A **Rules for a file** input: calls `getPolicy(project, { file })` and lists `applicable`.
- A **Resolved** tab showing `resolvedYaml`.

### `view=precommit`
- Analyses with `source` in `precommit`, `mcp`, `ide`.
- Row: title, agent, author, environment, time, status pill (blocking / audit / ok).

### `view=prs`
- Analyses with `source === "pr"`, grouped by `ref` (`acme/billing-api#248`, `acme/billing-api!12`; `#` means GitHub, `!` means GitLab, shown with the provider icon).
- Each group shows the latest status and the history of re-checks. Example: `#248` goes from blocking to passed after the fix.

### `view=branch`
- Analyses with `source === "branch"`.

### Analysis detail
- Summary line: `summary.blocking` blocking, `summary.audit` audit, plus the environment.
- One card per finding:
  - message, `file:line`, `why`, `sources`;
  - when `suggestion` exists, a two-line diff `- original` / `+ replacement`;
  - a **Preview correction** button that expands that diff;
  - a **False positive** button that calls `feedback({ ruleId, verdict: "false-positive" })` and then shows the feedback list.

### Engineering evidence
- **Drift:** bar list from `metrics.drift`, with false-positive counts.
- **Gates:** from `metrics.gates`.
- **Cost:** `metrics.tokens` across `metrics.sessions` agent sessions.
- **Rework:** show "Coming soon".
- **Suggestions:** a panel listing `suggestions().suggestions`.

### Playground (new, on `/console?view=playground`)
- Inputs: a file path (default `src/invoice/total.ts`) and a code box prefilled with the scenario 01 code (`analyze_request.files[0].content`).
- **Check** calls `mentor()` and shows:
  - the findings, as the same cards as above;
  - the redacted snippet, highlighting the `[REDACTED:…]` markers;
  - the `guidance` text, as "What Copal MCP tells the agent".
- **Plan** calls `plan({ story })` and shows its steps and constraints.

## 5. Landing page and docs

The landing page hero already matches the fixtures (`billing-api #248`, `ledger-rounding`, `LedgerPort.round(sum, Currency.EUR)`, `Jira FIN-402`, secret masked as `AKIA…7Z2M`). Keep it, and make **Open the live demo** go to the console in mock mode.

Update the docs pages from the reference repository:

- **Policy Engine:** the full `.copalrules` v3 format.
  - Rule kinds: `deny`, `pattern` + `fix`, `secrets`, `dependencies`, `requireTest`.
  - Top level: `extends: [builtin:security, builtin:quality]`, `redact`, `environments`.
  - In-code suppression: `// copal-ignore <rule-id>`.
  - Use `examples/billing-api/.copalrules` as the example.
- **API reference:** every endpoint in the fixture table above, with the fixture content as the example response. The base URL is configurable (`COPAL_SERVER`); every call sends `x-api-key`; errors use `{ "error": "..." }` with status 400, 401, 404, 422 or 500.
- **Editors & agents:**
  - **MCP:** copy the snippets for Claude Code, Cursor, VS Code / Copilot and Codex from `integrations/mcp/README.md`.
    - Tools: `copal_get_rules`, `copal_check_code`, `copal_check_staged`, `copal_redact`, `copal_plan`, `copal_report_session`.
    - Resources: `copal://policy`, `copal://policy/resolved`.
  - **VS Code extension:** live diagnostics and quick fixes.
  - **JetBrains plugin:** Settings → Tools → Copal.dev; Tools → Copal.dev menu; local build `./gradlew buildPlugin` from `plugins/jetbrains`.
- **Quickstart / pre-commit:**
  - Commands: `copal login`, `copal hook install`, `copal check [--staged|--base REF|--all] [--env] [--fix]`, `copal check --stdin-file PATH --json`.
  - Exit codes: 0 / 1 / 2; `COPAL_SKIP=1` bypasses locally.
- **Native PR checks:** status `copal/check`; review `REQUEST_CHANGES` with inline suggestions; `/copal false-positive <rule>` comment command; webhooks `/webhooks/github` and `/webhooks/gitlab`.

## 6. Do not change

- Pricing and positioning.
- Do not add a backend, database tables or authentication flows.

## Acceptance criteria

**In mock mode (default, offline):**
1. The console header shows 11 analyses, 4 governed changes, PR gates 2 / 6, and 19 blocking findings.
2. The top drift rule is `hardcoded-credentials` with 5 occurrences.
3. The PR view lists `#248`, `#249`, `#250` and `!12`. `#248` and `!12` show a blocking check followed by a passed re-check. `#250` shows 4 blocking findings: `approved-dependencies` ×2, `sql-injection` and `hardcoded-credentials`.
4. In the playground, **Check** on the prefilled code shows `ledger-rounding` with the diff `+   const total = LedgerPort.round(sum, Currency.EUR);`. The redacted snippet contains `[REDACTED:aws-access-key]` and never the key itself.
5. **False positive** on a finding increments that rule's false-positive count in Drift.
6. Saving a policy rule with no check kind shows exactly the `error_422` message, and keeps the editor content.

**Code quality:**
7. `tsc` passes with the copied `src/mocks/copal` files unchanged, and no component contains inline data.

**In live mode** (URL and key from issue #1):
8. **Test connection** shows workspace `copal-sandbox` and project `billing-api`.
9. The same screens fill from the server and refresh every 5 s.
10. A wrong key shows "API key rejected".
