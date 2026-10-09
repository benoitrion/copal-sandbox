# Copal app: mentor dashboard on real plugin data

Prompt for Lovable. Replaces section 2 ("App = account only") of `lovable-mentor-landing-prompt.md`; the landing page
part of that prompt stays as is.

## Ground rules
- **Real data only.** Every number, list and chart comes from the `/api/public/v1` endpoints below. These are filled by
  the IntelliJ / VS Code plugins, the Claude Code hook, the CLI and the PR bot. No mock data, no seeded demo rows, no
  invented numbers. When an endpoint returns nothing, show an empty state that says which plugin or command fills it
  (e.g. "No hints yet. Install the IntelliJ plugin and code as usual.").
- **Do not change the API contract.** Request and response shapes stay exactly as they are; `scripts/api-test.mjs` in
  github.com/benoitrion/copal-sandbox must keep passing. If a view needs a field that does not exist, leave it out and
  list it in your summary. Do not add endpoints.
- **A mentor, not a monitor.** A developer sees their own data. A team lead sees team-level trends **without names**:
  never pass `developer` for anyone but the signed-in user, never show a per-person table, ranking, leaderboard or
  score. Hide any team chart backed by fewer than 3 developers ("Not enough people yet to show a team trend").
- Same look as the landing page (Grammarly-like: white space, one idea per card, light and dark mode). Plain words:
  "hints", "questions", "exercises", not "events", "findings", "drift".

## Navigation (signed in)
Home · Growth · Katas · Rules · Analytics · Settings. A project switcher in the header (`GET /v1/projects`); every
call passes `project=<selected>`.

## 1. Home
- "This week" in three cards: hints you saw, questions you answered (answer rate), exercises open.
  Source: `GET /v1/growth?developer=me&since=<7 days ago>` (`events`, `categories[].answerRate`) and `GET /v1/katas`.
- "Keeps coming back": the top 3 rules from `categories[].recurrence`, each linking to the rule (Rules page) and to a
  suggested kata if one exists.
- "Waiting for you" (leads only): rule proposals count from `GET /v1/rules/drafts`.

## 2. Growth (personal)
Source: `GET /v1/growth?developer=me&since=…` → `{ categories: [{ category, weekly: [{ weekStart, medianLevel, events }],
recurrence, answerRate, showMeShare }], events }`.
- One card per category (architecture, testing, security, smells…): a small line chart of `medianLevel` per week, with
  the ladder as the y-axis labels (0 Signal · 1 Question · 2 Explanation · 3 Example · 4 Fix). The message is
  "**lower is better**: you need fewer steps of help over time".
- Under each chart: answer rate and how often you jumped straight to "Show me" (`showMeShare`), worded neutrally
  ("You opened the example 2 times out of 10").
- Period filter: 4 weeks / 12 weeks / all.
- Leads get a "Team" toggle that calls the same endpoint **without** `developer` (aggregated, no names).

## 3. Katas
Source: `GET /v1/katas` → `{ katas, suggestions }`; `POST /v1/katas` (title, url, …); `POST /v1/katas/:id/complete`;
`POST /v1/katas/generate`.
- "Suggested for you": `suggestions`, each saying why ("the *ledger-rounding* hint came back 4 times this month").
  Buttons: Start (opens the kata URL), Mark done (`/complete`).
- Library: all `katas` with a filter by category; leads can add one (title, URL, rule it practises) or generate one
  from a rule (`/katas/generate`).
- Done katas move to a collapsed "Completed" list. No points or badges.

## 4. Rules (best practices)
Sources: `GET /v1/projects/:name/policy`, `PUT /v1/projects/:name/policy`, `GET /v1/rules/health?days=30`,
`GET /v1/rules/drafts`, `POST /v1/rules/drafts/:id`.
- List of the team's rules grouped by category: name, the question it asks, the "why" text and reference links.
  Developers read; leads edit (form fields mapped to the existing v4 policy, saved with `PUT`; show the YAML in a
  read-only "Advanced" tab).
- Per rule, from rule health: how often it fired, how often it was marked "not helpful", and a flag when it is noisy or
  never fires ("Review this rule?"). Do not invent thresholds; use the flags the endpoint returns.
- Proposals tab: drafts posted by the PR bot (`/copal rule`), with the original comment and a link to the discussion;
  Approve / Dismiss.

## 5. Analytics (team, leads only)
Sources: `GET /v1/metrics`, `GET /v1/usage?since=…`, `GET /v1/reach`.
- **Review**: pull requests checked, passed / needed changes (`gates`), most frequent rules (`drift`, label it
  "Most frequent hints") with their "not helpful" counts.
- **AI requests**: sessions, tokens per merged change, retries per session, **with vs without the request check /
  navigator** (`withNavigator` vs `withoutNavigator`) side by side. Show cost only if `costPerMergedChangeUsd` is not
  null.
- **Adoption**: where Copal is used (IDE, Claude Code, CLI, PR bot) from `/v1/reach`.
- Every chart has a one-line "what this tells you" caption. No per-developer breakdown anywhere.

## 6. Settings
- **Account & keys**: create / revoke device keys (`POST /v1/keys`); the key is shown once and never again.
- **Projects**: connected repositories and their policy version.
- **Set up**: install steps with doc links: IntelliJ plugin, VS Code extension, Claude Code
  (`copal hook install --claude`), pre-commit hook, PR bot (GitHub Action / GitLab job), `copal sync-context`.
- **Privacy**: plain statement of what is collected (hint shown/answered/skipped, ladder level, rule id; no source code,
  secrets removed before AI) and what a lead can see (team trends only).
- **Plan**: early-access status (`POST /v1/plan` as today). No checkout.

## Acceptance criteria
- With an empty workspace, every page shows its empty state and nothing else.
- After running the sandbox's `scripts/e2e.sh` against the app (or using the plugins for a day), each page shows the
  numbers the endpoints return, unchanged.
- No page shows another developer's name next to a number. Team charts hide below 3 developers.
- `scripts/api-test.mjs` passes. No new endpoints. No Lovable badge.
