# Copal pivot: from rules dashboard to technical coach

## Context
Copal is pivoting. It is no longer a rules-enforcement dashboard. It is a technical coach for AI-assisted development: hints and questions reach developers in the IDE, the CLI/pre-commit hook and the AI agent (via MCP) — NOT in this web app. This web app becomes the **coach view** for tech leads, coaches and engineering managers: they author coaching rules, see growth, manage katas and see AI usage.

Core model — the hint ladder. Every finding has levels:
- 0 Signal (rule name)
- 1 Question
- 2 Quick reference (why + wrong/right example + rule page)
- 3 Worked example on the developer's file (explained, not applied)
- 4 Fix (only on explicit "Show me", recorded)

The level a developer needed per rule category over time is the main growth metric.

Navigator mode: before an AI agent builds a feature, Copal asks at most 3 questions (first example → failing test, placement → architecture boundary, risk → edge cases) and turns the answers into the agent's brief.

Katas: when a rule recurs (default 3 times per sprint for one person), suggest a micro-kata generated from the developer's own snippet and a canonical kata link (e.g. sammancoaching.org, CC-BY-SA 4.0: link and credit, never copy text). Teams get suggested learning-hour topics.

## Non-negotiables
1. Do NOT break the existing public API under /api/public/v1. The contract test (scripts/api-test.mjs in github.com/benoitrion/copal-sandbox) must still pass 24/24 after every phase, including /healthz.
2. Keep using the published engine @copal/core, now **core-v0.2.0** (ESM: https://cdn.jsdelivr.net/gh/benoitrion/copal-sandbox@core-v0.2.0/packages/core/esm/copal-core.mjs). It already implements v4: `parsePolicy`/`validatePolicy` accept `coach`, `navigator`, `mode` and `severity: block|audit`; findings carry `coach` and `fixText`; and it exports `navigatorQuestions`, `buildBrief`, `containsCode`, `hintCard` and `kataSuggestions`. Use those for /v1/coach/* — do not re-implement rule evaluation or question generation. Until the core-v0.2.0 release exists, pin the commit hash given to you instead of the tag.
3. Mock mode must keep working, with fixtures for every new page.
4. Never display or log API keys or secrets.
5. Growth data is personal: developers see their own data; leads see team trends by default and individual data only if the developer opted in. Show a visible note: "Growth data is for coaching, never for performance reviews."
6. Remove every "auto-fix" / "apply suggestion" button from the web app.

## Phase 1 — Information architecture
Replace the navigation with exactly these pages:
- **Overview** (lead's home): 4 tiles — hint level trend, recurring findings (30 days), test-first ratio on AI-assisted commits, tokens per merged change. One line of text each saying what changed this month.
- **Coaching rules** (editor)
- **Growth**
- **Katas & learning hours**
- **AI usage**
- **Activity**: one timeline merging the old analyses, pre-commit and PR-check pages; filter by source: ide, precommit, ci, pr, agent.
- **Settings**: projects, API keys, integrations, privacy.

Remove the old findings/violations dashboards and any page that duplicates Activity. Old routes redirect to the new pages.

## Phase 2 — Coaching rules editor (.copalrules v4)
The policy is still stored via GET/PUT /v1/projects/:name/policy as YAML. Support v3 unchanged plus these v4 additions:

```yaml
version: 4
mode: coach            # coach (default) | audit | enforce
navigator: { enabled: true, minScope: feature, maxQuestions: 3, questions: [first-example, placement, risk] }
rules:
  - id: domain-no-infra
    kind: deny
    from: src/domain/**
    to: src/infra/**
    severity: audit
    coach:
      question: "Who should own this call — the domain or an adapter?"
      reference: docs/rules/domain-no-infra.md
      example: { bad: "...", good: "..." }
      kata: https://sammancoaching.org/kata_descriptions/...
      learningHour: ports-and-adapters
      escalateAfter: 3
    fix: "..."          # level 4 only
```

Editor UI: a list of rules. For each rule, a form with the v3 matcher fields plus a "Coaching" panel (question, reference markdown, bad/good example, kata link, learning hour, escalateAfter). On the right, a **live hint-card preview** exactly as the IDE will show it:

```
○ domain-no-infra · Hexagonal boundary
  src/domain/invoice.ts:12 imports src/infra/http
  Who should own this call — the domain or an adapter?
  [Ask me] [Explain] [Show me]        Practice: Hexagonal kata · 30 min
```

- A YAML tab shows the raw file with validation errors inline.
- Rules without a `coach` block show a gentle "Add coaching" prompt.
- Security rules (secrets) are always severity block, and the UI says so.
- Ship starter packs selectable in the editor: builtin:security, builtin:testing, builtin:hexagonal, builtin:clean-code — each rule with a question, reference text and an example.

## Phase 3 — New backend endpoints
Additive only. Same auth (x-api-key) and error shape ({error} with 400/401/404/422).
- `POST /v1/coach/reflect` body {project, task, files?} → {sessionId, questions:[{id, kind: first-example|placement|risk, text}]} (max 3; empty array when the task is small)
- `POST /v1/coach/reflect/:sessionId/answers` body {answers:[{id, text}], skipped?: boolean} → {brief:{firstTest, location, edgeCases[], rules[]}}
- `POST /v1/coach/events` body {project, developer, ruleId, category, levelReached: 0-4, action: shown|ask|explain|show_me|skipped|answered, source: ide|cli|agent|pr, at} → 204
- `GET /v1/growth?project=&developer=&since=` → per category: weekly median levelReached, recurrence count, answer rate
- `GET /v1/katas`, `POST /v1/katas` (canonical: {title, url, source, license, rules[], minutes, level, learningHour})
- `POST /v1/katas/generate` body {project, findingId} → micro-kata {id, title, snippet, failingTest, instructions, rules[]}
- `POST /v1/katas/:id/complete` → 204
- Extend `POST /v1/sessions` with optional {inputTokens, outputTokens, costUsd, model, agent, retries, navigatorUsed}
- `GET /v1/usage?project=&since=` → tokens and spend per merged change, retries per task, navigator vs non-navigator comparison

For question generation in /coach/reflect, use the rule set's coach questions and the task text. Questions must NEVER contain the solution or code: add a server-side check that rejects generated questions containing code blocks or code-like lines. Add mock-mode fixtures for every new endpoint.

## Phase 4 — Growth, Katas, AI usage pages
**Growth:** a line chart per rule category of the weekly median hint level needed (0–4, lower is better), with the recurrence count as bars underneath. Team view by default; individual view only for the signed-in developer or with opt-in. A table "Most recurring rules this month" with a "Suggest learning hour" action.

**Katas & learning hours:** two tabs.
- Library: canonical katas (title, source with credit and licence, linked rules, minutes) and generated micro-katas.
- Suggestions: proposed automatically when a rule passes escalateAfter, with who it is for and why ("3rd domain-no-infra in sprint 42").
- Learning hours: a simple planner listing upcoming topics derived from team recurrence.

**AI usage:** tokens and spend per merged change over time, retries per task, and a comparison of tasks with vs without a navigator session. No vanity totals at the top — lead with per-change numbers.

## Phase 5 — Copy, onboarding and mock data
- Landing/onboarding copy: "Copal coaches your developers inside their AI workflow, so AI-written code stays understood, tested and cheap — and your juniors keep growing." Remove wording about "enforcement", "compliance" and "auto-fix".
- Onboarding checklist: connect a repo → pick starter packs → install the IDE plugin / hook / MCP (link to the copal-sandbox README) → invite the team → see first hints in Activity.
- Mock fixtures: a team of 6 developers over 8 weeks where hint levels fall from about 3 to about 1 on hexagonal rules, recurrence drops, two micro-katas are completed, and navigator sessions show fewer retries and about 30% fewer tokens per change. Label mock data clearly as sample data.

## Acceptance criteria
- api-test passes against the real backend (31 checks; the 6 coaching checks are skipped until the endpoints exist, then must pass); new endpoints return correct shapes in both real and mock mode. The reference implementation is apps/mock-server in copal-sandbox.
- No auto-fix action remains anywhere in the web app.
- The rule editor round-trips a v3 file unchanged and a v4 file with coach and navigator blocks.
- The hint-card preview matches the format above.
- The Growth page respects the privacy rule.
- Every page has an empty state explaining what will appear and which integration feeds it.

Work phase by phase. After each phase, summarise what changed and which endpoints were added, and confirm the contract test still passes before starting the next phase.
