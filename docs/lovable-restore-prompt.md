# Copal dashboard: four sections around one goal

## Goal (every feature must serve it)
Help developers prompt AI better — better results, less hallucination and AI slop, fewer tokens — and understand the
code they ship. Copal turns the team's knowledge (rules, boundaries, references) into context the AI receives,
checks what comes back, and shows whether it worked.

## Do not reinvent the wheel
- **No quality gate engine.** Show the gate other tools already compute (Copal's own `copal/check` status, plus SonarQube/SonarCloud or the CI status if configured) — link out for details.
- **No learning platform.** No courses, scores, streaks, badges, leaderboards. Katas are **links** to existing sources (e.g. sammancoaching.org, credited, CC-BY-SA) attached to rules.
- **No PR inbox.** Blocking findings are handled in GitHub/GitLab where Copal already posts the status and review; the dashboard shows trends and links to the PR.
- **No team-performance scoring.** Measure changes (tokens, retries, rework), never rank people.

## Non-negotiables (unchanged)
- Do not break /api/public/v1; scripts/api-test.mjs (github.com/benoitrion/copal-sandbox) must keep passing.
- Engine: @copal/core core-v0.2.0 (https://cdn.jsdelivr.net/gh/benoitrion/copal-sandbox@core-v0.2.0/packages/core/esm/copal-core.mjs).
- Per-person data is visible only to that person unless they opt in. Never display API keys or secrets.
- Nothing in the app depends on the "Add VAT" example or on billing-api; sample data covers several projects and stacks.

## Navigation
**Team knowledge** · **What the AI got** · **Results** · **Quality gate** · (private) **My progress** · Settings

---

## 1. Team knowledge — what the AI and developers should know
**Rules & best practices** (replaces "Coaching rules"): list of rules grouped by category, each showing its question,
why, wrong/right example, reference link and kata link. Editing stays on the existing policy endpoints
(`GET/PUT /v1/projects/:name/policy`), with the YAML tab and validation errors. Filters: noisy (false-positive rate
≥ 20 %), silent (no hit in 90 days), uncoached (no `coach.question`) — each with a one-line next step.

**Architecture & boundary map**: a diagram of modules and the allowed/forbidden dependencies, derived from the
`deny` rules (`from -> to` globs) of the policy. Each forbidden edge shows its violation count over the period
(from analyses) and links to the rule. Purpose: the lead sees where the design is under pressure, and the same
boundaries are what the AI receives as context.

**From reviews to rules**: list of suggestions from `GET /v1/suggestions` and from false-positive/accepted feedback
notes — "this comment keeps coming back → draft a rule". A draft opens prefilled in the editor (question, why,
reference placeholder); a human approves before it applies.

## 2. What the AI got — was the context delivered?
From analyses with source `mcp`, sessions (`/v1/sessions`) and navigator sessions (`/v1/coach/*`):
- per repo/agent: share of agent sessions that fetched rules (MCP) and that ran a self-check before committing;
- navigator usage: tasks where questions were asked, answered, or skipped;
- latest navigator briefs (task, first test, location, edge cases) — readable examples of good specifications;
- setup status per surface (pre-commit hook, PR check, MCP, Claude Code hook, VS Code, JetBrains): "last seen …" or
  "not seen yet" with the copy-paste setup snippet.

## 3. Results — did it work? (per change, never per person)
From `GET /v1/usage`, analyses and sessions:
- tokens and cost per merged change; retries per task;
- **slop caught early vs late**: findings caught at agent self-check or pre-commit vs findings that reached the PR;
- with vs without navigator for each of the above;
- a **pilot comparison** view: pick a start date → before/after on the same measures.
Every number shows its sample size; nothing is shown below a minimum sample (e.g. 10 changes). No "team performance" score.

## 4. Quality gate — code health over time
- `copal/check` pass rate per repo over time and the rules that most often block (links to the PRs on GitHub/GitLab);
- if a SonarQube/SonarCloud project key or CI status URL is configured in Settings, show that gate's status next to
  Copal's and link out. Do not recompute coverage, smells or duplication.

## (private) My progress — only for the signed-in developer
Two quiet signals, no scores: repeat findings per category over time, and how often "Show me" was needed. Plus the
references and katas for the rules that catch them most. Hidden from leads unless the developer opts in.

## Settings
Projects, API keys (create/revoke, never re-display), data controls (redaction from the policy's `redact`), privacy
(opt-in), integrations (SonarQube/SonarCloud key, CI status URL), self-hosting note.

## Remove
Growth charts as a headline page, the learning-hours planner, Katas as a standalone page (katas live on rules),
narrative example cards, savings calculator inside the app, any leaderboard-like view.

## Sample data (mock mode)
3 projects (TypeScript/Node, Java/Spring with the hexagonal pack, Angular), 6 developers, 8 weeks, mixed sources
and agents, a noisy rule, a silent rule, an uncoached rule, a few repeated review comments, results that improve
on some measures and not others.

## Acceptance criteria
- Four sections + private My progress + Settings; every removed item is gone.
- Boundary map is derived from `deny` rules and shows violation counts.
- No reimplemented quality metrics; external gates are linked, not recomputed.
- Results show sample sizes and hide under-sampled numbers.
- api-test passes against the real backend.

Work section by section; after each, summarise what changed and confirm the contract test still passes.
